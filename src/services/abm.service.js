'use strict';
const { db, getKnex } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

async function getAbmDirectReports(abmEmployeeCode) {
  const reports = await db('ts_auth_users')
    .where({ reports_to: abmEmployeeCode, is_active: true })
    .select(
      'employee_code', 'full_name',
      getKnex().raw("role::text AS role"),
      'designation', 'territory_name', 'area_name', 'zone_name',
      'zone_code', 'area_code', 'territory_code'
    )
    .orderBy('full_name');

  if (reports.length > 0) return reports;

  const abmUser = await db('ts_auth_users')
    .where({ employee_code: abmEmployeeCode, is_active: true })
    .first('area_code');

  if (abmUser?.area_code) {

    const abmDirectRoles = await db('ts_user_roles')
      .where({ reporting_to: 'abm', is_active: true })
      .pluck('role_name');

    return db('ts_auth_users')
      .where({ area_code: abmUser.area_code, is_active: true })
      .whereNot({ employee_code: abmEmployeeCode })
      .whereIn('designation', abmDirectRoles)
      .select(
        'employee_code', 'full_name',
        getKnex().raw("role::text AS role"),
        'designation', 'territory_name', 'area_name', 'zone_name',
        'zone_code', 'area_code', 'territory_code'
      )
      .orderBy('full_name');
  }

  return [];
}

const MONTH_NAME_MAP = {
  april:'apr', may:'may', june:'jun', july:'jul',
  august:'aug', september:'sep', october:'oct', november:'nov',
  december:'dec', january:'jan', february:'feb', march:'mar',
};
const MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

const normalizeCat = (cat) => {
  if (!cat) return 'others';
  const c = cat.toLowerCase();
  if (c.includes('equipment')) return 'equipment';
  if (c.includes('iol'))       return 'iol';
  if (c.includes('consumable')) return 'consumable-sales';
  if (c.includes('msi') || c.includes('surgical')) return 'msi';
  return c.replace(/[\s-]+/g, '-');
};

const ABMService = {

  async getTbmSubmissions(abmEmployeeCode, filters = {}) {
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    const tbmCodes = directReports.map((r) => r.employee_code);
    if (tbmCodes.length === 0) return [];
    const activeFy = filters.fy || await getActiveFY();
    let query = db('ts_product_commitments AS pc')
      .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
      .leftJoin('ts_auth_users AS u', 'u.employee_code', 'pc.employee_code')
      .whereIn('pc.employee_code', tbmCodes)
      .where('pc.fiscal_year_code', activeFy);
    if (filters.status) { query = query.where('pc.status', filters.status); }
    else { query = query.whereIn('pc.status', ['submitted', 'approved']); }
    const rows = await query.select(
      'pc.*', 'pm.product_name', 'pm.product_category', 'pm.quota_price__c AS unit_cost',
      'u.full_name AS employee_name', 'u.role AS employee_role'
    ).orderBy('u.full_name').orderBy('pm.product_name');
    return rows.map(formatCommitment);
  },

  async approveTbm(commitmentId, abmUser, { comments = '', corrections = null } = {}) {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only approve 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    const sr = await db('ts_auth_users').where({ employee_code: commitment.employee_code }).first();
    if (!sr || sr.reports_to !== abmUser.employeeCode) throw Object.assign(new Error('This TBM does not report to you.'), { status: 403 });
    const now = new Date(); let action = 'approved'; let originalValues = null;
    if (corrections && Object.keys(corrections).length > 0) {
      originalValues = { ...commitment.monthly_targets };
      const updated = { ...commitment.monthly_targets };
      for (const [month, values] of Object.entries(corrections)) { if (updated[month]) updated[month] = { ...updated[month], ...values }; }
      await db('ts_product_commitments').where({ id: commitmentId }).update({ monthly_targets: JSON.stringify(updated) });
      action = 'corrected_and_approved';
    }
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'approved', approved_at: now, approved_by_code: abmUser.employeeCode });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action, actor_code: abmUser.employeeCode, actor_role: abmUser.role, corrections: corrections ? JSON.stringify(corrections) : null, original_values: originalValues ? JSON.stringify(originalValues) : null, comments });
    return { success: true, submissionId: commitmentId, action };
  },

  async rejectTbm(commitmentId, abmUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only reject 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    const sr = await db('ts_auth_users').where({ employee_code: commitment.employee_code }).first();
    if (!sr || sr.reports_to !== abmUser.employeeCode) throw Object.assign(new Error('This TBM does not report to you.'), { status: 403 });
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft', updated_at: new Date() });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'rejected', actor_code: abmUser.employeeCode, actor_role: abmUser.role, comments: reason });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },

  async bulkApproveTbm(submissionIds, abmUser, comments = '') {
    const directReports = await getAbmDirectReports(abmUser.employeeCode);
    const tbmCodes = directReports.map((r) => r.employee_code);
    const commitments = await db('ts_product_commitments').whereIn('id', submissionIds).where('status', 'submitted').whereIn('employee_code', tbmCodes);
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions.'), { status: 400 });
    const ids = commitments.map((c) => c.id); const now = new Date();
    await db('ts_product_commitments').whereIn('id', ids).update({ status: 'approved', approved_at: now, approved_by_code: abmUser.employeeCode });
    await db('ts_commitment_approvals').insert(ids.map((id) => ({ commitment_id: id, action: 'bulk_approved', actor_code: abmUser.employeeCode, actor_role: abmUser.role, comments })));
    return { success: true, approvedCount: ids.length };
  },

  async getAreaTargets(abmUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    const areaCode = abmUser.areaCode || abmUser.area_code;
    const abmCode  = abmUser.employeeCode;

    const allProducts = await db('product_master')
      .where('isactive', true)
      .select(
        'productcode',
        'product_subgroup AS display_name',
        'product_category',
        'product_family AS subcategory',
        'product_group AS subgroup',
        'quota_price__c AS unit_cost'
      )
      .orderBy('product_family').orderBy('product_group').orderBy('product_subgroup');

    const productMap = {};
    allProducts.forEach((p) => {
      const code = p.productcode;
      productMap[code] = {
        id: code, productCode: code, code,
        name: p.display_name || code,
        categoryId: normalizeCat(p.product_category),
        subcategory: p.subcategory || null,
        subgroup: p.subgroup || null,
        unitCost: Number(p.unit_cost) || 0,
        status: 'not_started',
        monthlyTargets: {},
      };
      MONTHS.forEach((m) => {
        productMap[code].monthlyTargets[m] = { cyQty: 0, cyRev: 0, lyQty: 0, lyRev: 0 };
      });
    });

    const cyRows = await db('ts_product_commitments')
      .where('employee_code', abmCode)
      .where('fiscal_year_code', fy)
      .select('id', 'product_code', 'fiscal_month', 'status',
              'target_quantity', 'target_revenue', 'monthly_targets');

    cyRows.forEach((r) => {
      const code = r.product_code;
      if (!productMap[code]) return;
      const monthKey = MONTH_NAME_MAP[r.fiscal_month && r.fiscal_month.toLowerCase()];
      if (!monthKey) return;
      productMap[code].status = r.status || 'draft';
      productMap[code].id = r.id;
      const mt = r.monthly_targets || {};
      productMap[code].monthlyTargets[monthKey].cyQty = Number(mt[monthKey] && mt[monthKey].cyQty != null ? mt[monthKey].cyQty : r.target_quantity || 0);
      productMap[code].monthlyTargets[monthKey].cyRev = Number(mt[monthKey] && mt[monthKey].cyRev != null ? mt[monthKey].cyRev : r.target_revenue || 0);
      if (mt[monthKey] && mt[monthKey].lyQty !== undefined) {
        productMap[code].monthlyTargets[monthKey].lyQty = Number(mt[monthKey].lyQty) || 0;
        productMap[code].monthlyTargets[monthKey].lyRev = Number(mt[monthKey].lyRev) || 0;
      }
    });

    if (areaCode) {
      const prevFyCode = fy === 'FY26_27' ? 'FY25_26' : null;
      const lyFyCode = prevFyCode || fy;
      const lyRows = await db('ts_geography_targets')
        .where('geo_level', 'area')
        .where('fiscal_year_code', lyFyCode)
        .where('area_code', String(areaCode))
        .where(function () { this.where('target_quantity', '>', 0).orWhere('target_revenue', '>', 0); })
        .select('product_code', 'fiscal_month', 'target_quantity', 'target_revenue');

      lyRows.forEach((r) => {
        const code = r.product_code;
        if (!productMap[code]) return;
        const monthKey = MONTH_NAME_MAP[r.fiscal_month && r.fiscal_month.toLowerCase()];
        if (!monthKey) return;
        if (productMap[code].monthlyTargets[monthKey].lyQty === 0) {
          productMap[code].monthlyTargets[monthKey].lyQty = Number(r.target_quantity) || 0;
          productMap[code].monthlyTargets[monthKey].lyRev = Number(r.target_revenue) || 0;
        }
      });
    }

    return Object.values(productMap).sort((a, b) =>
      a.categoryId.localeCompare(b.categoryId) || a.name.localeCompare(b.name)
    );
  },

  async saveAreaTarget(targetId, monthlyTargets, abmUser) {
    const target = await db('ts_geography_targets').where({ id: targetId }).first();
    if (!target) throw Object.assign(new Error('Target not found.'), { status: 404 });
    await db('ts_geography_targets').where({ id: targetId }).update({ monthly_targets: JSON.stringify(monthlyTargets), set_by_code: abmUser.employeeCode, set_by_role: abmUser.role, status: 'draft', updated_at: new Date() });
    return { success: true, targetId };
  },

  async saveAreaTargetsBulk(targets, abmUser) {
    const fy = await getActiveFY();
    for (const t of targets) {
      await db('ts_geography_targets').insert({
        fiscal_year_code: fy, geo_level: t.geoLevel || 'territory',
        zone_code: abmUser.zoneCode || abmUser.zone_code, zone_name: abmUser.zoneName || abmUser.zone_name,
        area_code: abmUser.areaCode || abmUser.area_code, area_name: abmUser.areaName || abmUser.area_name,
        territory_code: t.territoryCode, territory_name: t.territoryName,
        product_code: t.productCode, category_id: t.categoryId,
        monthly_targets: JSON.stringify(t.monthlyTargets || {}),
        set_by_code: abmUser.employeeCode, set_by_role: abmUser.role, status: 'draft',
      }).onConflict(getKnex().raw("(fiscal_year_code, geo_level, zone_code, COALESCE(area_code,''), COALESCE(territory_code,''), product_code)"))
        .merge({ monthly_targets: JSON.stringify(t.monthlyTargets || {}), set_by_code: abmUser.employeeCode, set_by_role: abmUser.role, status: 'draft', updated_at: new Date() });
    }
    return { success: true, savedCount: targets.length };
  },

  async submitAreaTargets(targetIds, abmUser) {
    const now = new Date();
    const updated = await db('ts_geography_targets').whereIn('id', targetIds).where('status', 'draft').update({ status: 'published', published_at: now, updated_at: now });
    return { success: true, submittedCount: updated };
  },

  async getTeamMembers(abmEmployeeCode) {
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    return directReports.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name, role: r.role }));
  },

  async getTbmHierarchy(abmEmployeeCode) {
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    const activeFy = await getActiveFY(); const result = [];
    for (const tbm of directReports) {
      const srReports = await db('ts_auth_users').where({ reports_to: tbm.employee_code, is_active: true }).select('employee_code');
      const commitments = await db('ts_product_commitments').where({ employee_code: tbm.employee_code, fiscal_year_code: activeFy });
      result.push({ employeeCode: tbm.employee_code, fullName: tbm.full_name, designation: tbm.designation, territory: tbm.territory_name, role: tbm.role,
        salesRepCount: srReports.length, totalCommitments: commitments.length,
        submitted: commitments.filter((c) => c.status === 'submitted').length,
        approved: commitments.filter((c) => c.status === 'approved').length });
    }
    return result;
  },

  async getTeamYearlyTargets(abmEmployeeCode, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    const assignments = await db('ts_yearly_target_assignments AS yta').leftJoin('ts_auth_users AS u', 'u.employee_code', 'yta.assignee_code')
      .where('yta.assigner_code', abmEmployeeCode).where('yta.fiscal_year_code', fy)
      .select('yta.*', 'u.full_name AS assignee_name', 'u.territory_name');
    const members = directReports.map((r) => {
      const memberTargets = assignments.filter((a) => a.assignee_code === r.employee_code);
      return { employeeCode: r.employee_code, fullName: r.full_name,
        targets: memberTargets.map((a) => ({ id: a.id, productCode: a.product_code, categoryId: a.category_id, yearlyTarget: parseFloat(a.yearly_target || 0), status: a.status, territory: a.territory_name })) };
    });
    return { fiscalYear: fy, members };
  },

  async saveTeamYearlyTargets(targets, abmUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY(); const now = new Date();
    for (const t of targets) {
      await db('ts_yearly_target_assignments').insert({
        fiscal_year_code: fy, assigner_code: abmUser.employeeCode, assigner_role: abmUser.role,
        assignee_code: t.employeeCode, product_code: t.productCode, category_id: t.categoryId,
        yearly_target: t.yearlyTarget, zone_code: abmUser.zoneCode || abmUser.zone_code,
        area_code: abmUser.areaCode || abmUser.area_code, territory_code: t.territoryCode || null,
        status: 'draft', created_at: now, updated_at: now,
      }).onConflict(getKnex().raw("(fiscal_year_code, assigner_code, assignee_code, product_code)"))
        .merge({ yearly_target: t.yearlyTarget, status: 'draft', updated_at: now });
    }
    return { success: true, savedCount: targets.length };
  },

  async getUniqueTbms(abmEmployeeCode) {
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    return directReports.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name }));
  },

  async getDashboardStats(abmEmployeeCode) {
    const activeFy = await getActiveFY();
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    const tbmCodes = directReports.map((r) => r.employee_code);
    const allCodes = [...tbmCodes, abmEmployeeCode];
    const commitments = allCodes.length > 0 ? await db('ts_product_commitments').whereIn('employee_code', allCodes).where('fiscal_year_code', activeFy) : [];
    const totals = aggregateMonthlyTargets(commitments);
    return { totalTbms: tbmCodes.length, totalCommitments: commitments.length,
      pending: commitments.filter((c) => c.status === 'submitted').length,
      approved: commitments.filter((c) => c.status === 'approved').length,
      draft: commitments.filter((c) => c.status === 'draft').length,
      revGrowth: calcGrowth(totals.lyRev, totals.cyRev), qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty) };
  },
};

module.exports = ABMService;

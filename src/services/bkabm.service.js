'use strict';
const { db, getKnex } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const normalizeFY = (fy) => {
  if (!fy) return null;
  if (fy.startsWith('FY')) return fy;          // already 'FY26_27'
  const [a, b] = fy.split('-');                // '2026-27' → ['2026','27']
  if (!a || !b) return fy;
  return 'FY' + a.slice(-2) + '_' + b.slice(-2); // → 'FY26_27'
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

// Normalize dashes/spaces so DB variations (- vs – vs —) all match
const normalizeDash = (s) => (s || '').replace(/[\u2013\u2014\u2012\u2010-]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();

const SPECIALIST_DESIGNATIONS_NORMALIZED = [
  'at iol specialist',
  'at iol manager',
  'equipment manager - surgical systems',
  'equipment specialist - surgical systems',
  'equipment manager - diagnostics & lasers',
  'equipment specialist - diagnostics & lasers',
];

const isSpecialistDesignation = (designation) =>
  SPECIALIST_DESIGNATIONS_NORMALIZED.includes(normalizeDash(designation));

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
        'product_name',      
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
        name: p.display_name || p.product_name || code,
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
      result.push({ employeeCode: tbm.employee_code, fullName: tbm.full_name, designation: tbm.designation, territory: tbm.territory_name, code: tbm.territory_code || '', role: tbm.role,
        salesRepCount: srReports.length, totalCommitments: commitments.length,
        submitted: commitments.filter((c) => c.status === 'submitted').length,
        approved: commitments.filter((c) => c.status === 'approved').length });
    }
    return result;
  },

  async getTeamYearlyTargets(abmEmployeeCode, fiscalYear) {
    const fy = normalizeFY(fiscalYear) || await getActiveFY();
    const directReports = await getAbmDirectReports(abmEmployeeCode);

    // LY is always FY25_26, CY is always FY26_27
    const prevFy = 'FY25_26';

    const tbmDirectReports = directReports.filter((r) => !isSpecialistDesignation(r.designation));
    const tbmCodes = tbmDirectReports.map((r) => r.employee_code);

    // CY assignments saved by this ABM for current FY
    const cyAssignments = await db('ts_yearly_target_assignments')
      .where({ manager_code: abmEmployeeCode, fiscal_year_code: fy })
      .select('assignee_code', 'cy_target_value', 'ly_target_value', 'ly_achieved_value', 'category_name', 'status');

    // Prev FY rows for LY fallback — query by assignee_code since manager_code is NULL on imported rows
    const lyAssignments = tbmCodes.length > 0
      ? await db('ts_yearly_target_assignments')
          .whereIn('assignee_code', tbmCodes)
          .where({ fiscal_year_code: prevFy })
          .select('assignee_code', 'cy_target_value', 'ly_achieved_value', 'category_name')
      : [];

    // Final fallback: sum target_revenue from ts_product_commitments for FY25_26 per TBM
    const lyCommitRows = tbmCodes.length > 0
      ? await db('ts_product_commitments')
          .whereIn('employee_code', tbmCodes)
          .where({ fiscal_year_code: prevFy })
          .groupBy('employee_code')
          .select('employee_code')
          .sum({ lyTargetValue: 'target_revenue', lyTargetQty: 'target_quantity' })
      : [];
    const lyCommitMap = {};
    lyCommitRows.forEach((r) => {
      lyCommitMap[r.employee_code] = parseFloat(r.lyTargetValue || 0);
    });

    const members = tbmDirectReports.map((r) => {
      const cyRows = cyAssignments.filter((a) => a.assignee_code === r.employee_code);
      const lyRows = lyAssignments.filter((a) => a.assignee_code === r.employee_code);

      // Aggregate LY from cy rows first (they carry ly_target_value / ly_achieved_value)
      // Fall back to prev-FY cy_target_value, then to ts_product_commitments FY25_26 data
      const lyTargetValue =
        cyRows.reduce((s, a) => s + parseFloat(a.ly_target_value || 0), 0) ||
        lyRows.reduce((s, a) => s + parseFloat(a.cy_target_value || 0), 0) ||
        lyCommitMap[r.employee_code] || 0;
      const lyAchievedValue =
        cyRows.reduce((s, a) => s + parseFloat(a.ly_achieved_value || 0), 0) ||
        lyRows.reduce((s, a) => s + parseFloat(a.ly_achieved_value || 0), 0);
      const cyTargetValue   = cyRows.reduce((s, a) => s + parseFloat(a.cy_target_value   || 0), 0);

      // Derive status
      const statuses = cyRows.map((a) => a.status).filter(Boolean);
      const status = statuses.length === 0 ? 'not_set'
        : statuses.every((s) => s === 'published') ? 'published' : 'draft';

      // Build category breakdown from CY rows
      const catMap = {};
      cyRows.forEach((a) => {
        const cat = a.category_name || 'Other';
        if (!catMap[cat]) catMap[cat] = { lyTargetValue: 0, lyAchievedValue: 0, cyTargetValue: 0 };
        catMap[cat].lyTargetValue  += parseFloat(a.ly_target_value   || 0);
        catMap[cat].lyAchievedValue += parseFloat(a.ly_achieved_value || 0);
        catMap[cat].cyTargetValue  += parseFloat(a.cy_target_value   || 0);
      });
      // Fallback: populate LY from prev-FY rows when no CY rows exist yet
      if (cyRows.length === 0) {
        lyRows.forEach((a) => {
          const cat = a.category_name || 'Other';
          if (!catMap[cat]) catMap[cat] = { lyTargetValue: 0, lyAchievedValue: 0, cyTargetValue: 0 };
          catMap[cat].lyTargetValue += parseFloat(a.cy_target_value || 0);
        });
      }

      const categoryBreakdown = Object.entries(catMap).map(([name, vals]) => ({
        id:              name.toLowerCase().replace(/[\s-]+/g, '-'),
        name,
        lyTargetValue:   vals.lyTargetValue,
        lyAchievedValue: vals.lyAchievedValue,
        lyTarget:        0,
        lyAchieved:      0,
        cyTargetValue:   vals.cyTargetValue,
        cyTarget:        0,
      }));

      return {
        employeeCode:    r.employee_code,
        fullName:        r.full_name,
        territory:       r.territory_name || r.area_name || '',
        territoryCode:   r.territory_code || '',
        designation:     r.designation    || 'Territory Business Manager',
        lyTargetValue,
        lyAchievedValue,
        lyTarget:        0,
        lyAchieved:      0,
        cyTargetValue,
        cyTarget:        0,
        status,
        lastUpdated:     null,
        categoryBreakdown,
      };
    });
    return { fiscalYear: fy, members };
  },

  async saveTeamYearlyTargets(targets, abmUser, fiscalYear) {
    const fy = normalizeFY(fiscalYear) || await getActiveFY();
    const now = new Date();
    // ts_yearly_target_assignments has no product_code column — one row per assignee.
    for (const t of targets) {
      const yearlyTarget = t.yearlyTarget ?? t.cyTargetValue ?? 0;
      const status       = t.status || 'draft';
      const breakdown    = Array.isArray(t.categoryBreakdown) ? JSON.stringify(t.categoryBreakdown) : '[]';

      const existing = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, manager_code: abmUser.employeeCode, assignee_code: t.employeeCode })
        .first();

      const pubAt = (status === 'published') ? now : (existing ? existing.published_at : null);

      if (existing) {
        await db('ts_yearly_target_assignments')
          .where('id', existing.id)
          .update({
            cy_target_value:    yearlyTarget,
            category_breakdown: breakdown,
            status,
            published_at:       pubAt,
            updated_at:         now,
          });
      } else {
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code:   fy,
          manager_code:       abmUser.employeeCode,
          manager_role:       abmUser.role,
          geo_level:          'territory',
          assignee_code:      t.employeeCode,
          assignee_role:      'Territory Business Manager',
          cy_target_value:    yearlyTarget,
          category_breakdown: breakdown,
          zone_code:          abmUser.zoneCode || abmUser.zone_code,
          area_code:          abmUser.areaCode || abmUser.area_code,
          territory_code:     t.territoryCode || null,
          status,
          published_at:       pubAt,
          created_at:         now,
          updated_at:         now,
        });
      }
    }
    return { success: true, savedCount: targets.length };
  },

  async publishTeamYearlyTargets(memberIds, abmUser, fiscalYear) {
    const fy = normalizeFY(fiscalYear) || await getActiveFY();
    const now = new Date();
    const updated = await db('ts_yearly_target_assignments')
      .where('manager_code',     abmUser.employeeCode)
      .where('fiscal_year_code', fy)
      .whereIn('assignee_code',  memberIds)
      .update({ status: 'published', published_at: now, updated_at: now });
    return { success: true, publishedCount: updated };
  },

  async getUniqueTbms(abmEmployeeCode) {
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    return directReports.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name }));
  },

  async getSpecialistYearlyTargets(abmEmployeeCode, fiscalYear) {
    const fy = normalizeFY(fiscalYear) || 'FY26_27';
    const prevFy = 'FY25_26';
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    const specialistReports = directReports.filter((r) => isSpecialistDesignation(r.designation));
    const specCodes = specialistReports.map((r) => r.employee_code);

    const cyAssignments = specCodes.length > 0
      ? await db('ts_yearly_target_assignments')
          .where({ manager_code: abmEmployeeCode, fiscal_year_code: fy })
          .whereIn('assignee_code', specCodes)
          .select('assignee_code', 'cy_target_value', 'ly_target_value', 'ly_achieved_value', 'category_name', 'status')
      : [];

    const lyAssignments = specCodes.length > 0
      ? await db('ts_yearly_target_assignments')
          .whereIn('assignee_code', specCodes)
          .where({ fiscal_year_code: prevFy })
          .select('assignee_code', 'cy_target_value', 'ly_achieved_value', 'category_name')
      : [];

    const lyCommitRows = specCodes.length > 0
      ? await db('ts_product_commitments')
          .whereIn('employee_code', specCodes)
          .where({ fiscal_year_code: prevFy })
          .groupBy('employee_code')
          .select('employee_code')
          .sum({ lyTargetValue: 'target_revenue', lyTargetQty: 'target_quantity' })
      : [];
    const lyCommitMap = {};
    lyCommitRows.forEach((r) => { lyCommitMap[r.employee_code] = parseFloat(r.lyTargetValue || 0); });

    const members = specialistReports.map((r) => {
      const cyRows = cyAssignments.filter((a) => a.assignee_code === r.employee_code);
      const lyRows = lyAssignments.filter((a) => a.assignee_code === r.employee_code);
      const lyTargetValue =
        cyRows.reduce((s, a) => s + parseFloat(a.ly_target_value || 0), 0) ||
        lyRows.reduce((s, a) => s + parseFloat(a.cy_target_value || 0), 0) ||
        lyCommitMap[r.employee_code] || 0;
      const lyAchievedValue =
        cyRows.reduce((s, a) => s + parseFloat(a.ly_achieved_value || 0), 0) ||
        lyRows.reduce((s, a) => s + parseFloat(a.ly_achieved_value || 0), 0);
      const cyTargetValue = cyRows.reduce((s, a) => s + parseFloat(a.cy_target_value || 0), 0);
      const statuses = cyRows.map((a) => a.status).filter(Boolean);
      const status = statuses.length === 0 ? 'not_set'
        : statuses.every((s) => s === 'published') ? 'published' : 'draft';
      return {
        employeeCode:    r.employee_code,
        fullName:        r.full_name,
        territory:       r.territory_name || r.area_name || '',
        territoryCode:   r.territory_code || '',
        designation:     r.designation,
        lyTargetValue,
        lyAchievedValue,
        lyTarget:        0,
        lyAchieved:      0,
        cyTargetValue,
        cyTarget:        0,
        status,
        lastUpdated:     null,
        categoryBreakdown: [],
      };
    });
    return { fiscalYear: fy, members };
  },

  async saveSpecialistYearlyTargets(targets, abmUser, fiscalYear) {
    const fy = normalizeFY(fiscalYear) || 'FY26_27';
    const now = new Date();
    for (const t of targets) {
      const yearlyTarget = t.yearlyTarget ?? t.cyTargetValue ?? 0;
      const status       = t.status || 'draft';
      const breakdown    = Array.isArray(t.categoryBreakdown) ? JSON.stringify(t.categoryBreakdown) : '[]';
      const existing = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, manager_code: abmUser.employeeCode, assignee_code: t.employeeCode })
        .first();
      const pubAt = (status === 'published') ? now : (existing ? existing.published_at : null);
      if (existing) {
        await db('ts_yearly_target_assignments').where('id', existing.id)
          .update({ cy_target_value: yearlyTarget, category_breakdown: breakdown, status, published_at: pubAt, updated_at: now });
      } else {
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code:   fy,
          manager_code:       abmUser.employeeCode,
          manager_role:       abmUser.role,
          geo_level:          'specialist',
          assignee_code:      t.employeeCode,
          assignee_role:      'Specialist',
          cy_target_value:    yearlyTarget,
          category_breakdown: breakdown,
          zone_code:          abmUser.zoneCode || abmUser.zone_code,
          area_code:          abmUser.areaCode || abmUser.area_code,
          territory_code:     t.territoryCode || null,
          status,
          published_at:       pubAt,
          created_at:         now,
          updated_at:         now,
        });
      }
    }
    return { success: true, savedCount: targets.length };
  },

  async publishSpecialistYearlyTargets(memberIds, abmUser, fiscalYear) {
    const fy = normalizeFY(fiscalYear) || 'FY26_27';
    const now = new Date();
    const updated = await db('ts_yearly_target_assignments')
      .where('manager_code',     abmUser.employeeCode)
      .where('fiscal_year_code', fy)
      .whereIn('assignee_code',  memberIds)
      .update({ status: 'published', published_at: now, updated_at: now });
    return { success: true, publishedCount: updated };
  },

  async getDashboardStats(abmEmployeeCode) {
    const activeFy = await getActiveFY();
    const directReports = await getAbmDirectReports(abmEmployeeCode);
    const tbmCodes = directReports.map((r) => r.employee_code);
    const allCodes = [...tbmCodes, abmEmployeeCode];
    const commitments = allCodes.length > 0 ? await db('ts_product_commitments').whereIn('employee_code', allCodes).where('fiscal_year_code', activeFy) : [];
    const totals = aggregateMonthlyTargets(commitments);
    // Fetch the yearly target set by ZBM for this ABM (stored in cy_target_value)
    const myTargetRows = await db('ts_yearly_target_assignments')
      .where({ assignee_code: abmEmployeeCode, fiscal_year_code: activeFy })
      .sum('cy_target_value as total');
    const myYearlyTarget = parseFloat(myTargetRows[0]?.total || 0);
    return { totalTbms: tbmCodes.length, totalCommitments: commitments.length,
      pending: commitments.filter((c) => c.status === 'submitted').length,
      approved: commitments.filter((c) => c.status === 'approved').length,
      draft: commitments.filter((c) => c.status === 'draft').length,
      revGrowth: calcGrowth(totals.lyRev, totals.cyRev), qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty),
      myYearlyTarget };
  },
};

module.exports = ABMService;

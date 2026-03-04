/**
 * abm.service.js — Area Business Manager Service (v5)
 * ABM reviews TBM submissions, manages area-level targets, team members/yearly targets.
 */
'use strict';
const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const ABMService = {
  // GET /abm/tbm-submissions
  async getTbmSubmissions(abmEmployeeCode, filters = {}) {
    const directReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`, [abmEmployeeCode]);
    const tbmCodes = directReports.rows.map((r) => r.employee_code);
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

  // PUT /abm/approve-tbm/:id
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

  // POST /abm/reject-tbm/:id
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

  // POST /abm/bulk-approve-tbm
  async bulkApproveTbm(submissionIds, abmUser, comments = '') {
    const directReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`, [abmUser.employeeCode]);
    const tbmCodes = directReports.rows.map((r) => r.employee_code);
    const commitments = await db('ts_product_commitments').whereIn('id', submissionIds).where('status', 'submitted').whereIn('employee_code', tbmCodes);
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions.'), { status: 400 });
    const ids = commitments.map((c) => c.id); const now = new Date();
    await db('ts_product_commitments').whereIn('id', ids).update({ status: 'approved', approved_at: now, approved_by_code: abmUser.employeeCode });
    await db('ts_commitment_approvals').insert(ids.map((id) => ({ commitment_id: id, action: 'bulk_approved', actor_code: abmUser.employeeCode, actor_role: abmUser.role, comments })));
    return { success: true, approvedCount: ids.length };
  },

  // GET /abm/area-targets
  async getAreaTargets(abmUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    return GeographyService.getGeographyTargets('area', abmUser.areaCode || abmUser.area_code, fy);
  },

  // PUT /abm/area-targets/:id/save
  async saveAreaTarget(targetId, monthlyTargets, abmUser) {
    const target = await db('ts_geography_targets').where({ id: targetId }).first();
    if (!target) throw Object.assign(new Error('Target not found.'), { status: 404 });
    await db('ts_geography_targets').where({ id: targetId }).update({ monthly_targets: JSON.stringify(monthlyTargets), set_by_code: abmUser.employeeCode, set_by_role: abmUser.role, status: 'draft', updated_at: new Date() });
    return { success: true, targetId };
  },

  // POST /abm/area-targets/save
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
      }).onConflict(db.raw("(fiscal_year_code, geo_level, zone_code, COALESCE(area_code,''), COALESCE(territory_code,''), product_code)"))
        .merge({ monthly_targets: JSON.stringify(t.monthlyTargets || {}), set_by_code: abmUser.employeeCode, set_by_role: abmUser.role, status: 'draft', updated_at: new Date() });
    }
    return { success: true, savedCount: targets.length };
  },

  // POST /abm/area-targets/submit
  async submitAreaTargets(targetIds, abmUser) {
    const now = new Date();
    const updated = await db('ts_geography_targets').whereIn('id', targetIds).where('status', 'draft').update({ status: 'published', published_at: now, updated_at: now });
    return { success: true, submittedCount: updated };
  },

  // GET /abm/team-members
  async getTeamMembers(abmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, territory_name, role FROM aop.ts_fn_get_direct_reports(?)`, [abmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name, role: r.role }));
  },

  // GET /abm/tbm-hierarchy
  async getTbmHierarchy(abmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, territory_name, role FROM aop.ts_fn_get_direct_reports(?)`, [abmEmployeeCode]);
    const activeFy = await getActiveFY(); const result = [];
    for (const tbm of directReports.rows) {
      const srReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`, [tbm.employee_code]);
      const commitments = await db('ts_product_commitments').where({ employee_code: tbm.employee_code, fiscal_year_code: activeFy });
      result.push({ employeeCode: tbm.employee_code, fullName: tbm.full_name, designation: tbm.designation, territory: tbm.territory_name, role: tbm.role,
        salesRepCount: srReports.rows.length, totalCommitments: commitments.length,
        submitted: commitments.filter((c) => c.status === 'submitted').length,
        approved: commitments.filter((c) => c.status === 'approved').length });
    }
    return result;
  },

  // GET /abm/team-yearly-targets
  async getTeamYearlyTargets(abmEmployeeCode, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    const directReports = await db.raw(`SELECT employee_code, full_name FROM aop.ts_fn_get_direct_reports(?)`, [abmEmployeeCode]);
    const assignments = await db('ts_yearly_target_assignments AS yta').leftJoin('ts_auth_users AS u', 'u.employee_code', 'yta.assignee_code')
      .where('yta.assigner_code', abmEmployeeCode).where('yta.fiscal_year_code', fy)
      .select('yta.*', 'u.full_name AS assignee_name', 'u.territory_name');
    const members = directReports.rows.map((r) => {
      const memberTargets = assignments.filter((a) => a.assignee_code === r.employee_code);
      return { employeeCode: r.employee_code, fullName: r.full_name,
        targets: memberTargets.map((a) => ({ id: a.id, productCode: a.product_code, categoryId: a.category_id, yearlyTarget: parseFloat(a.yearly_target || 0), status: a.status, territory: a.territory_name })) };
    });
    return { fiscalYear: fy, members };
  },

  // POST /abm/team-yearly-targets/save
  async saveTeamYearlyTargets(targets, abmUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY(); const now = new Date();
    for (const t of targets) {
      await db('ts_yearly_target_assignments').insert({
        fiscal_year_code: fy, assigner_code: abmUser.employeeCode, assigner_role: abmUser.role,
        assignee_code: t.employeeCode, product_code: t.productCode, category_id: t.categoryId,
        yearly_target: t.yearlyTarget, zone_code: abmUser.zoneCode || abmUser.zone_code,
        area_code: abmUser.areaCode || abmUser.area_code, territory_code: t.territoryCode || null,
        status: 'draft', created_at: now, updated_at: now,
      }).onConflict(db.raw("(fiscal_year_code, assigner_code, assignee_code, product_code)"))
        .merge({ yearly_target: t.yearlyTarget, status: 'draft', updated_at: now });
    }
    return { success: true, savedCount: targets.length };
  },

  // GET /abm/unique-tbms
  async getUniqueTbms(abmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, territory_name FROM aop.ts_fn_get_direct_reports(?)`, [abmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name }));
  },

  // GET /abm/dashboard-stats
  async getDashboardStats(abmEmployeeCode) {
    const activeFy = await getActiveFY();
    const directReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`, [abmEmployeeCode]);
    const tbmCodes = directReports.rows.map((r) => r.employee_code);
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

/**
 * zbm.service.js — Zonal Business Manager Service (v5)
 * ZBM reviews ABM submissions, manages zone-level targets, team members/yearly targets.
 */
'use strict';
const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const ZBMService = {
  // GET /zbm/abm-submissions
  async getAbmSubmissions(zbmEmployeeCode, filters = {}) {
    const subordinates = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_subordinates(?)`, [zbmEmployeeCode]);
    const subCodes = subordinates.rows.map((r) => r.employee_code);
    if (subCodes.length === 0) return [];
    const activeFy = filters.fy || await getActiveFY();
    let query = db('ts_product_commitments AS pc')
      .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
      .leftJoin('ts_auth_users AS u', 'u.employee_code', 'pc.employee_code')
      .whereIn('pc.employee_code', subCodes)
      .where('pc.fiscal_year_code', activeFy);
    if (filters.status) { query = query.where('pc.status', filters.status); }
    else { query = query.whereIn('pc.status', ['submitted', 'approved']); }
    const rows = await query.select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.quota_price__c AS unit_cost',
      'u.full_name AS employee_name', 'u.role AS employee_role').orderBy('u.full_name').orderBy('pm.product_name');
    return rows.map(formatCommitment);
  },

  // PUT /zbm/approve-abm/:id
  async approveAbm(commitmentId, zbmUser, { comments = '', corrections = null } = {}) {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only approve 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    const now = new Date(); let action = 'approved'; let originalValues = null;
    if (corrections && Object.keys(corrections).length > 0) {
      originalValues = { ...commitment.monthly_targets };
      const updated = { ...commitment.monthly_targets };
      for (const [month, values] of Object.entries(corrections)) { if (updated[month]) updated[month] = { ...updated[month], ...values }; }
      await db('ts_product_commitments').where({ id: commitmentId }).update({ monthly_targets: JSON.stringify(updated) });
      action = 'corrected_and_approved';
    }
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'approved', approved_at: now, approved_by_code: zbmUser.employeeCode });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action, actor_code: zbmUser.employeeCode, actor_role: zbmUser.role, corrections: corrections ? JSON.stringify(corrections) : null, original_values: originalValues ? JSON.stringify(originalValues) : null, comments });
    return { success: true, submissionId: commitmentId, action };
  },

  // POST /zbm/reject-abm/:id
  async rejectAbm(commitmentId, zbmUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only reject 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft', updated_at: new Date() });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'rejected', actor_code: zbmUser.employeeCode, actor_role: zbmUser.role, comments: reason });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },

  // POST /zbm/bulk-approve-abm
  async bulkApproveAbm(submissionIds, zbmUser, comments = '') {
    const subordinates = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_subordinates(?)`, [zbmUser.employeeCode]);
    const subCodes = subordinates.rows.map((r) => r.employee_code);
    const commitments = await db('ts_product_commitments').whereIn('id', submissionIds).where('status', 'submitted').whereIn('employee_code', subCodes);
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions.'), { status: 400 });
    const ids = commitments.map((c) => c.id); const now = new Date();
    await db('ts_product_commitments').whereIn('id', ids).update({ status: 'approved', approved_at: now, approved_by_code: zbmUser.employeeCode });
    await db('ts_commitment_approvals').insert(ids.map((id) => ({ commitment_id: id, action: 'bulk_approved', actor_code: zbmUser.employeeCode, actor_role: zbmUser.role, comments })));
    return { success: true, approvedCount: ids.length };
  },

  // GET /zbm/zone-targets
  async getZoneTargets(zbmUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    return GeographyService.getGeographyTargets('zone', zbmUser.zoneCode || zbmUser.zone_code, fy);
  },

  // GET /zbm/abm-hierarchy
  async getAbmHierarchy(zbmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, area_name, role FROM aop.ts_fn_get_direct_reports(?)`, [zbmEmployeeCode]);
    const activeFy = await getActiveFY(); const result = [];
    for (const abm of directReports.rows) {
      const subReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_subordinates(?)`, [abm.employee_code]);
      const commitments = await db('ts_product_commitments').whereIn('employee_code', subReports.rows.map(r => r.employee_code).concat(abm.employee_code)).where('fiscal_year_code', activeFy);
      result.push({ employeeCode: abm.employee_code, fullName: abm.full_name, designation: abm.designation, area: abm.area_name, role: abm.role,
        subordinateCount: subReports.rows.length, totalCommitments: commitments.length,
        submitted: commitments.filter((c) => c.status === 'submitted').length,
        approved: commitments.filter((c) => c.status === 'approved').length });
    }
    return result;
  },

  // GET /zbm/team-members
  async getTeamMembers(zbmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, area_name, role FROM aop.ts_fn_get_direct_reports(?)`, [zbmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, area: r.area_name, role: r.role }));
  },

  // GET /zbm/team-yearly-targets
  async getTeamYearlyTargets(zbmEmployeeCode, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    const directReports = await db.raw(`SELECT employee_code, full_name FROM aop.ts_fn_get_direct_reports(?)`, [zbmEmployeeCode]);
    const assignments = await db('ts_yearly_target_assignments AS yta').leftJoin('ts_auth_users AS u', 'u.employee_code', 'yta.assignee_code')
      .where('yta.assigner_code', zbmEmployeeCode).where('yta.fiscal_year_code', fy)
      .select('yta.*', 'u.full_name AS assignee_name', 'u.area_name');
    const members = directReports.rows.map((r) => {
      const memberTargets = assignments.filter((a) => a.assignee_code === r.employee_code);
      return { employeeCode: r.employee_code, fullName: r.full_name,
        targets: memberTargets.map((a) => ({ id: a.id, productCode: a.product_code, categoryId: a.category_id, yearlyTarget: parseFloat(a.yearly_target || 0), status: a.status, area: a.area_name })) };
    });
    return { fiscalYear: fy, members };
  },

  // POST /zbm/team-yearly-targets/save
  async saveTeamYearlyTargets(targets, zbmUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY(); const now = new Date();
    for (const t of targets) {
      await db('ts_yearly_target_assignments').insert({
        fiscal_year_code: fy, assigner_code: zbmUser.employeeCode, assigner_role: zbmUser.role,
        assignee_code: t.employeeCode, product_code: t.productCode, category_id: t.categoryId,
        yearly_target: t.yearlyTarget, zone_code: zbmUser.zoneCode || zbmUser.zone_code,
        area_code: t.areaCode || null, status: 'draft', created_at: now, updated_at: now,
      }).onConflict(db.raw("(fiscal_year_code, assigner_code, assignee_code, product_code)"))
        .merge({ yearly_target: t.yearlyTarget, status: 'draft', updated_at: now });
    }
    return { success: true, savedCount: targets.length };
  },

  // GET /zbm/dashboard-stats
  async getDashboardStats(zbmEmployeeCode) {
    const activeFy = await getActiveFY();
    const subordinates = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_subordinates(?)`, [zbmEmployeeCode]);
    const subCodes = subordinates.rows.map((r) => r.employee_code);
    const allCodes = [...subCodes, zbmEmployeeCode];
    const commitments = allCodes.length > 0 ? await db('ts_product_commitments').whereIn('employee_code', allCodes).where('fiscal_year_code', activeFy) : [];
    const totals = aggregateMonthlyTargets(commitments);
    const directReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`, [zbmEmployeeCode]);
    return { totalAbms: directReports.rows.length, totalCommitments: commitments.length,
      pending: commitments.filter((c) => c.status === 'submitted').length,
      approved: commitments.filter((c) => c.status === 'approved').length,
      draft: commitments.filter((c) => c.status === 'draft').length,
      revGrowth: calcGrowth(totals.lyRev, totals.cyRev), qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty) };
  },

  // GET /zbm/unique-abms
  async getUniqueAbms(zbmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, area_name FROM aop.ts_fn_get_direct_reports(?)`, [zbmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, area: r.area_name }));
  },
};

module.exports = ZBMService;

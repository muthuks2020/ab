/**
 * saleshead.service.js — Sales Head Service (v5)
 * SH reviews ZBM submissions, manages zone-level geography targets, team yearly targets.
 */
'use strict';
const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth, MONTHS } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const SalesHeadService = {
  // GET /saleshead/zbm-submissions
  async getZbmSubmissions(filters = {}) {
    const activeFy = filters.fy || await getActiveFY();
    let query = db('ts_product_commitments AS pc')
      .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
      .leftJoin('ts_auth_users AS u', 'u.employee_code', 'pc.employee_code')
      .where('pc.fiscal_year_code', activeFy);
    if (filters.status) { query = query.where('pc.status', filters.status); }
    else { query = query.whereIn('pc.status', ['submitted', 'approved']); }
    if (filters.zoneCode) query = query.where('pc.zone_code', filters.zoneCode);
    if (filters.employeeCode) query = query.where('pc.employee_code', filters.employeeCode);
    const rows = await query.select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.quota_price__c AS unit_cost',
      'u.full_name AS employee_name', 'u.role AS employee_role').orderBy('u.full_name').orderBy('pm.product_name');
    return rows.map(formatCommitment);
  },

  // PUT /saleshead/approve-zbm/:id
  async approveZbm(commitmentId, shUser, { comments = '', corrections = null } = {}) {
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
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'approved', approved_at: now, approved_by_code: shUser.employeeCode });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action, actor_code: shUser.employeeCode, actor_role: shUser.role, corrections: corrections ? JSON.stringify(corrections) : null, original_values: originalValues ? JSON.stringify(originalValues) : null, comments });
    return { success: true, submissionId: commitmentId, action };
  },

  // POST /saleshead/reject-zbm/:id
  async rejectZbm(commitmentId, shUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only reject 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft', updated_at: new Date() });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'rejected', actor_code: shUser.employeeCode, actor_role: shUser.role, comments: reason });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },

  // POST /saleshead/bulk-approve-zbm
  async bulkApproveZbm(submissionIds, shUser, comments = '') {
    const commitments = await db('ts_product_commitments').whereIn('id', submissionIds).where('status', 'submitted');
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions.'), { status: 400 });
    const ids = commitments.map((c) => c.id); const now = new Date();
    await db('ts_product_commitments').whereIn('id', ids).update({ status: 'approved', approved_at: now, approved_by_code: shUser.employeeCode });
    await db('ts_commitment_approvals').insert(ids.map((id) => ({ commitment_id: id, action: 'bulk_approved', actor_code: shUser.employeeCode, actor_role: shUser.role, comments })));
    return { success: true, approvedCount: ids.length };
  },

  // GET /saleshead/zbm-hierarchy
  async getZbmHierarchy(shEmployeeCode) {
    const subordinates = await db.raw(`SELECT employee_code, full_name, designation, zone_name, role FROM aop.ts_fn_get_subordinates(?)`, [shEmployeeCode]);
    const zbms = subordinates.rows.filter((r) => r.role === 'zbm');
    const activeFy = await getActiveFY(); const result = [];
    for (const zbm of zbms) {
      const zbmSubs = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_subordinates(?)`, [zbm.employee_code]);
      const allCodes = zbmSubs.rows.map(r => r.employee_code).concat(zbm.employee_code);
      const commitments = await db('ts_product_commitments').whereIn('employee_code', allCodes).where('fiscal_year_code', activeFy);
      result.push({ employeeCode: zbm.employee_code, fullName: zbm.full_name, designation: zbm.designation, zone: zbm.zone_name, role: zbm.role,
        subordinateCount: zbmSubs.rows.length, totalCommitments: commitments.length,
        submitted: commitments.filter((c) => c.status === 'submitted').length,
        approved: commitments.filter((c) => c.status === 'approved').length });
    }
    return result;
  },

  // GET /saleshead/team-members
  async getTeamMembers(shEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, zone_name, role FROM aop.ts_fn_get_direct_reports(?)`, [shEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, zone: r.zone_name, role: r.role }));
  },

  // GET /saleshead/team-yearly-targets
  async getTeamYearlyTargets(shEmployeeCode, fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    const directReports = await db.raw(`SELECT employee_code, full_name FROM aop.ts_fn_get_direct_reports(?)`, [shEmployeeCode]);
    const assignments = await db('ts_yearly_target_assignments AS yta').leftJoin('ts_auth_users AS u', 'u.employee_code', 'yta.assignee_code')
      .where('yta.assigner_code', shEmployeeCode).where('yta.fiscal_year_code', fy)
      .select('yta.*', 'u.full_name AS assignee_name', 'u.zone_name');
    const members = directReports.rows.map((r) => {
      const memberTargets = assignments.filter((a) => a.assignee_code === r.employee_code);
      return { employeeCode: r.employee_code, fullName: r.full_name,
        targets: memberTargets.map((a) => ({ id: a.id, productCode: a.product_code, categoryId: a.category_id, yearlyTarget: parseFloat(a.yearly_target || 0), status: a.status, zone: a.zone_name })) };
    });
    return { fiscalYear: fy, members };
  },

  // POST /saleshead/team-yearly-targets/save
  async saveTeamYearlyTargets(targets, shUser, fiscalYear) {
    const fy = fiscalYear || await getActiveFY(); const now = new Date();
    for (const t of targets) {
      await db('ts_yearly_target_assignments').insert({
        fiscal_year_code: fy, assigner_code: shUser.employeeCode, assigner_role: shUser.role,
        assignee_code: t.employeeCode, product_code: t.productCode, category_id: t.categoryId,
        yearly_target: t.yearlyTarget, zone_code: t.zoneCode || null, status: 'draft', created_at: now, updated_at: now,
      }).onConflict(db.raw("(fiscal_year_code, assigner_code, assignee_code, product_code)"))
        .merge({ yearly_target: t.yearlyTarget, status: 'draft', updated_at: now });
    }
    return { success: true, savedCount: targets.length };
  },

  // GET /saleshead/unique-zbms
  async getUniqueZbms(shEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, zone_name FROM aop.ts_fn_get_direct_reports(?)`, [shEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, zone: r.zone_name }));
  },

  // GET /saleshead/dashboard-stats
  async getDashboardStats(shEmployeeCode) {
    const activeFy = await getActiveFY();
    const commitments = await db('ts_product_commitments').where('fiscal_year_code', activeFy);
    const totals = aggregateMonthlyTargets(commitments);
    const zbms = await db('ts_auth_users').where({ role: 'zbm', is_active: true });
    return { totalZbms: zbms.length, totalCommitments: commitments.length,
      pending: commitments.filter((c) => c.status === 'submitted').length,
      approved: commitments.filter((c) => c.status === 'approved').length,
      draft: commitments.filter((c) => c.status === 'draft').length,
      revGrowth: calcGrowth(totals.lyRev, totals.cyRev), qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty) };
  },

  // GET /saleshead/regional-performance
  async getRegionalPerformance() {
    const activeFy = await getActiveFY();
    const zones = await db('ts_product_commitments').where('fiscal_year_code', activeFy).whereNotNull('zone_code')
      .select('zone_code', 'zone_name').groupBy('zone_code', 'zone_name');
    const result = [];
    for (const z of zones) {
      const commitments = await db('ts_product_commitments').where({ fiscal_year_code: activeFy, zone_code: z.zone_code });
      const totals = aggregateMonthlyTargets(commitments);
      result.push({ zoneCode: z.zone_code, zoneName: z.zone_name, totalCommitments: commitments.length,
        approved: commitments.filter((c) => c.status === 'approved').length,
        lyRev: totals.lyRev, cyRev: totals.cyRev, revGrowth: calcGrowth(totals.lyRev, totals.cyRev) });
    }
    return result;
  },

  // GET /saleshead/monthly-trend
  async getMonthlyTrend(fiscalYear) {
    const fy = fiscalYear || await getActiveFY();
    const commitments = await db('ts_product_commitments').where({ fiscal_year_code: fy, status: 'approved' });
    const trend = MONTHS.map((m) => {
      let lyRev = 0, cyRev = 0, lyQty = 0, cyQty = 0;
      for (const c of commitments) { const mt = c.monthly_targets || {}; const d = mt[m] || {};
        lyRev += Number(d.lyRev || 0); cyRev += Number(d.cyRev || 0); lyQty += Number(d.lyQty || 0); cyQty += Number(d.cyQty || 0); }
      return { month: m, lyRev, cyRev, lyQty, cyQty, revGrowth: calcGrowth(lyRev, cyRev) };
    });
    return trend;
  },

  // POST /saleshead/geography-targets
  async setGeographyTargets(shUser, geoData) {
    return GeographyService.setGeographyTargets(geoData.geoLevel || 'zone', geoData.geoCode, geoData.geoName, geoData.fiscalYear, geoData.targets, shUser.employeeCode);
  },

  // GET /saleshead/categories — delegate to common
  async getCategories(role) {
    const rows = await db('ts_product_categories AS c')
      .join('ts_role_product_access AS rpa', 'rpa.category_id', 'c.id')
      .where('rpa.role', role || 'sales_head')
      .where('c.is_active', true)
      .select('c.*');
    return rows;
  },

  // GET /saleshead/analytics/distribution — zone-wise distribution of commitments
  async getAnalyticsDistribution(filters = {}) {
    const activeFy = filters.fy || await getActiveFY();
    const rows = await db('ts_product_commitments').where('fiscal_year_code', activeFy)
      .whereNotNull('zone_code').select('zone_code', 'zone_name')
      .count('id as total').sum(db.raw("(monthly_targets->>'apr'->>'cyRev')::numeric as revenue"))
      .groupBy('zone_code', 'zone_name');
    return rows.length > 0 ? rows : await db('ts_product_commitments').where('fiscal_year_code', activeFy)
      .whereNotNull('zone_code').select('zone_code', 'zone_name').groupBy('zone_code', 'zone_name');
  },

  // GET /saleshead/analytics/comparison — zone-wise LY vs CY comparison
  async getAnalyticsComparison(filters = {}) {
    const activeFy = filters.fy || await getActiveFY();
    const zones = await db('ts_product_commitments').where('fiscal_year_code', activeFy).whereNotNull('zone_code')
      .select('zone_code', 'zone_name').groupBy('zone_code', 'zone_name');
    const result = [];
    for (const z of zones) {
      const commitments = await db('ts_product_commitments').where({ fiscal_year_code: activeFy, zone_code: z.zone_code });
      const totals = aggregateMonthlyTargets(commitments);
      result.push({ zoneCode: z.zone_code, zoneName: z.zone_name, lyRev: totals.lyRev, cyRev: totals.cyRev, lyQty: totals.lyQty, cyQty: totals.cyQty, growth: calcGrowth(totals.lyRev, totals.cyRev) });
    }
    return result;
  },

  // GET /saleshead/analytics/achievement — achievement rate per zone
  async getAnalyticsAchievement(filters = {}) {
    const activeFy = filters.fy || await getActiveFY();
    const zones = await db('ts_product_commitments').where('fiscal_year_code', activeFy).whereNotNull('zone_code')
      .select('zone_code', 'zone_name').groupBy('zone_code', 'zone_name');
    const result = [];
    for (const z of zones) {
      const total = await db('ts_product_commitments').where({ fiscal_year_code: activeFy, zone_code: z.zone_code }).count('id as count').first();
      const approved = await db('ts_product_commitments').where({ fiscal_year_code: activeFy, zone_code: z.zone_code, status: 'approved' }).count('id as count').first();
      result.push({ zoneCode: z.zone_code, zoneName: z.zone_name, total: parseInt(total.count), approved: parseInt(approved.count), achievementRate: parseInt(total.count) > 0 ? Math.round((parseInt(approved.count) / parseInt(total.count)) * 100) : 0 });
    }
    return result;
  },
};

module.exports = SalesHeadService;

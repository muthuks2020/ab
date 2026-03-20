'use strict';
const { db, getKnex } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth, MONTHS } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).orderBy('code', 'desc').first();
  console.log('[getActiveFY] resolved FY:', fy?.code);
  return fy?.code || 'FY26_27';
};

const SalesHeadService = {

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

  async rejectZbm(commitmentId, shUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only reject 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft', updated_at: new Date() });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'rejected', actor_code: shUser.employeeCode, actor_role: shUser.role, comments: reason });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },

  async bulkApproveZbm(submissionIds, shUser, comments = '') {
    const commitments = await db('ts_product_commitments').whereIn('id', submissionIds).where('status', 'submitted');
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions.'), { status: 400 });
    const ids = commitments.map((c) => c.id); const now = new Date();
    await db('ts_product_commitments').whereIn('id', ids).update({ status: 'approved', approved_at: now, approved_by_code: shUser.employeeCode });
    await db('ts_commitment_approvals').insert(ids.map((id) => ({ commitment_id: id, action: 'bulk_approved', actor_code: shUser.employeeCode, actor_role: shUser.role, comments })));
    return { success: true, approvedCount: ids.length };
  },

  async getZbmHierarchy(shEmployeeCode) {
    console.log('[getZbmHierarchy] building nested hierarchy for:', shEmployeeCode);
    const activeFy = await getActiveFY();
    console.log('[getZbmHierarchy] activeFy:', activeFy);

    const getDirectReports = async (empCode) => {
      const res = await getKnex().raw(
        `SELECT employee_code, full_name, designation, zone_name, area_name, territory_name, role
         FROM aop.ts_auth_users WHERE reports_to = ? AND is_active = true`,
        [empCode]
      );
      return res.rows;
    };

    const getRepCommitments = async (empCode) => {
      const rows = await db('ts_product_commitments AS pc')
        .leftJoin('product_master AS pm', 'pm.productcode', 'pc.product_code')
        .where('pc.employee_code', empCode)
        .where('pc.fiscal_year_code', activeFy)
        .select('pc.id', 'pc.product_code', 'pc.monthly_targets', 'pc.status',
          'pm.product_name', 'pm.product_category');
      return rows.map(r => ({
        productId: r.product_code,
        productName: r.product_name || r.product_code,
        category: r.product_category,
        status: r.status,
        monthlyTargets: r.monthly_targets || {},
      }));
    };

    const ZBM_ROLES = ['zbm', 'zonal business manager', 'zonal_business_manager', 'zonal manager'];
    const ABM_ROLES = ['abm', 'area business manager', 'area_business_manager', 'area manager'];
    const TBM_ROLES = ['tbm', 'territory business manager', 'territory_business_manager', 'territory manager'];
    const SR_ROLES  = ['sales_rep', 'sales rep', 'sr', 'sales representative', 'sales_representative',
                       'equipment specialist - surgical systems', 'equipment specialist- surgical systems'];
    const isRole = (role, list) => list.includes((role || '').toLowerCase().trim());

    const shDirectReports = await getDirectReports(shEmployeeCode);
    console.log('[getZbmHierarchy] SH direct reports:', shDirectReports.length,
      shDirectReports.map(r => `${r.employee_code}:${r.role}`));

    const zbmRows = shDirectReports.filter(r => isRole(r.role, ZBM_ROLES));
    console.log('[getZbmHierarchy] ZBMs found:', zbmRows.length);

    const result = [];
    for (const zbm of zbmRows) {
      const abmRows = await getDirectReports(zbm.employee_code);
      console.log(`[getZbmHierarchy] ZBM ${zbm.employee_code} ABMs:`, abmRows.length);

      const abms = [];
      for (const abm of abmRows.filter(r => isRole(r.role, ABM_ROLES))) {
        const tbmRows = await getDirectReports(abm.employee_code);
        console.log(`[getZbmHierarchy] ABM ${abm.employee_code} TBMs:`, tbmRows.length);

        const tbms = [];
        for (const tbm of tbmRows.filter(r => isRole(r.role, TBM_ROLES))) {
          const srRows = await getDirectReports(tbm.employee_code);
          console.log(`[getZbmHierarchy] TBM ${tbm.employee_code} SRs:`, srRows.length);

          const salesReps = [];
          for (const sr of srRows.filter(r => isRole(r.role, SR_ROLES))) {
            const products = await getRepCommitments(sr.employee_code);
            salesReps.push({
              id: sr.employee_code,
              employeeCode: sr.employee_code,
              name: sr.full_name,
              fullName: sr.full_name,
              designation: sr.designation,
              territory: sr.territory_name || sr.area_name || sr.zone_name,
              zone: sr.zone_name,
              products,
            });
          }

          tbms.push({
            id: tbm.employee_code,
            employeeCode: tbm.employee_code,
            name: tbm.full_name,
            fullName: tbm.full_name,
            designation: tbm.designation,
            territory: tbm.area_name || tbm.zone_name,
            zone: tbm.zone_name,
            salesReps,
          });
        }

        abms.push({
          id: abm.employee_code,
          employeeCode: abm.employee_code,
          name: abm.full_name,
          fullName: abm.full_name,
          designation: abm.designation,
          territory: abm.area_name || abm.zone_name,
          zone: abm.zone_name,
          tbms,
        });
      }

      result.push({
        id: zbm.employee_code,
        employeeCode: zbm.employee_code,
        name: zbm.full_name,
        fullName: zbm.full_name,
        designation: zbm.designation,
        territory: zbm.zone_name,
        zone: zbm.zone_name,
        abms,
      });
    }

    console.log('[getZbmHierarchy] final result:', result.length, 'ZBMs');
    return result;
  },

  async getTeamMembers(shEmployeeCode) {
    const directReports = await getKnex().raw(`SELECT employee_code, full_name, designation, zone_name, role FROM aop.ts_fn_get_direct_reports(?)`, [shEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, zone: r.zone_name, role: r.role }));
  },

  async getTeamYearlyTargets(shEmployeeCode, fiscalYear) {
    // CY is always FY26_27, LY is always FY25_26 — never derive dynamically
    const fy     = 'FY26_27';
    const prevFy = 'FY25_26';
    console.log('[getTeamYearlyTargets] shEmployeeCode:', shEmployeeCode, 'fy:', fy, 'prevFy:', prevFy);

    const directReports = await getKnex().raw(
      `SELECT employee_code, full_name, zone_name, zone_code, designation
       FROM aop.ts_auth_users WHERE reports_to = ? AND is_active = true`,
      [shEmployeeCode]
    );
    console.log('[getTeamYearlyTargets] direct reports:', directReports.rows.length);

    const members = [];
    for (const zbm of directReports.rows) {

      const assignment = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, manager_code: shEmployeeCode, assignee_code: zbm.employee_code })
        .first();

      let lyTargetValue   = parseFloat(assignment?.ly_target_value   || 0);
      let lyAchievedValue = parseFloat(assignment?.ly_achieved_value  || 0);

      if (!lyTargetValue && prevFy) {
        // In FY25_26, the ZBM was the assignee — query by assignee_code, not manager_code
        const lyResult = await db('ts_yearly_target_assignments')
          .where({ fiscal_year_code: prevFy, assignee_code: zbm.employee_code })
          .sum({ totalRev: 'cy_target_value' })
          .first();
        lyTargetValue = parseFloat(lyResult?.totalRev) || 0;

        if (!lyTargetValue && zbm.zone_code) {
          const lyCommit = await db('ts_product_commitments')
            .where({ fiscal_year_code: prevFy, zone_code: zbm.zone_code })
            .sum({ totalRev: 'target_revenue' })
            .first();
          lyTargetValue = parseFloat(lyCommit?.totalRev) || 0;
        }
      }

      if (!lyAchievedValue && prevFy) {
        // In FY25_26, the ZBM was the assignee — query by assignee_code, not manager_code
        const lyAch = await db('ts_yearly_target_assignments')
          .where({ fiscal_year_code: prevFy, assignee_code: zbm.employee_code })
          .sum({ totalAchRev: 'ly_achieved_value' })
          .first();
        lyAchievedValue = parseFloat(lyAch?.totalAchRev) || 0;
      }

      if (assignment && (lyTargetValue > 0 || lyAchievedValue > 0)) {
        await db('ts_yearly_target_assignments')
          .where({ id: assignment.id })
          .update({ ly_target_value: lyTargetValue, ly_achieved_value: lyAchievedValue, updated_at: new Date() });
      }

      members.push({
        employeeCode:  zbm.employee_code,
        fullName:      zbm.full_name,
        zone:          zbm.zone_name,
        designation:   zbm.designation,
        lyTarget:      lyTargetValue,
        lyAchieved:    lyAchievedValue,
        cyTargetValue: parseFloat(assignment?.cy_target_value || 0),
        status:        assignment?.status || 'not_set',
        assignmentId:  assignment?.id || null,
      });
    }

    console.log('[getTeamYearlyTargets] members built:', members.length);
    return { fiscalYear: fy, members };
  },

  async saveTeamYearlyTargets(targets, shUser, fiscalYear) {
    const fy = 'FY26_27'; // CY is always FY26_27
    const now = new Date();
    console.log('[saveTeamYearlyTargets] saving', targets.length, 'targets for fy:', fy);
    for (const t of targets) {
      const assignee = await db('ts_auth_users').where({ employee_code: t.employeeCode }).first();
      const existing = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, manager_code: shUser.employeeCode, assignee_code: t.employeeCode })
        .first();
      const targetStatus = t.status || 'draft';
      if (existing) {
        await db('ts_yearly_target_assignments').where({ id: existing.id }).update({
          cy_target_value: t.yearlyTarget || 0,
          status: targetStatus,
          updated_at: now,
          ...(targetStatus === 'published' ? { published_at: now } : {}),
        });
      } else {
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code: fy,
          manager_code: shUser.employeeCode,
          manager_role: shUser.role,
          assignee_code: t.employeeCode,
          assignee_role: assignee?.role || 'zbm',
          geo_level: 'zone',
          zone_code: assignee?.zone_code || null,
          zone_name: assignee?.zone_name || null,
          cy_target_value: t.yearlyTarget || 0,
          cy_target_qty: 0,
          ly_target_value: 0,
          ly_achieved_value: 0,
          status: targetStatus,
          ...(targetStatus === 'published' ? { published_at: now } : {}),
          created_at: now,
          updated_at: now,
        });
      }
    }
    return { success: true, savedCount: targets.length };
  },

  async getUniqueZbms(shEmployeeCode) {
    console.log('[getUniqueZbms] called for:', shEmployeeCode);
    const directReports = await getKnex().raw(
      `SELECT employee_code, full_name, designation, zone_name
       FROM aop.ts_auth_users WHERE reports_to = ? AND is_active = true`,
      [shEmployeeCode]
    );
    console.log('[getUniqueZbms] found:', directReports.rows.length);
    return directReports.rows.map((r) => ({
      employeeCode: r.employee_code,
      fullName: r.full_name,
      designation: r.designation,
      zone: r.zone_name,
    }));
  },

  async getDashboardStats(shEmployeeCode) {
    console.log('[getDashboardStats] called with shEmployeeCode:', shEmployeeCode);
    const activeFy = await getActiveFY();
    const commitments = await db('ts_product_commitments').where('fiscal_year_code', activeFy);
    console.log('[getDashboardStats] commitments for', activeFy, ':', commitments.length);
    const totals = aggregateMonthlyTargets(commitments);
    const zbms = await db('ts_auth_users').whereRaw("LOWER(TRIM(role)) IN ('zbm','zonal business manager','zonal_business_manager','zonal manager')").where({ is_active: true });
    console.log('[getDashboardStats] ZBMs found:', zbms.length);
    return { totalZbms: zbms.length, totalCommitments: commitments.length,
      pending: commitments.filter((c) => c.status === 'submitted').length,
      approved: commitments.filter((c) => c.status === 'approved').length,
      draft: commitments.filter((c) => c.status === 'draft').length,
      revGrowth: calcGrowth(totals.lyRev, totals.cyRev), qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty) };
  },

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

  async setGeographyTargets(shUser, geoData) {
    return GeographyService.setGeographyTargets(geoData.geoLevel || 'zone', geoData.geoCode, geoData.geoName, geoData.fiscalYear, geoData.targets, shUser.employeeCode);
  },

  async getCategories(role) {
    console.log('[getCategories] called with role:', role);
    try {
      const categories = await db('ts_product_categories')
        .where('is_active', true)
        .select('id', 'name', 'icon', 'color_class', 'is_revenue_only', 'display_order')
        .orderBy('display_order');
      console.log('[getCategories] rows returned:', categories.length);
      return categories.map((r) => ({
        id: r.id,
        name: r.name,
        icon: r.icon,
        color: r.color_class,
        isRevenueOnly: r.is_revenue_only,
        displayOrder: r.display_order,
      }));
    } catch (err) {
      console.error('[getCategories] ERROR:', err.message);
      throw err;
    }
  },

    async getAnalyticsDistribution(filters = {}) {
    const activeFy = filters.fy || await getActiveFY();
    const rows = await db('ts_product_commitments').where('fiscal_year_code', activeFy)
      .whereNotNull('zone_code').select('zone_code', 'zone_name')
      .count('id as total').sum(getKnex().raw("(monthly_targets->>'apr'->>'cyRev')::numeric as revenue"))
      .groupBy('zone_code', 'zone_name');
    return rows.length > 0 ? rows : await db('ts_product_commitments').where('fiscal_year_code', activeFy)
      .whereNotNull('zone_code').select('zone_code', 'zone_name').groupBy('zone_code', 'zone_name');
  },

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

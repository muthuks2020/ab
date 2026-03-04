/**
 * tbm.service.js — TBM Service (Territory Business Manager)
 * @version 2.0.0 - Migrated to aop schema (v5). JOINs to product_master.
 */

const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');

const TBMService = {

  /**
   * GET /tbm/sales-rep-submissions — with product_master JOIN
   */
  async getSalesRepSubmissions(tbmEmployeeCode, filters = {}) {
    const directReports = await db.raw(
      `SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`,
      [tbmEmployeeCode]
    );
    const srCodes = directReports.rows.map((r) => r.employee_code);
    if (srCodes.length === 0) return [];

    let query = db('ts_product_commitments AS pc')
      .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
      .leftJoin('ts_auth_users AS u', 'u.employee_code', 'pc.employee_code')
      .whereIn('pc.employee_code', srCodes);

    if (filters.status) {
      query = query.where('pc.status', filters.status);
    } else {
      query = query.whereIn('pc.status', ['submitted', 'approved']);
    }

    if (filters.categoryId) query = query.where('pc.category_id', filters.categoryId);
    if (filters.salesRepId || filters.employeeCode) query = query.where('pc.employee_code', filters.salesRepId || filters.employeeCode);

    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (activeFy) query = query.where('pc.fiscal_year_code', activeFy.code);

    const rows = await query
      .select(
        'pc.*',
        'pm.product_name', 'pm.quota_price__c AS unit_cost',
        'u.full_name AS employee_name', 'u.role AS employee_role'
      )
      .orderBy('u.full_name').orderBy('pc.category_id').orderBy('pm.product_name');

    return rows.map((r) => ({
      id: r.id,
      salesRepId: r.employee_code,
      salesRepName: r.employee_name || r.full_name,
      territory: r.territory_name,
      categoryId: r.category_id,
      subcategory: null,
      name: r.product_name,
      code: r.product_code,
      status: r.status,
      submittedDate: r.submitted_at,
      approvedDate: r.approved_at,
      approvedBy: r.approved_by_code,
      monthlyTargets: r.monthly_targets,
      unitCost: r.unit_cost ? parseFloat(r.unit_cost) : null,
    }));
  },

  /**
   * PUT /tbm/approve-sales-rep/:id
   */
  async approveSalesRepTarget(commitmentId, tbmUser, { comments = '', corrections = null } = {}) {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') {
      throw Object.assign(new Error(`Can only approve 'submitted' commitments. Current: '${commitment.status}'.`), { status: 400 });
    }

    const sr = await db('ts_auth_users').where({ employee_code: commitment.employee_code }).first();
    if (!sr || sr.reports_to !== tbmUser.employeeCode) {
      throw Object.assign(new Error('This sales rep does not report to you.'), { status: 403 });
    }

    let originalValues = null;
    let action = 'approved';

    if (corrections && Object.keys(corrections).length > 0) {
      originalValues = { ...commitment.monthly_targets };
      const updated = { ...commitment.monthly_targets };
      for (const [month, values] of Object.entries(corrections)) {
        if (updated[month]) {
          updated[month] = { ...updated[month], ...values };
        }
      }
      await db('ts_product_commitments').where({ id: commitmentId }).update({
        monthly_targets: JSON.stringify(updated),
      });
      action = 'corrected_and_approved';
    }

    await db('ts_product_commitments').where({ id: commitmentId }).update({
      status: 'approved',
      approved_at: new Date(),
      approved_by_code: tbmUser.employeeCode,
      
    });

    await db('ts_commitment_approvals').insert({
      commitment_id: commitmentId,
      action,
      actor_code: tbmUser.employeeCode,
      
      actor_role: tbmUser.role,
      corrections: corrections ? JSON.stringify(corrections) : null,
      original_values: originalValues ? JSON.stringify(originalValues) : null,
      comments,
    });

    return { success: true, submissionId: commitmentId, action };
  },

  /**
   * POST /tbm/bulk-approve-sales-rep
   */
  async bulkApproveSalesRep(submissionIds, tbmUser, comments = '') {
    const directReports = await db.raw(
      `SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`,
      [tbmUser.employeeCode]
    );
    const srCodes = directReports.rows.map((r) => r.employee_code);

    const commitments = await db('ts_product_commitments')
      .whereIn('id', submissionIds)
      .where('status', 'submitted')
      .whereIn('employee_code', srCodes);

    if (commitments.length === 0) {
      throw Object.assign(new Error('No eligible submissions found.'), { status: 400 });
    }

    const validIds = commitments.map((c) => c.id);

    await db('ts_product_commitments')
      .whereIn('id', validIds)
      .update({
        status: 'approved',
        approved_at: new Date(),
        approved_by_code: tbmUser.employeeCode,
        
      });

    const approvalRows = validIds.map((id) => ({
      commitment_id: id,
      action: 'bulk_approved',
      actor_code: tbmUser.employeeCode,
      
      actor_role: tbmUser.role,
      comments,
    }));
    await db('ts_commitment_approvals').insert(approvalRows);

    return {
      success: true,
      approvedCount: validIds.length,
      message: `${validIds.length} targets approved successfully`,
    };
  },

  /**
   * POST /tbm/reject-sales-rep/:id
   */
  async rejectSalesRepTarget(commitmentId, tbmUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') {
      throw Object.assign(new Error(`Can only reject 'submitted' commitments.`), { status: 400 });
    }
    const sr = await db('ts_auth_users').where({ employee_code: commitment.employee_code }).first();
    if (!sr || sr.reports_to !== tbmUser.employeeCode) {
      throw Object.assign(new Error('This sales rep does not report to you.'), { status: 403 });
    }

    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft' });
    await db('ts_commitment_approvals').insert({
      commitment_id: commitmentId,
      action: 'submitted',
      actor_code: tbmUser.employeeCode,
      
      actor_role: tbmUser.role,
      comments: `REJECTED: ${reason}`,
    });
    return { success: true, submissionId: commitmentId, reason };
  },

  /**
   * POST /tbm/bulk-reject-sales-rep
   */
  async bulkRejectSalesRep(submissionIds, tbmUser, reason = '') {
    const directReports = await db.raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?)`, [tbmUser.employeeCode]);
    const srCodes = directReports.rows.map((r) => r.employee_code);
    const commitments = await db('ts_product_commitments')
      .whereIn('id', submissionIds).where('status', 'submitted').whereIn('employee_code', srCodes);
    if (commitments.length === 0) throw Object.assign(new Error('No eligible submissions found.'), { status: 400 });
    const validIds = commitments.map((c) => c.id);
    await db('ts_product_commitments').whereIn('id', validIds).update({ status: 'draft' });
    const rows = validIds.map((id) => ({
      commitment_id: id, action: 'submitted',
      actor_code: tbmUser.employeeCode,  actor_role: tbmUser.role,
      comments: `BULK REJECTED: ${reason}`,
    }));
    await db('ts_commitment_approvals').insert(rows);
    return { success: true, rejectedCount: validIds.length, message: `${validIds.length} targets rejected` };
  },

  /**
   * GET /tbm/territory-targets — TBM's own targets with product_master JOIN
   */
  async getTerritoryTargets(tbmEmployeeCode, filters = {}) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    let query = db('ts_product_commitments AS pc')
      .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
      .where('pc.employee_code', tbmEmployeeCode);

    if (activeFy) query = query.where('pc.fiscal_year_code', activeFy.code);
    if (filters.status) query = query.where('pc.status', filters.status);
    if (filters.categoryId) query = query.where('pc.category_id', filters.categoryId);

    const rows = await query
      .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family', 'pm.quota_price__c AS unit_cost')
      .orderBy('pc.category_id').orderBy('pm.product_name');
    return rows.map(formatCommitment);
  },

  /**
   * PUT /tbm/territory-targets/save
   */
  async saveTerritoryTargets(targets, tbmUser) {
    let savedCount = 0;
    for (const t of targets) {
      const existing = await db('ts_product_commitments')
        .where({ id: t.id, employee_code: tbmUser.employeeCode })
        .whereIn('status', ['not_started', 'draft'])
        .first();

      if (existing) {
        await db('ts_product_commitments').where({ id: t.id }).update({
          monthly_targets: JSON.stringify(t.monthlyTargets),
          status: 'draft',
        });
        savedCount++;
      }
    }
    return { success: true, savedCount, message: 'Targets saved as draft' };
  },

  /**
   * POST /tbm/territory-targets/submit
   */
  async submitTerritoryTargets(targetIds, tbmUser) {
    const commitments = await db('ts_product_commitments')
      .whereIn('id', targetIds)
      .where('employee_code', tbmUser.employeeCode)
      .where('status', 'draft');

    if (commitments.length === 0) {
      throw Object.assign(new Error('No eligible draft targets found.'), { status: 400 });
    }

    const validIds = commitments.map((c) => c.id);
    await db('ts_product_commitments')
      .whereIn('id', validIds)
      .update({ status: 'submitted', submitted_at: new Date() });

    const approvalRows = validIds.map((id) => ({
      commitment_id: id,
      action: 'submitted',
      actor_code: tbmUser.employeeCode,
      
      actor_role: tbmUser.role,
    }));
    await db('ts_commitment_approvals').insert(approvalRows);

    return {
      success: true,
      submittedCount: validIds.length,
      message: `${validIds.length} targets submitted for ABM approval`,
    };
  },

  /**
   * PATCH /tbm/territory-targets/:id
   */
  async updateSingleTarget(targetId, tbmUser, { month, values }) {
    const commitment = await db('ts_product_commitments')
      .where({ id: targetId, employee_code: tbmUser.employeeCode }).first();
    if (!commitment) throw Object.assign(new Error('Target not found or not yours.'), { status: 404 });
    if (commitment.status === 'submitted' || commitment.status === 'approved') {
      throw Object.assign(new Error('Cannot edit submitted/approved target.'), { status: 400 });
    }
    const updated = { ...(commitment.monthly_targets || {}) };
    updated[month] = { ...(updated[month] || {}), ...values };
    await db('ts_product_commitments').where({ id: targetId }).update({
      monthly_targets: JSON.stringify(updated), status: 'draft',
    });
    return { success: true, targetId, month };
  },

  // Individual targets reuse territory targets logic
  async getIndividualTargets(tbmEmployeeCode, filters = {}) {
    return this.getTerritoryTargets(tbmEmployeeCode, filters);
  },
  async saveIndividualTargets(targets, tbmUser) {
    return this.saveTerritoryTargets(targets, tbmUser);
  },
  async submitIndividualTargets(targetIds, tbmUser) {
    return this.submitTerritoryTargets(targetIds, tbmUser);
  },

  /**
   * GET /tbm/dashboard-stats
   */
  async getDashboardStats(tbmEmployeeCode) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return {};

    const directReports = await db.raw(
      `SELECT employee_code, full_name FROM aop.ts_fn_get_direct_reports(?)`,
      [tbmEmployeeCode]
    );
    const srCodes = directReports.rows.map((r) => r.employee_code);

    const srCommitments = srCodes.length > 0
      ? await db('ts_product_commitments')
          .whereIn('employee_code', srCodes)
          .where('fiscal_year_code', activeFy.code)
      : [];

    const salesRepStats = {
      total: srCommitments.length,
      submitted: srCommitments.filter((c) => c.status === 'submitted').length,
      approved: srCommitments.filter((c) => c.status === 'approved').length,
      draft: srCommitments.filter((c) => c.status === 'draft').length,
    };

    const tbmCommitments = await db('ts_product_commitments')
      .where({ employee_code: tbmEmployeeCode, fiscal_year_code: activeFy.code });

    const tbmStats = {
      total: tbmCommitments.length,
      submitted: tbmCommitments.filter((c) => c.status === 'submitted').length,
      approved: tbmCommitments.filter((c) => c.status === 'approved').length,
      draft: tbmCommitments.filter((c) => c.status === 'draft').length,
    };

    const salesRepTotals = aggregateMonthlyTargets(srCommitments);
    const tbmTotals = aggregateMonthlyTargets(tbmCommitments);

    return {
      salesRepSubmissions: salesRepStats,
      tbmTargets: tbmStats,
      tbmIndividualTargets: tbmStats,
      salesRepTotals,
      tbmTotals,
      tbmIndividualTotals: tbmTotals,
      salesRepCount: srCodes.length,
    };
  },

  /**
   * GET /tbm/yearly-targets
   */
  async getYearlyTargets(tbmEmployeeCode, fiscalYearCode) {
    const fy = fiscalYearCode || (await db('ts_fiscal_years').where('is_active', true).first())?.code;
    if (!fy) return { members: [] };

    const directReports = await db.raw(
      `SELECT employee_code, full_name, designation, territory_name FROM aop.ts_fn_get_direct_reports(?)`,
      [tbmEmployeeCode]
    );

    const members = [];
    for (const sr of directReports.rows) {
      const assignment = await db('ts_yearly_target_assignments')
        .where({
          fiscal_year_code: fy,
          manager_code: tbmEmployeeCode,
          assignee_code: sr.employee_code,
        })
        .first();

      members.push({
        id: sr.employee_code,
        name: sr.full_name,
        territory: sr.territory_name,
        designation: sr.designation,
        lyTarget: assignment ? parseFloat(assignment.ly_target_qty) : 0,
        lyAchieved: assignment ? parseFloat(assignment.ly_achieved_qty) : 0,
        lyTargetValue: assignment ? parseFloat(assignment.ly_target_value) : 0,
        lyAchievedValue: assignment ? parseFloat(assignment.ly_achieved_value) : 0,
        cyTarget: assignment ? parseFloat(assignment.cy_target_qty) : 0,
        cyTargetValue: assignment ? parseFloat(assignment.cy_target_value) : 0,
        status: assignment?.status || 'not_set',
        lastUpdated: assignment?.updated_at || null,
        categoryBreakdown: assignment?.category_breakdown || [],
      });
    }

    return { members };
  },

  /**
   * POST /tbm/yearly-targets/save
   */
  async saveYearlyTargets(tbmUser, fiscalYear, membersData) {
    let savedCount = 0;

    for (const m of membersData) {
      const existing = await db('ts_yearly_target_assignments')
        .where({
          fiscal_year_code: fiscalYear,
          manager_code: tbmUser.employeeCode,
          assignee_code: m.id,
        })
        .first();

      const data = {
        cy_target_qty: m.cyTarget || 0,
        cy_target_value: m.cyTargetValue || 0,
        category_breakdown: m.categoryBreakdown ? JSON.stringify(m.categoryBreakdown) : '[]',
        status: 'draft',
      };

      if (existing) {
        await db('ts_yearly_target_assignments').where({ id: existing.id }).update(data);
      } else {
        const assignee = await db('ts_auth_users').where({ employee_code: m.id }).first();
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code: fiscalYear,
          manager_code: tbmUser.employeeCode,
          manager_role: tbmUser.role,
          assignee_code: m.id,
          assignee_name: assignee?.full_name || '',
          assignee_role: assignee?.role || 'sales_rep',
          assignee_territory: assignee?.territory_name || '',
          ...data,
        });
      }
      savedCount++;
    }

    return { success: true, savedCount };
  },

  /**
   * POST /tbm/yearly-targets/publish
   */
  async publishYearlyTargets(tbmUser, fiscalYear, memberIds) {
    let publishedCount = 0;

    for (const memberId of memberIds) {
      const updated = await db('ts_yearly_target_assignments')
        .where({
          fiscal_year_code: fiscalYear,
          manager_code: tbmUser.employeeCode,
          assignee_code: memberId,
        })
        .update({ status: 'published', published_at: new Date() });

      if (updated > 0) publishedCount++;
    }

    return { success: true, publishedCount };
  },

  /**
   * GET /tbm/team-targets/summary
   */
  async getTeamTargetsSummary(tbmEmployeeCode) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];
    const directReports = await db.raw(`SELECT employee_code, full_name, territory_name FROM aop.ts_fn_get_direct_reports(?)`, [tbmEmployeeCode]);
    const summary = [];
    for (const sr of directReports.rows) {
      const targets = await db('ts_team_product_targets')
        .where({ manager_code: tbmEmployeeCode, member_code: sr.employee_code, fiscal_year_code: activeFy.code });
      let totalQty = 0;
      targets.forEach((t) => {
        const mt = t.monthly_targets || {};
        Object.values(mt).forEach((m) => { totalQty += Number(m.cyQty || 0); });
      });
      summary.push({
        id: sr.employee_code, name: sr.full_name, territory: sr.territory_name,
        productCount: targets.length, totalQty,
        assigned: targets.some((t) => t.status === 'published'),
      });
    }
    return summary;
  },

  /**
   * GET /tbm/team-targets/:repId
   */
  async getTeamTargetsForRep(tbmUser, repId) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];
    const rows = await db('ts_team_product_targets')
      .where({ manager_code: tbmUser.employeeCode, member_code: repId, fiscal_year_code: activeFy.code });
    return rows;
  },

  /**
   * POST /tbm/team-targets/:repId/save
   */
  async saveTeamTargetsForRep(tbmUser, repId, targets) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) throw Object.assign(new Error('No active fiscal year.'), { status: 400 });
    let savedCount = 0;
    for (const t of targets) {
      const existing = await db('ts_team_product_targets').where({
        fiscal_year_code: activeFy.code, manager_code: tbmUser.employeeCode,
        member_code: repId, product_code: t.code || t.productCode,
      }).first();
      if (existing) {
        await db('ts_team_product_targets').where({ id: existing.id }).update({
          monthly_targets: JSON.stringify(t.monthlyTargets), status: 'draft',
        });
      } else {
        await db('ts_team_product_targets').insert({
          fiscal_year_code: activeFy.code, manager_code: tbmUser.employeeCode,
          manager_role: tbmUser.role, member_code: repId,
          member_name: t.memberName || '', product_code: t.code || t.productCode,
          product_name: t.name || t.productName, category_id: t.categoryId,
          monthly_targets: JSON.stringify(t.monthlyTargets), status: 'draft',
        });
      }
      savedCount++;
    }
    return { success: true, repId, savedCount };
  },

  /**
   * POST /tbm/team-targets/:repId/assign
   */
  async assignTeamTargetsToRep(tbmUser, repId, targets) {
    const result = await this.saveTeamTargetsForRep(tbmUser, repId, targets);
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (activeFy) {
      await db('ts_team_product_targets')
        .where({ manager_code: tbmUser.employeeCode, member_code: repId, fiscal_year_code: activeFy.code })
        .update({ status: 'published', assigned_at: new Date() });
    }
    return { success: true, repId, assignedCount: result.savedCount };
  },
  // GET /tbm/team-members — direct report sales reps
  async getTeamMembers(tbmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, territory_name, role FROM aop.ts_fn_get_direct_reports(?)`, [tbmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name, role: r.role }));
  },

  // GET /tbm/unique-reps — distinct SRs under this TBM
  async getUniqueReps(tbmEmployeeCode) {
    const directReports = await db.raw(`SELECT employee_code, full_name, designation, territory_name FROM aop.ts_fn_get_direct_reports(?)`, [tbmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name }));
  },

  // PUT /tbm/territory-targets/:id/save — save single territory target by ID
  async saveSingleTerritoryTarget(targetId, monthlyTargets, tbmUser) {
    const target = await db('ts_geography_targets').where({ id: targetId }).first();
    if (!target) throw Object.assign(new Error('Target not found.'), { status: 404 });
    await db('ts_geography_targets').where({ id: targetId }).update({ monthly_targets: JSON.stringify(monthlyTargets), set_by_code: tbmUser.employeeCode, set_by_role: tbmUser.role, status: 'draft', updated_at: new Date() });
    return { success: true, targetId };
  },

  // POST /tbm/individual-targets/:id/save — save single individual target by ID
  async saveSingleIndividualTarget(targetId, monthlyTargets, tbmUser) {
    const target = await db('ts_team_product_targets').where({ id: targetId }).first();
    if (!target) throw Object.assign(new Error('Target not found.'), { status: 404 });
    await db('ts_team_product_targets').where({ id: targetId }).update({ monthly_targets: JSON.stringify(monthlyTargets), status: 'draft', updated_at: new Date() });
    return { success: true, targetId };
  },
};

module.exports = TBMService;

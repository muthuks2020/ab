/**
 * ABM Specialist Service
 * Business logic for ABM managing specialist submissions and yearly targets.
 * Chain: Specialist → ABM (review/approve) → ZBM → Sales Head
 *
 * @version 2.0.0 - Migrated to aop schema (v5)
 */

'use strict';

const { db } = require('../config/database');
const { SPECIALIST_ROLES } = require('../utils/specialistConstants');

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const getSpecialistCodes = async (abmEmployeeCode) => {
  const rows = await db('ts_auth_users')
    .where({ reports_to: abmEmployeeCode, is_active: true })
    .whereIn('role', SPECIALIST_ROLES)
    .select('employee_code');
  return rows.map((r) => r.employee_code);
};

/** Format a ts_product_commitments row for ABM review (with JOINed fields) */
const formatSubmission = (r) => ({
  id: r.id,
  fiscalYearCode: r.fiscal_year_code,
  employeeCode: r.employee_code,
  employeeName: r.employee_name || r.full_name || null,
  employeeRole: r.employee_role || r.role || null,
  productCode: r.product_code,
  productName: r.product_name || null,
  categoryId: r.category_id || r.product_category || null,
  unit: r.unit || null,
  unitCost: r.unit_cost ? parseFloat(r.unit_cost) : null,
  zoneName: r.zone_name,
  areaName: r.area_name,
  territoryName: r.territory_name,
  monthlyTargets: r.monthly_targets || {},
  status: r.status,
  submittedAt: r.submitted_at,
  approvedAt: r.approved_at,
  approvedByCode: r.approved_by_code,
  approvedByCode: r.approved_by_code,
});

// ======================================================================
// GET /abm/specialist-submissions — with product_master JOIN
// ======================================================================
const getSpecialistSubmissions = async (abmEmployeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const specialistCodes = await getSpecialistCodes(abmEmployeeCode);
  if (specialistCodes.length === 0) return [];

  const rows = await db('ts_product_commitments AS pc')
    .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
    .leftJoin('ts_auth_users AS u', 'u.employee_code', 'pc.employee_code')
    .whereIn('pc.employee_code', specialistCodes)
    .where({ 'pc.fiscal_year_code': fy })
    .whereIn('pc.status', ['submitted', 'approved'])
    .select(
      'pc.*',
      'pm.product_name', 'pm.product_category', 'pm.quota_price__c AS unit_cost',
      'u.full_name AS employee_name', 'u.role AS employee_role'
    )
    .orderBy('pc.submitted_at', 'desc');

  return rows.map(formatSubmission);
};

// ======================================================================
// PUT /abm/approve-specialist/:id
// ======================================================================
const approveSpecialist = async (commitmentId, abmUser, corrections, comments) => {
  const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
  if (!commitment) {
    const err = new Error('Commitment not found');
    err.status = 404;
    throw err;
  }
  if (commitment.status !== 'submitted') {
    const err = new Error(`Can only approve 'submitted'. Current: '${commitment.status}'`);
    err.status = 400;
    throw err;
  }

  // Verify specialist reports to this ABM
  const specialistCodes = await getSpecialistCodes(abmUser.employeeCode);
  if (!specialistCodes.includes(commitment.employee_code)) {
    const err = new Error('This specialist does not report to you');
    err.status = 403;
    throw err;
  }

  const now = new Date();
  const hasCorrections = corrections && Object.keys(corrections).length > 0;
  let originalValues = null;
  let action = 'approved';

  await db.transaction(async (trx) => {
    if (hasCorrections) {
      originalValues = { ...(commitment.monthly_targets || {}) };
      const updated = { ...commitment.monthly_targets };
      for (const [month, values] of Object.entries(corrections)) {
        if (updated[month]) {
          updated[month] = { ...updated[month], ...values };
        }
      }
      await trx('ts_product_commitments').where({ id: commitmentId }).update({
        monthly_targets: JSON.stringify(updated),
      });
      action = 'corrected_and_approved';
    }

    await trx('ts_product_commitments').where({ id: commitmentId }).update({
      status: 'approved',
      approved_at: now,
      approved_by_code: abmUser.employeeCode,
      
      updated_at: now,
    });

    await trx('ts_commitment_approvals').insert({
      commitment_id: commitmentId,
      action,
      actor_code: abmUser.employeeCode,
      
      actor_role: abmUser.role,
      corrections: hasCorrections ? JSON.stringify(corrections) : null,
      original_values: originalValues ? JSON.stringify(originalValues) : null,
      comments: comments || null,
      created_at: now,
    });

    await trx('ts_audit_log').insert({
      actor_code: abmUser.employeeCode,
      actor_role: abmUser.role,
      action: `specialist_${action}`,
      entity_type: 'product_commitment',
      entity_id: commitmentId,
      detail: JSON.stringify({
        specialist_code: commitment.employee_code,
        product_code: commitment.product_code,
        has_corrections: hasCorrections,
      }),
      created_at: now,
    });
  });

  return { success: true };
};

// ======================================================================
// POST /abm/bulk-approve-specialist
// ======================================================================
const bulkApproveSpecialist = async (submissionIds, abmUser) => {
  const specialistCodes = await getSpecialistCodes(abmUser.employeeCode);

  const eligible = await db('ts_product_commitments')
    .whereIn('id', submissionIds)
    .whereIn('employee_code', specialistCodes)
    .where({ status: 'submitted' });

  if (eligible.length === 0) {
    const err = new Error('No eligible submissions to approve');
    err.status = 400;
    throw err;
  }

  const ids = eligible.map((r) => r.id);
  const now = new Date();

  await db.transaction(async (trx) => {
    await trx('ts_product_commitments')
      .whereIn('id', ids)
      .update({
        status: 'approved',
        approved_at: now,
        approved_by_code: abmUser.employeeCode,
        
        updated_at: now,
      });

    const approvalRows = ids.map((id) => ({
      commitment_id: id,
      action: 'bulk_approved',
      actor_code: abmUser.employeeCode,
      
      actor_role: abmUser.role,
      created_at: now,
    }));
    await trx('ts_commitment_approvals').insert(approvalRows);

    await trx('ts_audit_log').insert({
      actor_code: abmUser.employeeCode,
      actor_role: abmUser.role,
      action: 'specialist_bulk_approved',
      entity_type: 'product_commitment',
      detail: JSON.stringify({ approved_ids: ids, count: ids.length }),
      created_at: now,
    });
  });

  return { success: true, approvedCount: ids.length };
};

// ======================================================================
// GET /abm/specialists
// ======================================================================
const getSpecialists = async (abmEmployeeCode) => {
  const rows = await db('ts_auth_users')
    .where({ reports_to: abmEmployeeCode, is_active: true })
    .whereIn('role', SPECIALIST_ROLES)
    .orderBy('full_name');

  return rows.map((r) => ({
    employeeCode: r.employee_code,
    fullName: r.full_name,
    role: r.role,
    designation: r.designation,
    email: r.email,
    phone: r.phone,
    zoneName: r.zone_name,
    areaName: r.area_name,
    territoryName: r.territory_name,
    isVacant: r.is_vacant || false,
  }));
};

// ======================================================================
// GET /abm/specialist-yearly-targets
// ======================================================================
const getSpecialistYearlyTargets = async (abmEmployeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();

  const rows = await db('ts_yearly_target_assignments')
    .where({ manager_code: abmEmployeeCode, fiscal_year_code: fy })
    .whereIn('assignee_role', SPECIALIST_ROLES)
    .orderBy('assignee_name');

  return rows.map((r) => ({
    id: r.id,
    fiscalYearCode: r.fiscal_year_code,
    assigneeCode: r.assignee_code,
    assigneeName: r.assignee_name,
    assigneeRole: r.assignee_role,
    assigneeTerritory: r.assignee_territory,
    lyTargetQty: parseFloat(r.ly_target_qty || 0),
    lyAchievedQty: parseFloat(r.ly_achieved_qty || 0),
    lyTargetValue: parseFloat(r.ly_target_value || 0),
    lyAchievedValue: parseFloat(r.ly_achieved_value || 0),
    cyTargetQty: parseFloat(r.cy_target_qty || 0),
    cyTargetValue: parseFloat(r.cy_target_value || 0),
    categoryBreakdown: r.category_breakdown || [],
    status: r.status,
    publishedAt: r.published_at,
  }));
};

// ======================================================================
// POST /abm/specialist-yearly-targets/save
// ======================================================================
const saveSpecialistYearlyTargets = async (targets, abmUser, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const now = new Date();

  await db.transaction(async (trx) => {
    for (const t of targets) {
      const existing = await trx('ts_yearly_target_assignments').where({
        fiscal_year_code: fy,
        manager_code: abmUser.employeeCode,
        assignee_code: t.assigneeCode,
      }).first();

      const data = {
        cy_target_qty: t.cyTargetQty || 0,
        cy_target_value: t.cyTargetValue || 0,
        category_breakdown: t.categoryBreakdown ? JSON.stringify(t.categoryBreakdown) : '[]',
        status: 'draft',
        updated_at: now,
      };

      if (existing) {
        await trx('ts_yearly_target_assignments').where({ id: existing.id }).update(data);
      } else {
        const specialist = await trx('ts_auth_users').where({ employee_code: t.assigneeCode }).first();
        await trx('ts_yearly_target_assignments').insert({
          fiscal_year_code: fy,
          manager_code: abmUser.employeeCode,
          manager_role: abmUser.role,
          assignee_code: t.assigneeCode,
          assignee_name: t.assigneeName || specialist?.full_name || '',
          assignee_role: specialist?.role || 'at_iol_specialist',
          assignee_territory: specialist?.area_name || specialist?.territory_name || '',
          ...data,
          created_at: now,
        });
      }
    }
  });

  return { success: true };
};

// ======================================================================
// POST /abm/specialist-yearly-targets/publish
// ======================================================================
const publishSpecialistYearlyTargets = async (targets, abmUser, fiscalYearCode) => {
  await saveSpecialistYearlyTargets(targets, abmUser, fiscalYearCode);

  const fy = fiscalYearCode || await getActiveFY();
  const now = new Date();
  const assigneeCodes = targets.map((t) => t.assigneeCode);

  await db('ts_yearly_target_assignments')
    .where({ manager_code: abmUser.employeeCode, fiscal_year_code: fy })
    .whereIn('assignee_code', assigneeCodes)
    .update({ status: 'published', published_at: now, updated_at: now });

  await db('ts_audit_log').insert({
    actor_code: abmUser.employeeCode,
    actor_role: abmUser.role,
    action: 'specialist_yearly_targets_published',
    entity_type: 'yearly_target_assignment',
    detail: JSON.stringify({ specialist_codes: assigneeCodes, fiscal_year: fy }),
    created_at: now,
  });

  return { success: true };
};

// ======================================================================
// GET /abm/specialist-dashboard-stats
// ======================================================================
const getSpecialistDashboardStats = async (abmEmployeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const specialistCodes = await getSpecialistCodes(abmEmployeeCode);

  const submissions = specialistCodes.length > 0
    ? await db('ts_product_commitments')
        .whereIn('employee_code', specialistCodes)
        .where({ fiscal_year_code: fy })
    : [];

  return {
    totalSpecialists: specialistCodes.length,
    totalSubmissions: submissions.length,
    pending: submissions.filter((s) => s.status === 'submitted').length,
    approved: submissions.filter((s) => s.status === 'approved').length,
    draft: submissions.filter((s) => s.status === 'draft').length,
  };
};

const rejectSpecialist = async (commitmentId, abmUser, reason = '') => {
  const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
  if (!commitment) throw Object.assign(new Error('Commitment not found'), { status: 404 });
  if (commitment.status !== 'submitted') throw Object.assign(new Error('Only submitted commitments can be rejected'), { status: 400 });
  const specialist = await db('ts_auth_users').where({ employee_code: commitment.employee_code, is_active: true }).first();
  if (!specialist || specialist.reports_to !== abmUser.employeeCode) throw Object.assign(new Error('This specialist does not report to you'), { status: 403 });
  await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft', updated_at: new Date() });
  await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'rejected', actor_code: abmUser.employeeCode, actor_role: abmUser.role, comments: reason });
  return { success: true };
};

const getUniqueSpecialists = async (abmEmployeeCode) => {
  const specialistCodes = await getSpecialistCodes(abmEmployeeCode);
  const specialists = await db('ts_auth_users').whereIn('employee_code', specialistCodes).where('is_active', true)
    .select('employee_code', 'full_name', 'designation', 'role', 'territory_name');
  return specialists.map((s) => ({ employeeCode: s.employee_code, fullName: s.full_name, designation: s.designation, role: s.role, territory: s.territory_name }));
};

module.exports = {
  getSpecialistSubmissions,
  approveSpecialist,
  rejectSpecialist,
  bulkApproveSpecialist,
  getSpecialists,
  getUniqueSpecialists,
  getSpecialistYearlyTargets,
  saveSpecialistYearlyTargets,
  publishSpecialistYearlyTargets,
  getSpecialistDashboardStats,
};

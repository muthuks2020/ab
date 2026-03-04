/**
 * Specialist Service
 * Business logic for Specialist's own product commitments.
 * Specialist → ABM → ZBM → Sales Head
 *
 * @version 2.0.0 - Migrated to aop schema (v5). Removed duplicate formatCommitment.
 */

'use strict';

const { db } = require('../config/database');
const { FISCAL_MONTHS, QUARTERS } = require('../utils/specialistConstants');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');

// ─────────────────────────────────────────────────────────────────
// Helper: active fiscal year
// ─────────────────────────────────────────────────────────────────
const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

// ─────────────────────────────────────────────────────────────────
// Helper: verify ownership
// ─────────────────────────────────────────────────────────────────
const getOwnCommitment = async (commitmentId, employeeCode) => {
  const row = await db('ts_product_commitments')
    .where({ id: commitmentId, employee_code: employeeCode })
    .first();
  if (!row) {
    const err = new Error('Commitment not found or access denied');
    err.status = 404;
    throw err;
  }
  return row;
};

// ======================================================================
// GET /specialist/products — with product_master JOIN
// ======================================================================
const getProducts = async (employeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();
  const rows = await db('ts_product_commitments AS pc')
    .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
    .where({ 'pc.employee_code': employeeCode, 'pc.fiscal_year_code': fy })
    .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family', 'pm.quota_price__c AS unit_cost')
    .orderBy('pc.category_id')
    .orderBy('pm.product_name');
  return rows.map(formatCommitment);
};

// ======================================================================
// PUT /specialist/products/:id/save
// ======================================================================
const saveProduct = async (commitmentId, monthlyTargets, user) => {
  const row = await getOwnCommitment(commitmentId, user.employeeCode);
  if (row.status === 'submitted' || row.status === 'approved') {
    const err = new Error(`Cannot edit in '${row.status}' status`);
    err.status = 400;
    throw err;
  }
  await db('ts_product_commitments').where({ id: commitmentId }).update({
    monthly_targets: JSON.stringify(monthlyTargets),
    status: 'draft',
  });
  // Re-fetch with JOIN
  const updated = await db('ts_product_commitments AS pc')
    .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
    .where('pc.id', commitmentId)
    .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family', 'pm.quota_price__c AS unit_cost')
    .first();
  return formatCommitment(updated);
};

// ======================================================================
// POST /specialist/products/:id/submit
// ======================================================================
const submitProduct = async (commitmentId, user, comments = '') => {
  const row = await getOwnCommitment(commitmentId, user.employeeCode);
  if (row.status !== 'draft') {
    const err = new Error(`Can only submit 'draft'. Current: '${row.status}'`);
    err.status = 400;
    throw err;
  }
  await db('ts_product_commitments').where({ id: commitmentId }).update({
    status: 'submitted',
    submitted_at: new Date(),
  });
  await db('ts_commitment_approvals').insert({
    commitment_id: commitmentId,
    action: 'submitted',
    actor_code: user.employeeCode,
    
    actor_role: user.role,
    comments,
  });
  return { success: true, id: commitmentId, status: 'submitted' };
};

// ======================================================================
// POST /specialist/products/submit-multiple
// ======================================================================
const submitMultiple = async (productIds, user) => {
  const rows = await db('ts_product_commitments')
    .whereIn('id', productIds)
    .where({ employee_code: user.employeeCode, status: 'draft' });
  if (rows.length === 0) {
    const err = new Error('No eligible drafts');
    err.status = 400;
    throw err;
  }
  const ids = rows.map((r) => r.id);
  await db('ts_product_commitments').whereIn('id', ids).update({ status: 'submitted', submitted_at: new Date() });
  const approvals = ids.map((id) => ({
    commitment_id: id, action: 'submitted',
    actor_code: user.employeeCode,  actor_role: user.role,
  }));
  await db('ts_commitment_approvals').insert(approvals);
  return { success: true, submittedCount: ids.length };
};

// ======================================================================
// POST /specialist/products/save-all
// ======================================================================
const saveAll = async (products, user) => {
  let savedCount = 0;
  for (const p of products) {
    const existing = await db('ts_product_commitments')
      .where({ id: p.id, employee_code: user.employeeCode })
      .whereIn('status', ['not_started', 'draft'])
      .first();
    if (existing) {
      await db('ts_product_commitments').where({ id: p.id }).update({
        monthly_targets: JSON.stringify(p.monthlyTargets), status: 'draft',
      });
      savedCount++;
    }
  }
  return { success: true, savedCount };
};

// ======================================================================
// GET /specialist/dashboard-summary
// ======================================================================
const getDashboardSummary = async (employeeCode) => {
  const fy = await getActiveFY();
  const rows = await db('ts_product_commitments')
    .where({ employee_code: employeeCode, fiscal_year_code: fy });

  let draftCount = 0, submittedCount = 0, approvedCount = 0;
  rows.forEach((r) => {
    if (r.status === 'draft') draftCount++;
    else if (r.status === 'submitted') submittedCount++;
    else if (r.status === 'approved') approvedCount++;
  });

  const totals = aggregateMonthlyTargets(rows);
  const totalLY = totals.lyRev;
  const totalCY = totals.cyRev;
  const growth = totalLY > 0
    ? parseFloat(((totalCY - totalLY) / totalLY * 100).toFixed(1)) : 0;

  return {
    totalLY,
    totalCY,
    growth,
    totalProducts: rows.length,
    draftCount,
    submittedCount,
    approvedCount,
  };
};

// ======================================================================
// GET /specialist/quarterly-summary
// ======================================================================
const getQuarterlySummary = async (employeeCode, fiscalYearCode) => {
  const fy = fiscalYearCode || await getActiveFY();

  const rows = await db('ts_product_commitments')
    .where({ employee_code: employeeCode, fiscal_year_code: fy });

  const catMap = {};
  for (const r of rows) {
    const catId = r.category_id || 'other';
    if (!catMap[catId]) {
      catMap[catId] = { categoryId: catId, quarters: {} };
      for (const qName of Object.keys(QUARTERS)) {
        catMap[catId].quarters[qName] = { lyRev: 0, cyRev: 0, lyQty: 0, cyQty: 0 };
      }
    }
    const mt = r.monthly_targets || {};
    for (const [qName, months] of Object.entries(QUARTERS)) {
      for (const m of months) {
        catMap[catId].quarters[qName].lyRev += mt[m]?.lyRev || 0;
        catMap[catId].quarters[qName].cyRev += mt[m]?.cyRev || 0;
        catMap[catId].quarters[qName].lyQty += mt[m]?.lyQty || 0;
        catMap[catId].quarters[qName].cyQty += mt[m]?.cyQty || 0;
      }
    }
  }

  return { fiscalYear: fy, categories: Object.values(catMap) };
};

const getCategoryPerformance = async (employeeCode) => {
  const activeFy = await getActiveFY();
  const commitments = await db('ts_product_commitments AS pc')
    .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
    .where({ 'pc.employee_code': employeeCode, 'pc.fiscal_year_code': activeFy })
    .select('pc.*', 'pm.product_category');
  const byCategory = {};
  let totalCyRev = 0;
  for (const c of commitments) {
    const catId = c.product_category || c.category_id;
    if (!byCategory[catId]) byCategory[catId] = { lyRev: 0, cyRev: 0, lyQty: 0, cyQty: 0 };
    const agg = aggregateMonthlyTargets([c]);
    byCategory[catId].lyRev += agg.lyRev; byCategory[catId].cyRev += agg.cyRev;
    byCategory[catId].lyQty += agg.lyQty; byCategory[catId].cyQty += agg.cyQty;
    totalCyRev += agg.cyRev;
  }
  const categories = await db('ts_product_categories').where('is_active', true);
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  return Object.entries(byCategory).map(([catId, data]) => ({
    categoryId: catId, name: catMap[catId] || catId,
    lyQty: data.lyQty, cyQty: data.cyQty, lyRev: data.lyRev, cyRev: data.cyRev,
    growth: calcGrowth(data.lyRev, data.cyRev),
    contribution: totalCyRev > 0 ? Math.round((data.cyRev / totalCyRev) * 100 * 10) / 10 : 0,
  }));
};

module.exports = {
  getProducts,
  saveProduct,
  submitProduct,
  submitMultiple,
  saveAll,
  getDashboardSummary,
  getQuarterlySummary,
  getCategoryPerformance,
};

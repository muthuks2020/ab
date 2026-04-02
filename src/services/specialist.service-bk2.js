'use strict';

const { db } = require('../config/database');
const { FISCAL_MONTHS, QUARTERS } = require('../utils/specialistConstants');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');

// Maps req.user.role (full designation from JWT) → product_master.product_category (lowercased)
const SPECIALIST_ROLE_CATEGORIES = {
  'Equipment Specialist - Diagnostics & Lasers': ['equipment'],
  'Equipment Manager - Diagnostics & Lasers':    ['equipment'],
  'Equipment Specialist - Surgical Systems':     ['equipment'],
  'Equipment Manager - Surgical Systems':        ['equipment'],
  'AT IOL Specialist':                           ['iol'],
  'AT IOL Manager':                              ['iol'],
};

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

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

const getProducts = async (employeeCode, fiscalYearCode, userRole) => {
  const fy = fiscalYearCode || await getActiveFY();
  const { getKnex } = require('../config/database');
  const toDate = (v) => v ? new Date(v).toISOString().slice(0, 10) : null;

  // DISTINCT ON (product_code) removes duplicate commitment rows for the same product.
  // product_master.product_name is NULL for all rows — COALESCE uses product_subgroup first.
  const sql = `
    SELECT DISTINCT ON (pc.product_code)
      pc.*,
      COALESCE(
        NULLIF(TRIM(pm.product_subgroup), ''),
        NULLIF(TRIM(pm.product_name), ''),
        NULLIF(TRIM(pm.product_family), ''),
        pc.product_code
      ) AS product_name,
      pm.product_category,
      pm.product_family,
      pm.product_subgroup,
      pm.quota_price__c AS unit_cost
    FROM aop.ts_product_commitments AS pc
    JOIN (
      SELECT DISTINCT ON (productcode)
        productcode, product_name, product_category, product_family, product_subgroup, quota_price__c
      FROM aop.product_master
      ORDER BY productcode
    ) pm ON pm.productcode = pc.product_code
    WHERE pc.employee_code = ? AND pc.fiscal_year_code = ?
    ORDER BY pc.product_code, pc.updated_at DESC
  `;
  const result = await getKnex().raw(sql, [employeeCode, fy]);
  const rows = result.rows;

  const commitmentProducts = rows.map(formatCommitment);

  // Inject catalog stubs for specialist roles that have no commitment rows yet,
  // or to show all role-relevant products beyond existing commitments.
  const existingCodes = new Set(rows.map((r) => r.product_code));
  const allowedCategories = userRole ? (SPECIALIST_ROLE_CATEGORIES[userRole] || null) : null;

  if (allowedCategories && allowedCategories.length > 0) {
    const catalogRows = await db('product_master')
      .where('isactive', true)
      .whereRaw('LOWER(product_category) IN (' + allowedCategories.map(() => '?').join(',') + ')', allowedCategories)
      .distinctOn('productcode')
      .select('productcode', 'product_subgroup', 'product_name', 'product_category',
              'product_family', 'quota_price__c AS unit_cost', 'active_from', 'active_to')
      .orderBy('productcode');

    for (const p of catalogRows) {
      if (!existingCodes.has(p.productcode)) {
        existingCodes.add(p.productcode);
        commitmentProducts.push({
          id:             p.productcode,
          productCode:    p.productcode,
          productName:    p.product_subgroup || p.product_name || p.productcode,
          categoryId:     (p.product_category || '').toLowerCase(),
          subcategory:    p.product_family  || '',
          unitCost:       parseFloat(p.unit_cost || 0),
          monthlyTargets: {},
          status:         'not_started',
          activeFrom:     toDate(p.active_from),
          activeTo:       toDate(p.active_to),
          isNewProduct:   true,
        });
      }
    }
    console.log('[specialist.getProducts] role=' + userRole + ' stubs=' + (commitmentProducts.length - rows.length));
  }

  return commitmentProducts;
};

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

  const updated = await db('ts_product_commitments AS pc')
    .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
    .where('pc.id', commitmentId)
    .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family', 'pm.quota_price__c AS unit_cost')
    .first();
  return formatCommitment(updated);
};

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

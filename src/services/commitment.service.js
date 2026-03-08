/**
 * commitment.service.js — Product Commitment Service (Sales Rep scope)
 * @version 2.0.0 - Migrated to aop schema (v5). JOINs to product_master for product details.
 */

const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth, MONTHS } = require('../utils/helpers');

const CommitmentService = {

  /**
   * PUT /products/:id/targets/:month — Update single month
   */
  async updateMonthlyTarget(commitmentId, month, data, user) {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.employee_code !== user.employeeCode) {
      throw Object.assign(new Error('You can only edit your own commitments.'), { status: 403 });
    }
    if (commitment.status === 'submitted' || commitment.status === 'approved') {
      throw Object.assign(new Error(`Cannot edit commitment in '${commitment.status}' status.`), { status: 400 });
    }
    const updated = { ...(commitment.monthly_targets || {}) };
    updated[month] = { ...(updated[month] || {}), ...data };
    await db('ts_product_commitments').where({ id: commitmentId }).update({
      monthly_targets: JSON.stringify(updated), status: 'draft',
    });
    return { success: true, productId: commitmentId, month, data };
  },

  /**
   * GET /products — returns commitments with product details from product_master JOIN
   */
  async getProducts(employeeCode, fiscalYearCode) {
    const activeFy = fiscalYearCode
      || (await db('ts_fiscal_years').where('is_active', true).first())?.code;

    // DISTINCT ON subquery — product_master has duplicate productcodes,
    // a direct JOIN would multiply commitment rows and double all values.
    const pmSubquery = db('product_master')
      .distinctOn('productcode')
      .select('productcode', 'product_name', 'product_category', 'product_family', 'product_subgroup', 'quota_price__c AS unit_cost')
      .orderBy('productcode')
      .orderBy('product_name')
      .as('pm');

    const rows = await db('ts_product_commitments AS pc')
      .join(pmSubquery, 'pm.productcode', 'pc.product_code')
      .where('pc.employee_code', employeeCode)
      .modify((qb) => { if (activeFy) qb.where('pc.fiscal_year_code', activeFy); })
      .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family', 'pm.product_subgroup', 'pm.unit_cost')
      .orderBy('pc.category_id')
      .orderBy('pm.product_name');

    return rows.map(formatCommitment);
  },

  /**
   * PUT /products/:id/save — save draft targets
   */
  async saveProduct(commitmentId, monthlyTargets, user) {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) {
      throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    }
    if (commitment.employee_code !== user.employeeCode) {
      throw Object.assign(new Error('You can only edit your own commitments.'), { status: 403 });
    }
    if (commitment.status === 'submitted' || commitment.status === 'approved') {
      throw Object.assign(new Error(`Cannot edit commitment in '${commitment.status}' status.`), { status: 400 });
    }

    await db('ts_product_commitments')
      .where({ id: commitmentId })
      .update({
        monthly_targets: JSON.stringify(monthlyTargets),
        status: 'draft',
      });

    // Re-fetch with DISTINCT ON subquery to avoid duplicate rows from product_master
    const pmSub = db('product_master')
      .distinctOn('productcode')
      .select('productcode', 'product_name', 'product_category', 'product_family', 'product_subgroup', 'quota_price__c AS unit_cost')
      .orderBy('productcode')
      .orderBy('product_name')
      .as('pm');
    const updated = await db('ts_product_commitments AS pc')
      .join(pmSub, 'pm.productcode', 'pc.product_code')
      .where('pc.id', commitmentId)
      .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family', 'pm.product_subgroup', 'pm.unit_cost')
      .first();
    return formatCommitment(updated);
  },

  /**
   * POST /products/:id/submit — submit for manager approval
   */
  async submitProduct(commitmentId, user, comments = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.employee_code !== user.employeeCode) {
      throw Object.assign(new Error('You can only submit your own commitments.'), { status: 403 });
    }
    if (commitment.status !== 'draft') {
      throw Object.assign(new Error(`Can only submit from 'draft' status. Current: '${commitment.status}'.`), { status: 400 });
    }

    await db('ts_product_commitments')
      .where({ id: commitmentId })
      .update({ status: 'submitted', submitted_at: new Date() });

    await db('ts_commitment_approvals').insert({
      commitment_id: commitmentId,
      action: 'submitted',
      actor_code: user.employeeCode,
      
      actor_role: user.role,
      comments,
    });

    return { success: true, productId: commitmentId, status: 'submitted' };
  },

  /**
   * POST /products/submit-multiple — bulk submit
   */
  async submitMultiple(productIds, user) {
    const commitments = await db('ts_product_commitments')
      .whereIn('id', productIds)
      .where('employee_code', user.employeeCode)
      .where('status', 'draft');

    if (commitments.length === 0) {
      throw Object.assign(new Error('No eligible draft commitments found.'), { status: 400 });
    }

    const validIds = commitments.map((c) => c.id);

    await db('ts_product_commitments')
      .whereIn('id', validIds)
      .update({ status: 'submitted', submitted_at: new Date() });

    const approvalRows = validIds.map((id) => ({
      commitment_id: id,
      action: 'submitted',
      actor_code: user.employeeCode,
      
      actor_role: user.role,
    }));
    await db('ts_commitment_approvals').insert(approvalRows);

    return { success: true, submittedCount: validIds.length };
  },

  /**
   * POST /products/save-all — bulk save drafts
   */
  async saveAll(products, user) {
    let savedCount = 0;

    // Fetch unit_cost for all products in one query
    const productIds = products.map((p) => p.id);
    const pmSub = db('product_master')
      .distinctOn('productcode')
      .select('productcode', 'quota_price__c AS unit_cost')
      .orderBy('productcode')
      .as('pm');
    const commitmentRows = await db('ts_product_commitments AS pc')
      .join(pmSub, 'pm.productcode', 'pc.product_code')
      .whereIn('pc.id', productIds)
      .where('pc.employee_code', user.employeeCode)
      .whereIn('pc.status', ['draft', 'not_started'])
      .select('pc.id', 'pm.unit_cost');
    const unitCostMap = Object.fromEntries(
      commitmentRows.map((r) => [r.id, parseFloat(r.unit_cost || 0)])
    );

    for (const p of products) {
      if (!unitCostMap.hasOwnProperty(p.id)) continue; // not found or wrong status

      const unitCost = unitCostMap[p.id];

      // Compute cyRev = cyQty × unit_cost for each month
      const enrichedTargets = {};
      for (const [month, data] of Object.entries(p.monthlyTargets || {})) {
        enrichedTargets[month] = {
          ...data,
          cyRev: Math.round((data.cyQty || 0) * unitCost),
        };
      }

      await db('ts_product_commitments')
        .where({ id: p.id })
        .update({
          monthly_targets: JSON.stringify(enrichedTargets),
          status: 'draft',
        });
      savedCount++;
    }
    return { success: true, savedCount };
  },

  /**
   * GET /salesrep/dashboard-summary
   * targetValue = cy_target_value published by TBM in ts_yearly_target_assignments
   *               (what TBM assigned as THIS year's target for the SR)
   * cyRev       = sum of cyRev entered by sales rep in monthly_targets (cyQty x unit_cost)
   */
  async getDashboardSummary(employeeCode) {
    // activeFy = FY25_26 (current product commitment year — stays active always)
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return null;

    // nextFy = FY26_27 — yearly target assignments (ly_target_value, cy_target_value)
    // are stored under the NEXT fiscal year, not the active one.
    // Compute by incrementing the two digit pairs in FY25_26 → FY26_27
    const nextFyCode = activeFy.code.replace(/FY(\d{2})_(\d{2})/, (_, y1, y2) =>
      `FY${String(parseInt(y1) + 1).padStart(2,'0')}_${String(parseInt(y2) + 1).padStart(2,'0')}`
    );
    const nextFy = await db('ts_fiscal_years').where('code', nextFyCode).first();
    const nextFyLabel = nextFy?.label || nextFyCode.replace('FY', '').replace('_', '-');

    const commitments = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: activeFy.code });

    const totals = aggregateMonthlyTargets(commitments);

    // ── LY Revenue: from ts_yearly_target_assignments under NEXT FY (ly_target_value = LY target set by TBM)
    // Fallback to SUM(target_revenue) from ts_product_commitments flat column
    const lyAssignRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: employeeCode, fiscal_year_code: nextFyCode })
      .sum('ly_target_value as total')
      .first();

    const lyRevFlatRow = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: activeFy.code })
      .sum('target_revenue as total')
      .first();

    const lyRev = (lyAssignRow?.total && parseFloat(lyAssignRow.total) > 0)
      ? parseFloat(lyAssignRow.total)
      : (lyRevFlatRow?.total ? parseFloat(lyRevFlatRow.total) : 0);

    // ── CY Target: TBM-assigned target stored under NEXT FY (cy_target_value)
    const cyAssignRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: employeeCode, fiscal_year_code: nextFyCode })
      .sum('cy_target_value as total')
      .first();

    const targetValue = (cyAssignRow?.total && parseFloat(cyAssignRow.total) > 0)
      ? parseFloat(cyAssignRow.total)
      : 0;

    return {
      ...totals,
      lyRev,
      targetValue,  // TBM's CY target for this SR (from FY26_27 row)
      qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty),
      revGrowth: calcGrowth(targetValue, totals.cyRev),
      aopAchievementPct: targetValue > 0 ? Math.round((totals.cyRev / targetValue) * 100) : 0,
      fiscalYear: nextFyLabel,   // "2026-27" — shown in grid header
      totalProducts: commitments.length,
      draftCount: commitments.filter((c) => c.status === 'draft').length,
      submittedCount: commitments.filter((c) => c.status === 'submitted').length,
      approvedCount: commitments.filter((c) => c.status === 'approved').length,
    };
  },

  /**
   * GET /salesrep/quarterly-summary
   */
  async getQuarterlySummary(employeeCode, fiscalYearCode) {
    const fy = fiscalYearCode || (await db('ts_fiscal_years').where('is_active', true).first())?.code;
    if (!fy) return { categories: [] };

    const commitments = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: fy });

    const byCategory = {};
    for (const c of commitments) {
      if (!byCategory[c.category_id]) {
        byCategory[c.category_id] = { categoryId: c.category_id, products: [] };
      }
      byCategory[c.category_id].products.push(c);
    }

    const quarters = {
      Q1: ['apr', 'may', 'jun'],
      Q2: ['jul', 'aug', 'sep'],
      Q3: ['oct', 'nov', 'dec'],
      Q4: ['jan', 'feb', 'mar'],
    };

    const categories = Object.values(byCategory).map((cat) => {
      const quarterData = {};
      for (const [qName, months] of Object.entries(quarters)) {
        let lyQty = 0, cyQty = 0, lyRev = 0, cyRev = 0;
        for (const prod of cat.products) {
          const mt = prod.monthly_targets || {};
          for (const m of months) {
            const d = mt[m] || {};
            lyQty += Number(d.lyQty || 0);
            cyQty += Number(d.cyQty || 0);
            lyRev += Number(d.lyRev || 0);
            cyRev += Number(d.cyRev || 0);
          }
        }
        quarterData[qName] = { lyQty, cyQty, lyRev, cyRev };
      }
      return { categoryId: cat.categoryId, quarters: quarterData };
    });

    return { categories };
  },

  /**
   * GET /salesrep/category-performance
   */
  async getCategoryPerformance(employeeCode) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];

    const commitments = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: activeFy.code });

    const byCategory = {};
    let totalCyRev = 0;

    for (const c of commitments) {
      if (!byCategory[c.category_id]) {
        byCategory[c.category_id] = { lyQty: 0, cyQty: 0, lyRev: 0, cyRev: 0 };
      }
      const agg = aggregateMonthlyTargets([c]);
      byCategory[c.category_id].lyQty += agg.lyQty;
      byCategory[c.category_id].cyQty += agg.cyQty;
      byCategory[c.category_id].lyRev += agg.lyRev;
      byCategory[c.category_id].cyRev += agg.cyRev;
      totalCyRev += agg.cyRev;
    }

    const categories = await db('ts_product_categories').where('is_active', true);
    const catMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

    return Object.entries(byCategory).map(([catId, data]) => ({
      categoryId: catId,
      name: catMap[catId] || catId,
      lyQty: data.lyQty,
      cyQty: data.cyQty,
      aopQty: 0,
      lyRev: data.lyRev,
      cyRev: data.cyRev,
      growth: calcGrowth(data.lyRev, data.cyRev),
      contribution: totalCyRev > 0 ? Math.round((data.cyRev / totalCyRev) * 100 * 10) / 10 : 0,
    }));
  },
  // PUT /products/:id/approve — manager approves a commitment
  async approveProduct(commitmentId, managerUser, comments = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only approve 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    const now = new Date();
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'approved', approved_at: now, approved_by_code: managerUser.employeeCode });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'approved', actor_code: managerUser.employeeCode, actor_role: managerUser.role, comments });
    return { success: true, submissionId: commitmentId, action: 'approved' };
  },

  // PUT /products/:id/reject — manager rejects a commitment back to draft
  async rejectProduct(commitmentId, managerUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only reject 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'draft', updated_at: new Date() });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'rejected', actor_code: managerUser.employeeCode, actor_role: managerUser.role, comments: reason });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },
};

module.exports = CommitmentService;

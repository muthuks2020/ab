const { db } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth, MONTHS } = require('../utils/helpers');

// Maps req.user.role (role_code from authenticate middleware) to product_master.product_category values.
// Case-insensitive match used in query. Add new specialist roles here as needed.
const SPECIALIST_ROLE_CATEGORIES = {
  eq_spec_diagnostic: ['equipment'],
  eq_mgr_diagnostic:  ['equipment'],
  eq_spec_surgical:   ['equipment'],
  eq_mgr_surgical:    ['equipment'],
  at_iol_specialist:  ['iol'],
  at_iol_manager:     ['iol'],
};

const CommitmentService = {

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

  async getProducts(employeeCode, fiscalYearCode, userRole) {
    const activeFy = fiscalYearCode || 'FY26_27';

    // Include active_from/active_to so frontend can grey pre-start months
    const pmSubquery = db('product_master')
      .distinctOn('productcode')
      .select('productcode', 'product_name', 'product_category', 'product_family', 'product_subgroup',
              'quota_price__c AS unit_cost', 'active_from', 'active_to')
      .orderBy('productcode')
      .orderBy('product_name')
      .as('pm');

    const rows = await db('ts_product_commitments AS pc')
      .join(pmSubquery, 'pm.productcode', 'pc.product_code')
      .where('pc.employee_code', employeeCode)
      .modify((qb) => { if (activeFy) qb.where('pc.fiscal_year_code', activeFy); })
      .select('pc.*', 'pm.product_name', 'pm.product_category', 'pm.product_family',
              'pm.product_subgroup', 'pm.unit_cost', 'pm.active_from', 'pm.active_to')
      .orderBy('pc.category_id')
      .orderBy('pm.product_name');

    // Map commitment rows — attach activeFrom so grid can grey pre-start months
    const toDate = (v) => v ? new Date(v).toISOString().slice(0, 10) : null;
    const commitmentProducts = rows.map((r) => ({
      ...formatCommitment(r),
      activeFrom: toDate(r.active_from),
      activeTo:   toDate(r.active_to),
    }));

    // ── Specialist role catalog stubs ────────────────────────────────────────
    // Specialist users (equipment/IOL) may have no commitment rows yet because
    // their products are regular catalog entries without active_from set.
    // Inject all matching product_master rows as stubs based on role_code so
    // the Target Entry Grid is populated on their first login.
    const existingCodes = new Set(rows.map((r) => r.product_code));
    const allowedCategories = userRole ? (SPECIALIST_ROLE_CATEGORIES[userRole] || null) : null;

    if (allowedCategories && allowedCategories.length > 0) {
      const specialistCatalogRows = await db('product_master')
        .where('isactive', true)
        .whereIn(db.raw('LOWER(product_category)'), allowedCategories)
        .distinctOn('productcode')
        .select('productcode', 'product_subgroup', 'product_name', 'product_category',
                'product_family', 'product_group', 'quota_price__c AS unit_cost',
                'active_from', 'active_to')
        .orderBy('productcode');

      for (const p of specialistCatalogRows) {
        if (!existingCodes.has(p.productcode)) {
          existingCodes.add(p.productcode);  // prevent duplication with AOP stubs below
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
      console.log('[getProducts] specialist role=' + userRole + ' categories=' + JSON.stringify(allowedCategories) + ' stubs=' + specialistCatalogRows.length);
    }

    // AOP-created products (active_from IS NOT NULL) not yet in commitments:
    // show as stubs so sales rep can enter targets from their start month.
    const aopRows = await db('product_master')
      .where('isactive', true)
      .whereNotNull('active_from')
      .whereRaw('active_from <= CURRENT_DATE')
      .whereRaw('(active_to IS NULL OR active_to >= CURRENT_DATE)')
      .select('productcode', 'product_subgroup', 'product_name', 'product_category',
              'product_family', 'product_group', 'quota_price__c AS unit_cost',
              'active_from', 'active_to');

    const stubProducts = aopRows
      .filter((p) => !existingCodes.has(p.productcode))
      .map((p) => ({
        id:           p.productcode,   // string productcode — saveAll handles this
        productCode:  p.productcode,
        productName:  p.product_subgroup || p.product_name || '',
        categoryId:   (p.product_category || '').toLowerCase(),
        subcategory:  p.product_family  || '',
        unitCost:     parseFloat(p.unit_cost || 0),
        monthlyTargets: {},
        status:       'not_started',
        activeFrom:   toDate(p.active_from),
        activeTo:     toDate(p.active_to),
        isNewProduct: true,
      }));

    // ── Full catalog stubs for regular sales reps ────────────────────────────────
    // Specialist roles already get their category-filtered stubs above.
    // Regular sales reps (no allowedCategories) must see ALL active products even
    // if no FY26_27 commitment row exists yet. Inject stubs for any product not
    // already covered by commitment rows, specialist stubs, or AOP stubs.
    if (!allowedCategories) {
      const allCoveredCodes = new Set([
        ...existingCodes,
        ...stubProducts.map((p) => p.productCode),
      ]);

      const catalogRows = await db('product_master')
        .where('isactive', true)
        .whereNull('active_from')          // AOP products already handled above
        .distinctOn('productcode')
        .select('productcode', 'product_subgroup', 'product_name', 'product_category',
                'product_family', 'quota_price__c AS unit_cost')
        .orderBy('productcode');

      for (const p of catalogRows) {
        if (!allCoveredCodes.has(p.productcode)) {
          allCoveredCodes.add(p.productcode);
          stubProducts.push({
            id:             p.productcode,
            productCode:    p.productcode,
            productName:    p.product_subgroup || p.product_name || p.productcode,
            categoryId:     (p.product_category || '').toLowerCase(),
            subcategory:    p.product_family || '',
            unitCost:       parseFloat(p.unit_cost || 0),
            monthlyTargets: {},
            status:         'not_started',
            activeFrom:     null,
            activeTo:       null,
            isNewProduct:   true,
          });
        }
      }
      console.log('[getProducts] catalog stubs injected for sales rep=' + employeeCode + ' count=' + catalogRows.length);
    }

    // ── Revenue-only category stubs ──────────────────────────────────────────────
    // Revenue-only categories (e.g. MSI) have no per-product rows in product_master
    // with active_from set, so they never appear as AOP stubs. If a rep has no
    // existing commitment rows for such a category, catProducts in
    // renderRevenueOnlyCategory becomes [], firstProduct = undefined, and the
    // onChange guard `if (firstProduct)` silently blocks all keyboard input.
    // Fix: for each revenue-only category with no products yet, inject one
    // representative product_master entry as a stub so the input is bindable.
    const revOnlyCats = await db('ts_product_categories')
      .where({ is_active: true, is_revenue_only: true })
      .select('id');

    const allProductsSoFar = [...commitmentProducts, ...stubProducts];

    for (const cat of revOnlyCats) {
      const alreadyHasProduct = allProductsSoFar.some((p) => p.categoryId === cat.id);
      if (!alreadyHasProduct) {
        const firstPm = await db('product_master')
          .where({ isactive: true })
          .whereRaw('LOWER(product_category) = LOWER(?)', [cat.id])
          .orderBy('productcode')
          .first();
        if (firstPm) {
          stubProducts.push({
            id:             firstPm.productcode,
            productCode:    firstPm.productcode,
            productName:    firstPm.product_subgroup || firstPm.product_name || cat.id,
            categoryId:     cat.id,
            subcategory:    firstPm.product_family  || '',
            unitCost:       parseFloat(firstPm.quota_price__c || 0),
            monthlyTargets: {},
            status:         'not_started',
            activeFrom:     null,
            activeTo:       null,
            isNewProduct:   true,
          });
        }
      }
    }

    return [...commitmentProducts, ...stubProducts];
  },

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

  async saveAll(products, user) {
    let savedCount = 0;
    const activeFy = 'FY26_27';

    // ── Step 1: Create commitment rows for new AOP stub products (id = string productcode) ──
    const newStubs = products.filter((p) => p.isNewProduct && typeof p.id === 'string');
    for (const stub of newStubs) {
      // Check if commitment row was already created (concurrent save guard)
      const existing = await db('ts_product_commitments')
        .where({ employee_code: user.employeeCode, fiscal_year_code: activeFy, product_code: stub.id })
        .first();
      if (!existing) {
        const [newRow] = await db('ts_product_commitments').insert({
          fiscal_year_code: activeFy,
          employee_code:    user.employeeCode,
          employee_role:    user.role || 'sales_rep',
          product_code:     stub.id,
          category_id:      stub.categoryId || null,
          territory_code:   user.territory_code || user.territoryCode || null,
          territory_name:   user.territory_name || user.territoryName || null,
          area_code:        user.area_code      || user.areaCode      || null,
          area_name:        user.area_name      || user.areaName      || null,
          zone_code:        user.zone_code      || user.zoneCode      || null,
          zone_name:        user.zone_name      || user.zoneName      || null,
          monthly_targets:  JSON.stringify({}),
          status:           'draft',
        }).returning('id');
        // Replace stub's string id with the new integer commitment id in-memory
        stub._newId = newRow.id;
      } else {
        stub._newId = existing.id;
      }
    }

    // ── Step 2: Build id list — use _newId for stubs, integer id for existing ──
    const resolvedProducts = products.map((p) =>
      p._newId != null ? { ...p, id: p._newId } : p
    );

    const productIds = resolvedProducts
      .filter((p) => !p.isNewProduct || p._newId != null)
      .map((p) => p.id);

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

    for (const p of resolvedProducts) {
      if (!unitCostMap.hasOwnProperty(p.id)) continue;

      const unitCost = unitCostMap[p.id];

      const enrichedTargets = {};
      for (const [month, data] of Object.entries(p.monthlyTargets || {})) {
        enrichedTargets[month] = {
          ...data,
          // For revenue-only products (unitCost=0, e.g. MSI): preserve the cyRev entered by the user.
          // For qty-based products: recompute cyRev from cyQty × unitCost as normal.
          cyRev: unitCost > 0
            ? Math.round((data.cyQty || 0) * unitCost)
            : Math.round(data.cyRev || 0),
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

  async getDashboardSummary(employeeCode) {

    // CY is always FY26_27, LY is always FY25_26 — fixed, never derived dynamically
    const cyFyCode = 'FY26_27';
    const lyFyCode = 'FY25_26';
    const cyFyLabel = '26-27';

    const commitments = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: cyFyCode });

    const totals = aggregateMonthlyTargets(commitments);

    const lyAssignRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: employeeCode, fiscal_year_code: cyFyCode })
      .sum('ly_target_value as total')
      .first();

    const lyRevFlatRow = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: lyFyCode })
      .sum('target_revenue as total')
      .first();

    const lyRev = (lyAssignRow?.total && parseFloat(lyAssignRow.total) > 0)
      ? parseFloat(lyAssignRow.total)
      : (lyRevFlatRow?.total ? parseFloat(lyRevFlatRow.total) : 0);

    const cyAssignRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: employeeCode, fiscal_year_code: cyFyCode })
      .sum('cy_target_value as total')
      .first();

    const targetValue = (cyAssignRow?.total && parseFloat(cyAssignRow.total) > 0)
      ? parseFloat(cyAssignRow.total)
      : 0;

    // LY achieved value — from ly_achieved_value column in FY26_27 assignment rows
    const lyAchRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: employeeCode, fiscal_year_code: cyFyCode })
      .sum('ly_achieved_value as total')
      .first();
    const lyAchieved = (lyAchRow?.total && parseFloat(lyAchRow.total) > 0)
      ? parseFloat(lyAchRow.total)
      : 0;

    return {
      ...totals,
      lyRev,
      lyAchieved,
      targetValue,
      qtyGrowth: calcGrowth(totals.lyQty, totals.cyQty),
      revGrowth: calcGrowth(targetValue, totals.cyRev),
      aopAchievementPct: targetValue > 0 ? Math.round((totals.cyRev / targetValue) * 100) : 0,
      fiscalYear: cyFyLabel,
      totalProducts: commitments.length,
      draftCount: commitments.filter((c) => c.status === 'draft').length,
      submittedCount: commitments.filter((c) => c.status === 'submitted').length,
      approvedCount: commitments.filter((c) => c.status === 'approved').length,
    };
  },

  async getQuarterlySummary(employeeCode, fiscalYearCode) {
    const fy = fiscalYearCode || 'FY26_27';
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

  async getCategoryPerformance(employeeCode) {
    const commitments = await db('ts_product_commitments')
      .where({ employee_code: employeeCode, fiscal_year_code: 'FY26_27' });

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

  async approveProduct(commitmentId, managerUser, comments = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted') throw Object.assign(new Error(`Can only approve 'submitted'. Current: '${commitment.status}'.`), { status: 400 });
    const now = new Date();
    await db('ts_product_commitments').where({ id: commitmentId }).update({ status: 'approved', approved_at: now, approved_by_code: managerUser.employeeCode });
    await db('ts_commitment_approvals').insert({ commitment_id: commitmentId, action: 'approved', actor_code: managerUser.employeeCode, actor_role: managerUser.role, comments });
    return { success: true, submissionId: commitmentId, action: 'approved' };
  },

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

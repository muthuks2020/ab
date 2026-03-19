const { db, getKnex } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');

function normalizeFY(fyCode) {
  if (!fyCode) return fyCode;
  if (/^FY\d{2}_\d{2}$/.test(fyCode)) return fyCode;
  const m = fyCode.match(/(\d{4})-(\d{2})/);
  if (m) return `FY${String(m[1]).slice(-2)}_${m[2]}`;
  return fyCode;
}

const TBMService = {

  async getSalesRepSubmissions(tbmEmployeeCode, filters = {}) {
    const directReports = await getKnex().raw(
      `SELECT employee_code FROM aop.ts_fn_get_direct_reports(?::varchar)`,
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

  async bulkApproveSalesRep(submissionIds, tbmUser, comments = '') {
    const directReports = await getKnex().raw(
      `SELECT employee_code FROM aop.ts_fn_get_direct_reports(?::varchar)`,
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

  async bulkRejectSalesRep(submissionIds, tbmUser, reason = '') {
    const directReports = await getKnex().raw(`SELECT employee_code FROM aop.ts_fn_get_direct_reports(?::varchar)`, [tbmUser.employeeCode]);
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

  async getTerritoryTargets(tbmEmployeeCode, filters = {}) {
    const MONTH_NAME_MAP = {
      april:'apr', may:'may', june:'jun', july:'jul',
      august:'aug', september:'sep', october:'oct', november:'nov',
      december:'dec', january:'jan', february:'feb', march:'mar',
    };
    const MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

    const normalizeCat = (cat) => {
      if (!cat) return 'others';
      const c = cat.toLowerCase();
      if (c.includes('equipment')) return 'equipment';
      if (c.includes('iol'))       return 'iol';
      if (c.includes('consumable')) return 'consumable-sales';
      if (c.includes('msi') || c.includes('surgical')) return 'msi';
      return c.replace(/[\s-]+/g, '-');
    };

    const tbmUser = await db('ts_auth_users')
      .where('employee_code', tbmEmployeeCode)
      .first();
    const territoryCode = tbmUser?.territory_code;

    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    const activeFyCode = activeFy?.code;

    let productQuery = db('product_master').where('isactive', true);
    if (filters.categoryId) {
      const catMap = {
        'equipment': 'Equipment', 'iol': 'IOL',
        'consumable-sales': 'Consumable-Sales', 'msi': 'MSI',
      };
      if (catMap[filters.categoryId]) {
        productQuery = productQuery.where('product_category', catMap[filters.categoryId]);
      }
    }
    const allProducts = await productQuery
      .select(
        'productcode',
        'product_subgroup AS display_name',
        'product_category',
        'product_family AS subcategory',
        'product_group AS subgroup',
        'quota_price__c AS unit_cost'
      )
      .orderBy('product_family')
      .orderBy('product_group')
      .orderBy('product_subgroup');

    const productMap = {};
    allProducts.forEach((p) => {
      const code = p.productcode;
      productMap[code] = {
        id: code,
        productCode: code,
        code: code,
        name: p.display_name || code,
        categoryId: normalizeCat(p.product_category),
        subcategory: p.subcategory || null,
        subgroup: p.subgroup || null,
        unitCost: Number(p.unit_cost) || 0,
        status: 'not_started',
        monthlyTargets: {},
      };
      MONTHS.forEach((m) => {
        productMap[code].monthlyTargets[m] = { cyQty: 0, cyRev: 0, lyQty: 0, lyRev: 0 };
      });
    });

    if (activeFyCode) {
      let cyQuery = db('ts_product_commitments')
        .where('employee_code', tbmEmployeeCode)
        .where('fiscal_year_code', activeFyCode);
      if (filters.status) cyQuery = cyQuery.where('status', filters.status);

      const cyRows = await cyQuery.select(
        'id', 'product_code', 'fiscal_month', 'status',
        'target_quantity', 'target_revenue', 'monthly_targets'
      );

      cyRows.forEach((r) => {
        const code = r.product_code;
        if (!productMap[code]) return;
        const monthKey = MONTH_NAME_MAP[r.fiscal_month?.toLowerCase()];
        if (!monthKey) return;

        productMap[code].status = r.status || 'draft';
        productMap[code].id = r.id;

        const mt = r.monthly_targets || {};
        const cyQty = Number(mt[monthKey]?.cyQty ?? r.target_quantity ?? 0);
        const cyRev = Number(mt[monthKey]?.cyRev ?? r.target_revenue ?? 0);
        productMap[code].monthlyTargets[monthKey].cyQty = cyQty;
        productMap[code].monthlyTargets[monthKey].cyRev = cyRev;

        if (mt[monthKey]?.lyQty !== undefined) {
          productMap[code].monthlyTargets[monthKey].lyQty = Number(mt[monthKey].lyQty) || 0;
          productMap[code].monthlyTargets[monthKey].lyRev = Number(mt[monthKey].lyRev) || 0;
        }
      });
    }

    if (territoryCode) {
      const prevFyCode = activeFyCode === 'FY26_27' ? 'FY25_26' : null;
      const lyFyCode = prevFyCode || activeFyCode;

      const lyRows = await db('ts_geography_targets')
        .where('geo_level', 'territory')
        .where('fiscal_year_code', lyFyCode)
        .where('territory_code', String(territoryCode))
        .where(function () {
          this.where('target_quantity', '>', 0).orWhere('target_revenue', '>', 0);
        })
        .select('product_code', 'fiscal_month', 'target_quantity', 'target_revenue');

      lyRows.forEach((r) => {
        const code = r.product_code;
        if (!productMap[code]) return;
        const monthKey = MONTH_NAME_MAP[r.fiscal_month?.toLowerCase()];
        if (!monthKey) return;

        if (productMap[code].monthlyTargets[monthKey].lyQty === 0) {
          productMap[code].monthlyTargets[monthKey].lyQty = Number(r.target_quantity) || 0;
          productMap[code].monthlyTargets[monthKey].lyRev = Number(r.target_revenue) || 0;
        }
      });
    }

    // Fetch TBM's own yearly target assigned by ABM
    const ownAssignment = await db('ts_yearly_target_assignments')
      .where({ assignee_code: tbmEmployeeCode, fiscal_year_code: 'FY26_27' })
      .first();
    const cyTargetValue = ownAssignment ? parseFloat(ownAssignment.cy_target_value) || 0 : 0;

    return {
      products: Object.values(productMap).sort((a, b) =>
        a.categoryId.localeCompare(b.categoryId) || a.name.localeCompare(b.name)
      ),
      cyTargetValue,
    };
  },

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

  async getIndividualTargets(tbmEmployeeCode, filters = {}) {
    return this.getTerritoryTargets(tbmEmployeeCode, filters);
  },
  async saveIndividualTargets(targets, tbmUser) {
    return this.saveTerritoryTargets(targets, tbmUser);
  },
  async submitIndividualTargets(targetIds, tbmUser) {
    return this.submitTerritoryTargets(targetIds, tbmUser);
  },

  async getDashboardStats(tbmEmployeeCode) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return {};

    const directReports = await getKnex().raw(
      `SELECT employee_code, full_name FROM aop.ts_fn_get_direct_reports(?::varchar)`,
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

  async getYearlyTargets(tbmEmployeeCode, fiscalYearCode) {
    const rawFy = fiscalYearCode || (await db('ts_fiscal_years').where('is_active', true).first())?.code;
    const fy = normalizeFY(rawFy);
    if (!fy) return { members: [] };

    const computePrevFy = (fyCode) => {

      const m1 = fyCode.match(/FY(\d{2})_(\d{2})/);
      if (m1) {
        return `FY${String(parseInt(m1[1]) - 1).padStart(2,'0')}_${String(parseInt(m1[2]) - 1).padStart(2,'0')}`;
      }

      const m2 = fyCode.match(/(\d{4})-(\d{2})/);
      if (m2) {
        const y1 = parseInt(m2[1]) - 1;
        const y2 = parseInt(m2[2]) - 1;
        return `FY${String(y1).slice(-2)}_${String(y2).padStart(2,'0')}`;
      }
      return null;
    };
    const prevFyForLY = computePrevFy(fy);

    const directReports = await getKnex().raw(
      `SELECT employee_code, full_name, designation, territory_name FROM aop.ts_fn_get_direct_reports(?::varchar)`,
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

      let lyTargetValue   = assignment ? parseFloat(assignment.ly_target_value)  : 0;
      let lyAchievedValue = assignment ? parseFloat(assignment.ly_achieved_value) : 0;
      let lyTarget        = assignment ? parseFloat(assignment.ly_target_qty)     : 0;
      let lyAchieved      = assignment ? parseFloat(assignment.ly_achieved_qty)   : 0;

      const prevFy = prevFyForLY;

      if (!lyTargetValue && prevFy) {
        const lyResult = await db('ts_product_commitments')
          .where({ employee_code: sr.employee_code, fiscal_year_code: prevFy })
          .sum({ totalRev: 'target_revenue', totalQty: 'target_quantity' })
          .first();

        lyTargetValue = parseFloat(lyResult?.totalRev) || 0;
        lyTarget      = parseFloat(lyResult?.totalQty)  || 0;
      }

      if (!lyAchievedValue && prevFy) {
        const lyAssignment = await db('ts_yearly_target_assignments')
          .where({ fiscal_year_code: prevFy, assignee_code: sr.employee_code })
          .sum({ totalAchRev: 'ly_achieved_value', totalAchQty: 'ly_achieved_qty' })
          .first();

        lyAchievedValue = parseFloat(lyAssignment?.totalAchRev) || 0;
        lyAchieved      = parseFloat(lyAssignment?.totalAchQty)  || 0;
      }

      if (assignment && (lyTargetValue > 0 || lyAchievedValue > 0)) {
        await db('ts_yearly_target_assignments')
          .where({ id: assignment.id })
          .update({
            ly_target_value:   lyTargetValue,
            ly_target_qty:     lyTarget,
            ly_achieved_value: lyAchievedValue,
            ly_achieved_qty:   lyAchieved,
            updated_at:        new Date(),
          });
      }

      let categoryBreakdown = assignment?.category_breakdown || [];
      if (!Array.isArray(categoryBreakdown) || categoryBreakdown.length === 0) {
        const prevFy = prevFyForLY;

        const lyRows = prevFy
          ? await db('ts_product_commitments')
              .where({ employee_code: sr.employee_code, fiscal_year_code: prevFy })
              .groupBy('category_id')
              .select('category_id')
              .sum({ lyRev: 'target_revenue', lyQty: 'target_quantity' })
          : [];

        const lyAchRows = prevFy
          ? await db('ts_yearly_target_assignments')
              .where({ fiscal_year_code: prevFy, assignee_code: sr.employee_code })
              .groupBy('category_name')
              .select('category_name')
              .sum({ lyAchRev: 'ly_achieved_value', lyAchQty: 'ly_achieved_qty' })
          : [];

        const currCommitments = await db('ts_product_commitments')
          .where({ employee_code: sr.employee_code, fiscal_year_code: fy })
          .select('category_id', 'monthly_targets');

        const catCyMap = {};
        for (const c of currCommitments) {
          const catId = c.category_id; if (!catId) continue;
          if (!catCyMap[catId]) catCyMap[catId] = { cyRev: 0, cyQty: 0 };
          const mt = c.monthly_targets || {};
          for (const m of Object.values(mt)) {
            catCyMap[catId].cyRev += Number(m.cyRev || 0);
            catCyMap[catId].cyQty += Number(m.cyQty || 0);
          }
        }

        const lyAchMap = {};
        lyAchRows.forEach(r => {
          if (r.category_name) {
            lyAchMap[r.category_name.toLowerCase().replace(/[\s-]+/g, '-')] = r;
          }
        });

        const catIds = new Set([...lyRows.map(r => r.category_id), ...Object.keys(catCyMap)]);
        categoryBreakdown = Array.from(catIds).map(id => {
          const ly = lyRows.find(r => r.category_id === id) || {};
          const lyAch = lyAchMap[id] || {};
          const cy = catCyMap[id] || {};
          return {
            id,
            name: id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' '),
            lyTargetValue:   parseFloat(ly.lyRev) || 0,
            lyAchievedValue: parseFloat(lyAch.lyAchRev) || 0,
            lyTarget:        parseFloat(ly.lyQty)  || 0,
            lyAchieved:      parseFloat(lyAch.lyAchQty) || 0,
            cyTarget:        cy.cyQty || 0,
            cyTargetValue:   cy.cyRev || 0,
          };
        });
      }

      members.push({
        id: sr.employee_code,
        name: sr.full_name,
        territory: sr.territory_name,
        designation: sr.designation,
        lyTarget,
        lyAchieved,
        lyTargetValue,
        lyAchievedValue,
        cyTarget:      assignment ? parseFloat(assignment.cy_target_qty)   : 0,
        cyTargetValue: assignment ? parseFloat(assignment.cy_target_value) : 0,
        status: assignment?.status || 'not_set',
        lastUpdated: assignment?.updated_at || null,
        categoryBreakdown,
      });
    }

    return { members };
  },

  async saveYearlyTargets(tbmUser, fiscalYear, membersData) {
    const fy = normalizeFY(fiscalYear);
    let savedCount = 0;

    for (const m of membersData) {
      const existing = await db('ts_yearly_target_assignments')
        .where({
          fiscal_year_code: fy,
          manager_code: tbmUser.employeeCode,
          assignee_code: m.id,
        })
        .first();

      const data = {
        cy_target_qty: m.cyTarget || 0,
        cy_target_value: m.cyTargetValue || 0,
        category_breakdown: m.categoryBreakdown ? JSON.stringify(m.categoryBreakdown) : '[]',
        status: 'draft',
        updated_at: new Date(),
      };

      if (existing) {
        await db('ts_yearly_target_assignments').where({ id: existing.id }).update(data);
      } else {

        const assignee = await db('ts_auth_users').where({ employee_code: m.id }).first();
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code: fy,
          manager_code: tbmUser.employeeCode,
          manager_role: tbmUser.role,
          geo_level: 'territory',
          assignee_code: m.id,
          assignee_role: assignee?.role || 'sales_rep',
          territory_name: assignee?.territory_name || '',
          ...data,
        });
      }
      savedCount++;
    }

    return { success: true, savedCount };
  },

  async publishYearlyTargets(tbmUser, fiscalYear, memberIds) {
    const fy = normalizeFY(fiscalYear);
    let publishedCount = 0;

    for (const memberId of memberIds) {
      const updated = await db('ts_yearly_target_assignments')
        .where({
          fiscal_year_code: fy,
          manager_code: tbmUser.employeeCode,
          assignee_code: memberId,
        })
        .update({ status: 'published', published_at: new Date() });

      if (updated > 0) publishedCount++;
    }

    return { success: true, publishedCount };
  },

  async getTeamTargetsSummary(tbmEmployeeCode) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];
    const directReports = await getKnex().raw(`SELECT employee_code, full_name, territory_name FROM aop.ts_fn_get_direct_reports(?::varchar)`, [tbmEmployeeCode]);
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

  async getTeamTargetsForRep(tbmUser, repId) {
    const activeFy = await db('ts_fiscal_years').where('is_active', true).first();
    if (!activeFy) return [];
    const rows = await db('ts_team_product_targets')
      .where({ manager_code: tbmUser.employeeCode, member_code: repId, fiscal_year_code: activeFy.code });
    return rows;
  },

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

  async getTeamMembers(tbmEmployeeCode) {
    const directReports = await getKnex().raw(`SELECT employee_code, full_name, designation, territory_name, role FROM aop.ts_fn_get_direct_reports(?::varchar)`, [tbmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name, role: r.role }));
  },

  async getUniqueReps(tbmEmployeeCode) {
    const directReports = await getKnex().raw(`SELECT employee_code, full_name, designation, territory_name FROM aop.ts_fn_get_direct_reports(?::varchar)`, [tbmEmployeeCode]);
    return directReports.rows.map((r) => ({ employeeCode: r.employee_code, fullName: r.full_name, designation: r.designation, territory: r.territory_name }));
  },

  async saveSingleTerritoryTarget(targetId, monthlyTargets, tbmUser) {
    const target = await db('ts_geography_targets').where({ id: targetId }).first();
    if (!target) throw Object.assign(new Error('Target not found.'), { status: 404 });
    await db('ts_geography_targets').where({ id: targetId }).update({ monthly_targets: JSON.stringify(monthlyTargets), set_by_code: tbmUser.employeeCode, set_by_role: tbmUser.role, status: 'draft', updated_at: new Date() });
    return { success: true, targetId };
  },

  async saveSingleIndividualTarget(targetId, monthlyTargets, tbmUser) {
    const target = await db('ts_team_product_targets').where({ id: targetId }).first();
    if (!target) throw Object.assign(new Error('Target not found.'), { status: 404 });
    await db('ts_team_product_targets').where({ id: targetId }).update({ monthly_targets: JSON.stringify(monthlyTargets), status: 'draft', updated_at: new Date() });
    return { success: true, targetId };
  },
};

module.exports = TBMService;

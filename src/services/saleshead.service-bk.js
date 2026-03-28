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

    // Build WHERE clause dynamically
    const conditions = ['pc.fiscal_year_code = ?'];
    const bindings   = [activeFy];
    if (filters.status) {
      conditions.push('pc.status = ?');
      bindings.push(filters.status);
    } else {
      conditions.push("pc.status IN ('submitted', 'approved')");
    }
    if (filters.zoneCode)     { conditions.push('pc.zone_code = ?');     bindings.push(filters.zoneCode); }
    if (filters.employeeCode) { conditions.push('pc.employee_code = ?'); bindings.push(filters.employeeCode); }
    const whereClause = conditions.join(' AND ');

    // DISTINCT ON (employee_code, product_code) eliminates duplicate commitment rows.
    // The inner product_master subquery uses DISTINCT ON (productcode) to eliminate
    // duplicate product rows. Both were confirmed duplicated in the DB.
    // ORDER BY must lead with the DISTINCT ON columns; updated_at DESC picks the
    // most-recently-updated commitment when duplicates exist.
    
    const sql = `
      SELECT DISTINCT ON (pc.employee_code, pc.product_code)
        pc.*,
        pm.product_name,
        pm.product_category,
        pm.quota_price__c AS unit_cost,
        u.full_name  AS employee_name,
        u.role       AS employee_role
      FROM aop.ts_product_commitments AS pc
      JOIN (
        SELECT DISTINCT ON (productcode)
          productcode, product_name, product_category, quota_price__c
        FROM aop.product_master
        ORDER BY productcode
      ) pm ON pm.productcode = pc.product_code
      LEFT JOIN aop.ts_auth_users AS u ON u.employee_code = pc.employee_code
      WHERE ${whereClause}
      ORDER BY pc.employee_code, pc.product_code, pc.updated_at DESC
    `;

    const result = await getKnex().raw(sql, bindings);
    return result.rows.map(formatCommitment);
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
        `SELECT employee_code, full_name, designation, zone_name, area_name, territory_name, zone_code, area_code, territory_code, role
         FROM aop.ts_auth_users WHERE reports_to = ? AND is_active = true`,
        [empCode]
      );
      return res.rows;
    };

    const FISCAL_MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

    const getRepCommitments = async (empCode) => {
      // ── Step 1: CY products (FY26_27) ────────────────────────────────────
      // DISTINCT ON deduplicates commitments; inner subquery deduplicates product_master.
      // COALESCE cascades through product_name → product_family → product_group → code
      // so the UI always shows a human-readable label even when product_name is NULL.
      // target_revenue/target_quantity are the flat fallback when monthly_targets JSONB
      // is empty (rep submitted total but no monthly breakdown).
      const cySql = `
        SELECT DISTINCT ON (pc.product_code)
          pc.id,
          pc.product_code,
          pc.monthly_targets,
          pc.target_revenue   AS cy_flat_rev,
          pc.target_quantity  AS cy_flat_qty,
          pc.status,
          COALESCE(NULLIF(TRIM(pm.product_name), ''), NULLIF(TRIM(pm.product_family), ''),
                   NULLIF(TRIM(pm.product_group), ''), pc.product_code) AS product_name,
          pm.product_category
        FROM aop.ts_product_commitments AS pc
        LEFT JOIN (
          SELECT DISTINCT ON (productcode)
            productcode, product_name, product_category, product_family, product_group
          FROM aop.product_master
          ORDER BY productcode
        ) pm ON pm.productcode = pc.product_code
        WHERE pc.employee_code = ?
          AND pc.fiscal_year_code = 'FY26_27'
        ORDER BY pc.product_code, pc.updated_at DESC
      `;
      const cyRes = await getKnex().raw(cySql, [empCode]);
      console.log('[getRepCommitments] CY ' + empCode + ': ' + cyRes.rows.length + ' products');

      // ── Step 2: LY products (FY25_26) ────────────────────────────────────
      // FY25_26 monthly_targets JSONB is empty — real data lives in flat columns
      // target_revenue / target_quantity. Distribute evenly across 12 months.
      const lyRows = await db('ts_product_commitments')
        .where({ employee_code: empCode, fiscal_year_code: 'FY25_26' })
        .whereNotNull('product_code')
        .select('product_code', 'target_revenue', 'target_quantity', 'monthly_targets');

      // Build LY map: product_code → { lyRevPerMonth, lyQtyPerMonth }
      const lyMap = {};
      for (const r of lyRows) {
        const code = r.product_code;
        if (!lyMap[code]) lyMap[code] = { lyRevPerMonth: 0, lyQtyPerMonth: 0 };
        // Check if JSONB has any real cyRev data (rare case where FY25_26 has JSONB)
        const mt = r.monthly_targets || {};
        const jsonbTotal = FISCAL_MONTHS.reduce((s, m) => s + (mt[m]?.cyRev || mt[m]?.lyRev || 0), 0);
        if (jsonbTotal > 0) {
          // Use JSONB — distribute its monthly values
          FISCAL_MONTHS.forEach(m => {
            lyMap[code].lyRevPerMonth += (mt[m]?.cyRev || mt[m]?.lyRev || 0) / 12;
            lyMap[code].lyQtyPerMonth += (mt[m]?.cyQty || mt[m]?.lyQty || 0) / 12;
          });
        } else {
          // Use flat columns distributed evenly across 12 months
          lyMap[code].lyRevPerMonth += parseFloat(r.target_revenue || 0) / 12;
          lyMap[code].lyQtyPerMonth += parseInt(r.target_quantity  || 0) / 12;
        }
      }

      // ── Step 3: Merge CY + LY, then group by productName ────────────────
      // Multiple product_codes can share the same resolved product_name
      // (e.g. several Hydrophobic IOL SKUs all resolve to "Hydrophobic").
      // We sum their monthly values into one row per unique name.
      const nameMap = {}; // productName → accumulated entry

      for (const r of cyRes.rows) {
        const cyMt      = r.monthly_targets || {};
        const cyFlatRev = parseFloat(r.cy_flat_rev || 0);
        const cyFlatQty = parseInt(r.cy_flat_qty   || 0);
        const ly        = lyMap[r.product_code] || { lyRevPerMonth: 0, lyQtyPerMonth: 0 };
        const name      = r.product_name || r.product_code;

        // Determine if JSONB has any CY monthly data for this row
        const jsonbHasCyData = FISCAL_MONTHS.some(m => (cyMt[m]?.cyRev || 0) > 0);

        if (!nameMap[name]) {
          nameMap[name] = {
            productId:      r.product_code, // first code wins as representative id
            productName:    name,
            category:       r.product_category,
            status:         r.status,
            monthlyTargets: {},
          };
          FISCAL_MONTHS.forEach(m => { nameMap[name].monthlyTargets[m] = { cyRev: 0, cyQty: 0, lyRev: 0, lyQty: 0 }; });
        }

        FISCAL_MONTHS.forEach(m => {
          const cyMonth = cyMt[m] || {};
          const entry   = nameMap[name].monthlyTargets[m];
          entry.cyRev += cyMonth.cyRev || (!jsonbHasCyData ? cyFlatRev / 12 : 0);
          entry.cyQty += cyMonth.cyQty || (!jsonbHasCyData ? cyFlatQty / 12 : 0);
          entry.lyRev += ly.lyRevPerMonth;
          entry.lyQty += ly.lyQtyPerMonth;
        });
      }

      const products = Object.values(nameMap);

      // ── Step 4: Sort — non-zero totals first, then zeros ─────────────────
      return products.sort((a, b) => {
        const sumA = FISCAL_MONTHS.reduce((s, m) =>
          s + (a.monthlyTargets[m]?.lyRev || 0) + (a.monthlyTargets[m]?.cyRev || 0), 0);
        const sumB = FISCAL_MONTHS.reduce((s, m) =>
          s + (b.monthlyTargets[m]?.lyRev || 0) + (b.monthlyTargets[m]?.cyRev || 0), 0);
        if (sumA > 0 && sumB === 0) return -1;
        if (sumA === 0 && sumB > 0) return  1;
        return sumB - sumA; // descending by total value among non-zeros
      });
    };

    const ABM_ROLES = ['abm', 'area business manager', 'area_business_manager', 'area manager'];
    const TBM_ROLES = ['tbm', 'territory business manager', 'territory_business_manager', 'territory manager'];
    const SR_ROLES  = ['sales_rep', 'sales rep', 'sr', 'sales representative', 'sales_representative',
                       'equipment specialist - surgical systems', 'equipment specialist- surgical systems'];
    const isRole = (role, list) => list.includes((role || '').toLowerCase().trim());

    const shDirectReports = await getDirectReports(shEmployeeCode);
    console.log('[getZbmHierarchy] SH direct reports:', shDirectReports.length,
      shDirectReports.map(r => `${r.employee_code}:${r.role}`));

    // All SH direct reports are treated as ZBMs (same as getTeamYearlyTargets).
    // Role-string filtering was dropping ZBMs with non-standard role values in the DB.
    const zbmRows = shDirectReports;
    console.log('[getZbmHierarchy] ZBMs found:', zbmRows.length);

    // ── Build hierarchy skeleton with parallel queries ────────────────────
    // All levels use Promise.all so sibling nodes load concurrently instead
    // of waiting one-by-one — this alone cuts load time significantly.
    const result = await Promise.all(zbmRows.map(async (zbm) => {
      const abmRows = await getDirectReports(zbm.employee_code);
      console.log(`[getZbmHierarchy] ZBM ${zbm.employee_code} ABMs:`, abmRows.length);

      const abms = await Promise.all(abmRows.filter(r => isRole(r.role, ABM_ROLES)).map(async (abm) => {
        const tbmRows = await getDirectReports(abm.employee_code);
        console.log(`[getZbmHierarchy] ABM ${abm.employee_code} TBMs:`, tbmRows.length);

        const tbms = await Promise.all(tbmRows.filter(r => isRole(r.role, TBM_ROLES)).map(async (tbm) => {
          const srRows = await getDirectReports(tbm.employee_code);
          console.log(`[getZbmHierarchy] TBM ${tbm.employee_code} SRs:`, srRows.length);

          const salesReps = await Promise.all(srRows.filter(r => isRole(r.role, SR_ROLES)).map(async (sr) => {
            const products = await getRepCommitments(sr.employee_code);
            return {
              id: sr.employee_code,
              employeeCode: sr.employee_code,
              name: sr.full_name,
              fullName: sr.full_name,
              designation: sr.designation,
              territory: sr.territory_name || sr.area_name || sr.zone_name,
              code: sr.territory_code || '',
              zone: sr.zone_name,
              lyTgt: 0,
              lyAhv: 0,
              products,
            };
          }));

          return {
            id: tbm.employee_code,
            employeeCode: tbm.employee_code,
            name: tbm.full_name,
            fullName: tbm.full_name,
            designation: tbm.designation,
            territory: tbm.area_name || tbm.zone_name,
            code: tbm.territory_code || tbm.area_code || '',
            zone: tbm.zone_name,
            lyTgt: 0,
            lyAhv: 0,
            salesReps,
          };
        }));

        return {
          id: abm.employee_code,
          employeeCode: abm.employee_code,
          name: abm.full_name,
          fullName: abm.full_name,
          designation: abm.designation,
          territory: abm.area_name || abm.zone_name,
          code: abm.area_code || '',
          zone: abm.zone_name,
          lyTgt: 0,
          lyAhv: 0,
          tbms,
        };
      }));

      return {
        id: zbm.employee_code,
        employeeCode: zbm.employee_code,
        name: zbm.full_name,
        fullName: zbm.full_name,
        designation: zbm.designation,
        territory: zbm.zone_name,
        code: zbm.zone_code || '',
        zone: zbm.zone_name,
        lyTgt: 0,
        lyAhv: 0,
        abms,
      };
    }));

    console.log('[getZbmHierarchy] final result:', result.length, 'ZBMs');

    // ── Bulk-attach LY Tgt / LY Ahv to every node (2 queries total) ──────
    // Collect all employee codes across the entire hierarchy in one pass
    const allCodes = [];
    result.forEach(z => {
      allCodes.push(z.employeeCode);
      z.abms.forEach(a => {
        allCodes.push(a.employeeCode);
        a.tbms.forEach(t => {
          allCodes.push(t.employeeCode);
          t.salesReps.forEach(r => allCodes.push(r.employeeCode));
        });
      });
    });

    // Query 1: FY26_27 ly_target_value / ly_achieved_value (backfilled by each manager on save)
    // Matches abm.service priority — FY26_27 ly columns first
    const cyAssignRows = allCodes.length > 0
      ? await db('ts_yearly_target_assignments')
          .whereIn('assignee_code', allCodes)
          .where('fiscal_year_code', 'FY26_27')
          .select('assignee_code', 'ly_target_value', 'ly_achieved_value')
      : [];

    const lyMap = {};
    for (const r of cyAssignRows) {
      if (!lyMap[r.assignee_code]) lyMap[r.assignee_code] = { lyTgt: 0, lyAhv: 0 };
      lyMap[r.assignee_code].lyTgt += parseFloat(r.ly_target_value   || 0);
      lyMap[r.assignee_code].lyAhv += parseFloat(r.ly_achieved_value || 0);
    }

    // Query 2: Fallback for any node with no FY26_27 ly data — use FY25_26 cy_target_value
    const codesNoLyTgt = allCodes.filter(c => !(lyMap[c]?.lyTgt > 0));
    if (codesNoLyTgt.length > 0) {
      const lyAssignRows = await db('ts_yearly_target_assignments')
        .whereIn('assignee_code', codesNoLyTgt)
        .where('fiscal_year_code', 'FY25_26')
        .select('assignee_code', 'cy_target_value', 'ly_achieved_value');
      for (const r of lyAssignRows) {
        if (!lyMap[r.assignee_code]) lyMap[r.assignee_code] = { lyTgt: 0, lyAhv: 0 };
        lyMap[r.assignee_code].lyTgt += parseFloat(r.cy_target_value   || 0);
        if (!(lyMap[r.assignee_code].lyAhv > 0)) {
          lyMap[r.assignee_code].lyAhv += parseFloat(r.ly_achieved_value || 0);
        }
      }
    }

    // Query 3: Fallback for ALL nodes still missing lyTgt — sum ts_product_commitments FY25_26
    // Matches abm.service lyCommitMap: TBMs (and SRs) have commitment rows in FY25_26
    const allCodesNoData = allCodes.filter(c => !(lyMap[c]?.lyTgt > 0));
    if (allCodesNoData.length > 0) {
      const commitRows = await db('ts_product_commitments')
        .whereIn('employee_code', allCodesNoData)
        .where('fiscal_year_code', 'FY25_26')
        .select('employee_code')
        .sum({ lyTgt: 'target_revenue' })
        .groupBy('employee_code');
      for (const r of commitRows) {
        if (!lyMap[r.employee_code]) lyMap[r.employee_code] = { lyTgt: 0, lyAhv: 0 };
        lyMap[r.employee_code].lyTgt += parseFloat(r.lyTgt || 0);
      }
    }

    // Attach lyTgt/lyAhv to every node
    const attachLy = (node) => {
      const d = lyMap[node.employeeCode] || { lyTgt: 0, lyAhv: 0 };
      node.lyTgt = d.lyTgt;
      node.lyAhv = d.lyAhv;
    };
    result.forEach(z => {
      attachLy(z);
      z.abms.forEach(a => {
        attachLy(a);
        a.tbms.forEach(t => {
          attachLy(t);
          t.salesReps.forEach(r => attachLy(r));
        });
      });
    });
    // ── end bulk LY attachment ─────────────────────────────────────────────

    return result;
  },

  // Standalone method to fetch a single rep's product commitments.
  // Used by GET /saleshead/rep-products/:employeeCode for on-demand loading.
  async getRepProducts(empCode) {
    const sql = `
      SELECT DISTINCT ON (pc.product_code)
        pc.id,
        pc.product_code,
        pc.monthly_targets,
        pc.status,
        pm.product_name,
        pm.product_category
      FROM aop.ts_product_commitments AS pc
      LEFT JOIN (
        SELECT DISTINCT ON (productcode)
          productcode, product_name, product_category
        FROM aop.product_master
        ORDER BY productcode
      ) pm ON pm.productcode = pc.product_code
      WHERE pc.employee_code = ?
        AND pc.fiscal_year_code = 'FY26_27'
      ORDER BY pc.product_code, pc.updated_at DESC
    `;
    const res = await getKnex().raw(sql, [empCode]);
    return res.rows.map(r => ({
      productId:      r.product_code,
      productName:    r.product_name || r.product_code,
      category:       r.product_category,
      status:         r.status,
      monthlyTargets: r.monthly_targets || {},
    }));
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
        lyTargetValue:   lyTargetValue,
        lyAchievedValue: lyAchievedValue,
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

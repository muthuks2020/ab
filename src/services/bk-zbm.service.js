/**
 * zbm.service.js — Zonal Business Manager Service (v7 — FIXED)
 *
 * FIXES IN THIS VERSION:
 * 1. db.raw is not a function → use getKnex().raw()                        [v6]
 * 2. Wrong column names in ts_yearly_target_assignments                     [v6]
 *    (assigner_code/assigner_role/yearly_target → manager_code/manager_role/cy_target_value)
 * 3. aop.ts_fn_get_subordinates / ts_fn_get_direct_reports not deployed    [v6]
 *    → Replaced with inline recursive CTE + direct Knex queries
 * 4. getAbmHierarchy returned flat data — frontend needs deep nested:      [v7 NEW]
 *    ABM → TBM → SalesRep → Products (with monthly targets per product)
 */
'use strict';
const { db, getKnex } = require('../config/database');
const { formatCommitment, aggregateMonthlyTargets, calcGrowth } = require('../utils/helpers');
const GeographyService = require('./geography.service');

const FISCAL_MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

/* ─────────────────── shared inline helpers ─────────────────── */

/** ALL subordinates of rootEmpCode (recursive, every level below).
 *  Depth cap of 6 prevents infinite loops when reports_to chain has gaps/cycles.
 */
async function getSubordinates(rootEmpCode) {
  const result = await getKnex().raw(
    `WITH RECURSIVE hierarchy AS (
       SELECT employee_code, full_name, role::text AS role,
              zone_name, area_name, territory_name, reports_to,
              zone_code, area_code, 0 AS depth
       FROM   aop.ts_auth_users
       WHERE  employee_code = ? AND is_active = TRUE
       UNION ALL
       SELECT u.employee_code, u.full_name, u.role::text,
              u.zone_name, u.area_name, u.territory_name, u.reports_to,
              u.zone_code, u.area_code, h.depth + 1
       FROM   aop.ts_auth_users u
       JOIN   hierarchy h ON u.reports_to = h.employee_code
       WHERE  u.is_active = TRUE AND h.depth < 6
     )
     SELECT * FROM hierarchy ORDER BY depth, full_name`,
    [rootEmpCode]
  );
  return result.rows;
}

/**
 * Get ABM-level direct reports for a ZBM.
 * Uses single-level query (reports_to) NOT recursive — ABMs are exactly
 * one level below the ZBM. The old recursive CTE caused each ABM to appear
 * multiple times (once per path through the full hierarchy tree).
 * Fallback: zone_code match when reports_to chain is not configured.
 */
async function getAbmSubordinates(zbmEmployeeCode) {
  // Direct reports only — 1 level, no recursion
  const abmRows = await db('ts_auth_users')
    .where({ reports_to: zbmEmployeeCode, is_active: true })
    .whereRaw("role::text = 'Area Business Manager'")
    .select(
      'employee_code', 'full_name',
      getKnex().raw("role::text AS role"),
      'designation', 'zone_name', 'area_name', 'territory_name',
      'zone_code', 'area_code'
    )
    .orderBy('full_name');

  if (abmRows.length > 0) return abmRows;

  // Fallback: reports_to chain not configured — find ABMs by zone_code
  const zbmUser = await db('ts_auth_users')
    .where({ employee_code: zbmEmployeeCode, is_active: true })
    .first('zone_code');
  if (zbmUser?.zone_code) {
    return db('ts_auth_users')
      .where({ zone_code: zbmUser.zone_code, is_active: true })
      .whereRaw("role::text = 'Area Business Manager'")
      .whereNot({ employee_code: zbmEmployeeCode })
      .select(
        'employee_code', 'full_name',
        getKnex().raw("role::text AS role"),
        'designation', 'zone_name', 'area_name', 'territory_name',
        'zone_code', 'area_code'
      )
      .orderBy('full_name');
  }
  return [];
}

/**
 * Get ALL subordinates under a ZBM's ABMs (TBMs + Sales Reps).
 * Deduplicates by employee_code — the recursive CTE can return the same
 * person via multiple paths if the reports_to graph has any cross-links.
 * Fallback: zone_code when reports_to chain is broken.
 */
async function getAllSubordinatesUnderZbm(zbmEmployeeCode) {
  const subs = await getSubordinates(zbmEmployeeCode);
  // Deduplicate — keep first occurrence of each employee_code
  const seen = new Set();
  const allBelow = subs.filter((r) => {
    if (r.employee_code === zbmEmployeeCode) return false;
    if (seen.has(r.employee_code)) return false;
    seen.add(r.employee_code);
    return true;
  });

  // Fallback via zone_code
  if (allBelow.length === 0) {
    const zbmUser = await db('ts_auth_users')
      .where({ employee_code: zbmEmployeeCode, is_active: true })
      .first('zone_code');
    if (zbmUser?.zone_code) {
      return db('ts_auth_users')
        .where({ zone_code: zbmUser.zone_code, is_active: true })
        .whereNot({ employee_code: zbmEmployeeCode })
        .select('employee_code', 'full_name', getKnex().raw("role::text AS role"),
                'zone_name', 'area_name', 'territory_name', 'zone_code', 'area_code');
    }
  }
  return allBelow;
}

/** DIRECT reports only (1 level) of managerEmpCode. */
async function getDirectReports(managerEmpCode) {
  return db('ts_auth_users')
    .where({ reports_to: managerEmpCode, is_active: true })
    .select(
      'employee_code', 'full_name',
      getKnex().raw('role::text AS role'),
      'designation', 'email', 'phone',
      'zone_name', 'area_name', 'territory_name', 'zone_code', 'area_code', 'territory_code'
    )
    .orderBy('full_name');
}

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

/* ────────── drill-down builder (used by getAbmHierarchy) ────────── */

/**
 * Builds the full nested: ABM → TBM → SalesRep → Products shape
 * that ZBMTeamDrilldown.js expects.
 *
 * Shape returned per ABM:
 * {
 *   id, name, territory,
 *   tbms: [{
 *     id, name, territory,
 *     salesReps: [{
 *       id, name, territory,
 *       products: [{
 *         productId, productName, productCode, categoryId,
 *         monthlyTargets: { apr: { cyQty, cyRev, lyQty, lyRev }, … }
 *       }]
 *     }]
 *   }]
 * }
 */
async function buildAbmDrilldown(abm, activeFy) {
  // Fetch LY achieved value for this ABM from FY25_26 rows (assignee_code = abm)
  const lyAchRow = await db('ts_yearly_target_assignments')
    .where({ assignee_code: abm.employee_code, fiscal_year_code: 'FY25_26' })
    .sum({ total: 'ly_achieved_value' })
    .first();
  const lyAchieved = parseFloat(lyAchRow?.total || 0);

  const tbmRows = await getDirectReports(abm.employee_code);

  const tbms = await Promise.all(
    tbmRows.map(async (tbm) => {
      const repRows = await getDirectReports(tbm.employee_code);

      const salesReps = await Promise.all(
        repRows.map(async (rep) => {
          // get all commitments for this rep
          const commits = await db('ts_product_commitments AS pc')
            .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
            .where('pc.employee_code', rep.employee_code)
            .where('pc.fiscal_year_code', activeFy)
            .select(
              'pc.product_code',
              'pc.category_id',
              'pc.monthly_targets',
              'pm.product_name',
              getKnex().raw('pm.product_subgroup AS product_subgroup')
            );

          // Build product-level monthly targets
          const products = commits.map((c) => {
            const raw = c.monthly_targets || {};
            const monthlyTargets = {};
            for (const m of FISCAL_MONTHS) {
              monthlyTargets[m] = {
                cyQty:    Number(raw[m]?.cyQty    || 0),
                cyRev:    Number(raw[m]?.cyRev    || 0),
                lyQty:    Number(raw[m]?.lyQty    || 0),
                lyRev:    Number(raw[m]?.lyRev    || 0),
                lyAchRev: Number(raw[m]?.lyAchRev || 0),
                cyAchRev: Number(raw[m]?.cyAchRev || 0),
                aopQty:   Number(raw[m]?.aopQty   || 0),
              };
            }
            return {
              productId:   c.product_code,
              productCode: c.product_code,
              productName: c.product_name || c.product_subgroup || c.product_code,
              categoryId:  c.category_id,
              monthlyTargets,
            };
          });

          return {
            id:          rep.employee_code,
            name:        rep.full_name,
            designation: rep.designation || '',
            territory:   rep.territory_name || rep.area_name || '—',
            code:        rep.territory_code || '',
            role:        rep.role,
            products,
          };
        })
      );

      return {
        id:          tbm.employee_code,
        name:        tbm.full_name,
        designation: tbm.designation || '',
        territory:   tbm.territory_name || tbm.area_name || '—',
        code:        tbm.territory_code || tbm.area_code || '',
        role:        tbm.role,
        salesReps,
      };
    })
  );

  return {
    id:          abm.employee_code,
    name:        abm.full_name,
    designation: abm.designation || '',
    territory:   abm.area_name || '—',
    code:        abm.area_code || '',
    role:        abm.role,
    lyAchieved,
    tbms,
  };
}

/* ─────────────────────────────── service ────────────────────────────────── */

const ZBMService = {

  // GET /zbm/abm-submissions
  async getAbmSubmissions(zbmEmployeeCode, filters = {}) {
    const subs = await getAllSubordinatesUnderZbm(zbmEmployeeCode);
    const subCodes = subs.map((r) => r.employee_code);
    if (subCodes.length === 0) return [];

    const activeFy = filters.fy || (await getActiveFY());
    let query = db('ts_product_commitments AS pc')
      .join('product_master AS pm', 'pm.productcode', 'pc.product_code')
      .leftJoin('ts_auth_users AS u', 'u.employee_code', 'pc.employee_code')
      .whereIn('pc.employee_code', subCodes)
      .where('pc.fiscal_year_code', activeFy);

    if (filters.status) {
      query = query.where('pc.status', filters.status);
    } else {
      query = query.whereIn('pc.status', ['submitted', 'approved']);
    }

    const rows = await query
      .select(
        'pc.*',
        'pm.product_name',
        'pm.product_category',
        'pm.quota_price__c AS unit_cost',
        'u.full_name AS employee_name',
        getKnex().raw("u.role::text AS employee_role")
      )
      .orderBy('u.full_name')
      .orderBy('pm.product_name');

    return rows.map(formatCommitment);
  },

  // PUT /zbm/approve-abm/:id
  async approveAbm(commitmentId, zbmUser, { comments = '', corrections = null } = {}) {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted')
      throw Object.assign(
        new Error(`Can only approve 'submitted'. Current: '${commitment.status}'.`),
        { status: 400 }
      );
    const now = new Date();
    let action = 'approved';
    let originalValues = null;
    if (corrections && Object.keys(corrections).length > 0) {
      originalValues = { ...commitment.monthly_targets };
      const updated = { ...commitment.monthly_targets };
      for (const [month, values] of Object.entries(corrections)) {
        if (updated[month]) updated[month] = { ...updated[month], ...values };
      }
      await db('ts_product_commitments')
        .where({ id: commitmentId })
        .update({ monthly_targets: JSON.stringify(updated) });
      action = 'corrected_and_approved';
    }
    await db('ts_product_commitments').where({ id: commitmentId }).update({
      status: 'approved', approved_at: now, approved_by_code: zbmUser.employeeCode,
    });
    await db('ts_commitment_approvals').insert({
      commitment_id: commitmentId, action,
      actor_code: zbmUser.employeeCode, actor_role: zbmUser.role,
      corrections: corrections ? JSON.stringify(corrections) : null,
      original_values: originalValues ? JSON.stringify(originalValues) : null,
      comments,
    });
    return { success: true, submissionId: commitmentId, action };
  },

  // PUT /zbm/reject-abm/:id
  async rejectAbm(commitmentId, zbmUser, reason = '') {
    const commitment = await db('ts_product_commitments').where({ id: commitmentId }).first();
    if (!commitment) throw Object.assign(new Error('Commitment not found.'), { status: 404 });
    if (commitment.status !== 'submitted')
      throw Object.assign(
        new Error(`Can only reject 'submitted'. Current: '${commitment.status}'.`),
        { status: 400 }
      );
    await db('ts_product_commitments').where({ id: commitmentId }).update({
      status: 'draft', updated_at: new Date(),
    });
    await db('ts_commitment_approvals').insert({
      commitment_id: commitmentId, action: 'rejected',
      actor_code: zbmUser.employeeCode, actor_role: zbmUser.role, comments: reason,
    });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },

  // POST /zbm/bulk-approve-abm
  async bulkApproveAbm(submissionIds, zbmUser, comments = '') {
    const subs = await getSubordinates(zbmUser.employeeCode);
    const subCodes = subs
      .filter((r) => r.employee_code !== zbmUser.employeeCode)
      .map((r) => r.employee_code);
    const commitments = await db('ts_product_commitments')
      .whereIn('id', submissionIds)
      .where('status', 'submitted')
      .whereIn('employee_code', subCodes);
    if (commitments.length === 0)
      throw Object.assign(new Error('No eligible submissions.'), { status: 400 });
    const ids = commitments.map((c) => c.id);
    const now = new Date();
    await db('ts_product_commitments').whereIn('id', ids).update({
      status: 'approved', approved_at: now, approved_by_code: zbmUser.employeeCode,
    });
    await db('ts_commitment_approvals').insert(
      ids.map((id) => ({
        commitment_id: id, action: 'bulk_approved',
        actor_code: zbmUser.employeeCode, actor_role: zbmUser.role, comments,
      }))
    );
    return { success: true, approvedCount: ids.length };
  },

  // GET /zbm/zone-targets
  async getZoneTargets(zbmUser, fiscalYear) {
    const fy = fiscalYear || (await getActiveFY());
    return GeographyService.getGeographyTargets(
      'zone', zbmUser.zoneCode || zbmUser.zone_code, fy
    );
  },

  // GET /zbm/abm-hierarchy  ← FIXED: now returns full nested ABM→TBM→SR→Products
  async getAbmHierarchy(zbmEmployeeCode) {
    const activeFy = await getActiveFY();
    const directAbms = await getAbmSubordinates(zbmEmployeeCode);

    if (directAbms.length === 0) return [];

    return Promise.all(directAbms.map((abm) => buildAbmDrilldown(abm, activeFy)));
  },

  // GET /zbm/team-members
  async getTeamMembers(zbmEmployeeCode) {
    const directAbms = await getAbmSubordinates(zbmEmployeeCode);
    return directAbms.map((r) => ({
      employeeCode: r.employee_code,
      fullName:     r.full_name,
      designation:  r.designation,
      area:         r.area_name,
      areaCode:     r.area_code,
      role:         r.role,
    }));
  },

  // GET /zbm/team-yearly-targets
  async getTeamYearlyTargets(zbmEmployeeCode, fiscalYear) {
    const cyFy = 'FY26_27';
    const lyFy = 'FY25_26';

    const directAbms = await getAbmSubordinates(zbmEmployeeCode);
    const abmCodes = directAbms.map((r) => r.employee_code);

    // CY assignments (FY26_27) — queried by manager_code (ZBM sets these)
    const cyAssignments = await db('ts_yearly_target_assignments AS yta')
      .leftJoin('ts_auth_users AS u', 'u.employee_code', 'yta.assignee_code')
      .where('yta.manager_code', zbmEmployeeCode)
      .where('yta.fiscal_year_code', cyFy)
      .select('yta.*', 'u.full_name AS assignee_name', 'u.area_name');

    // LY targets: query FY25_26 rows directly at ABM level first (assignee_code = abmCode).
    // Fallback: if ABM-level rows have zero values, aggregate from TBM-level rows below.
    const abmLyMap = {}; // abmCode → categoryName → { lyTarget, lyAchieved }

    if (abmCodes.length > 0) {
      // PRIMARY: FY25_26 rows where ABM is the assignee
      const lyAbmRows = await db('ts_yearly_target_assignments')
        .whereIn('assignee_code', abmCodes)
        .where({ fiscal_year_code: lyFy })
        .select('assignee_code', 'category_name', 'ly_target_value', 'ly_achieved_value');

      for (const row of lyAbmRows) {
        const abmCode = row.assignee_code;
        const cat = row.category_name || 'Other';
        if (!abmLyMap[abmCode]) abmLyMap[abmCode] = {};
        if (!abmLyMap[abmCode][cat]) abmLyMap[abmCode][cat] = { lyTarget: 0, lyAchieved: 0 };
        abmLyMap[abmCode][cat].lyTarget   += parseFloat(row.ly_target_value   || 0);
        abmLyMap[abmCode][cat].lyAchieved += parseFloat(row.ly_achieved_value || 0);
      }

      // FALLBACK: for ABMs where ABM-level rows returned zero totals,
      // aggregate from TBM-level FY25_26 rows below them.
      const abmsWithNoData = abmCodes.filter((code) => {
        const cats = abmLyMap[code] || {};
        const total = Object.values(cats).reduce((s, v) => s + v.lyTarget + v.lyAchieved, 0);
        return total === 0;
      });

      if (abmsWithNoData.length > 0) {
        const tbmRows = await db('ts_auth_users')
          .whereIn('reports_to', abmsWithNoData)
          .where({ is_active: true })
          .select('employee_code', 'reports_to');

        const tbmCodes = tbmRows.map((r) => r.employee_code);
        const tbmToAbm = {};
        tbmRows.forEach((r) => { tbmToAbm[r.employee_code] = r.reports_to; });

        if (tbmCodes.length > 0) {
          const lyTbmRows = await db('ts_yearly_target_assignments')
            .whereIn('assignee_code', tbmCodes)
            .where({ fiscal_year_code: lyFy })
            .select('assignee_code', 'category_name', 'ly_target_value', 'ly_achieved_value');

          for (const row of lyTbmRows) {
            const abmCode = tbmToAbm[row.assignee_code];
            if (!abmCode) continue;
            const cat = row.category_name || 'Other';
            if (!abmLyMap[abmCode]) abmLyMap[abmCode] = {};
            if (!abmLyMap[abmCode][cat]) abmLyMap[abmCode][cat] = { lyTarget: 0, lyAchieved: 0 };
            abmLyMap[abmCode][cat].lyTarget   += parseFloat(row.ly_target_value   || 0);
            abmLyMap[abmCode][cat].lyAchieved += parseFloat(row.ly_achieved_value || 0);
          }
        }
      }
    }

    const members = directAbms.map((r) => {
      const cyRows = cyAssignments.filter((a) => a.assignee_code === r.employee_code);
      const abmLy  = abmLyMap[r.employee_code] || {};

      let targets;

      if (cyRows.length > 0) {
        targets = cyRows.map((a) => {
          const cat = a.category_name || 'Other';
          const ly  = abmLy[cat] || {};
          return {
            id:           a.id,
            categoryName: a.category_name,
            yearlyTarget: parseFloat(a.cy_target_value || 0),
            lyTarget:     ly.lyTarget   || parseFloat(a.ly_target_value   || 0),
            lyAchieved:   ly.lyAchieved || parseFloat(a.ly_achieved_value || 0),
            status:       a.status,
            area:         a.area_name,
          };
        });
      } else {
        // No CY rows yet — build skeleton from abmLyMap
        targets = Object.entries(abmLy).map(([cat, ly]) => ({
          id:           null,
          categoryName: cat,
          yearlyTarget: 0,
          lyTarget:     ly.lyTarget,
          lyAchieved:   ly.lyAchieved,
          status:       'not_set',
          area:         r.area_name,
        }));
      }

      return {
        employeeCode: r.employee_code,
        fullName:     r.full_name,
        designation:  r.designation || '',
        area:         r.area_name,
        areaCode:     r.area_code,
        targets,
      };
    });

    return { fiscalYear: cyFy, members };
  },

  // POST /zbm/team-yearly-targets/save
  async saveTeamYearlyTargets(targets, zbmUser, fiscalYear) {
    const fy = fiscalYear || (await getActiveFY());
    const now = new Date();
    // ts_yearly_target_assignments is one row per assignee — no product_code column.
    // Upsert: update if exists, insert if not.
    for (const t of targets) {
      const existing = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, manager_code: zbmUser.employeeCode, assignee_code: t.employeeCode })
        .first();

      const status     = t.status || 'draft';
      const pubAt      = (status === 'published') ? now : (existing ? existing.published_at : null);
      const breakdown  = Array.isArray(t.categoryBreakdown) ? JSON.stringify(t.categoryBreakdown) : '[]';

      if (existing) {
        await db('ts_yearly_target_assignments')
          .where('id', existing.id)
          .update({
            cy_target_value:    t.yearlyTarget,
            category_breakdown: breakdown,
            status,
            published_at:       pubAt,
            updated_at:         now,
          });
      } else {
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code:   fy,
          manager_code:       zbmUser.employeeCode,
          manager_role:       zbmUser.role,
          geo_level:          'area',
          assignee_code:      t.employeeCode,
          assignee_role:      'Area Business Manager',
          cy_target_value:    t.yearlyTarget,
          category_breakdown: breakdown,
          zone_code:          zbmUser.zoneCode || zbmUser.zone_code,
          area_code:          t.areaCode || null,
          status,
          published_at:       pubAt,
          created_at:         now,
          updated_at:         now,
        });
      }
    }
    return { success: true, savedCount: targets.length };
  },

  // POST /zbm/team-yearly-targets/publish
  async publishTeamYearlyTargets(memberIds, zbmUser, fiscalYear) {
    const fy = fiscalYear || (await getActiveFY());
    const now = new Date();
    const updated = await db('ts_yearly_target_assignments')
      .where('manager_code',     zbmUser.employeeCode)
      .where('fiscal_year_code', fy)
      .whereIn('assignee_code',  memberIds)
      .update({ status: 'published', published_at: now, updated_at: now });
    return { success: true, publishedCount: updated };
  },

  // GET /zbm/dashboard-stats
  async getDashboardStats(zbmEmployeeCode) {
    const activeFy = await getActiveFY();
    const subs = await getAllSubordinatesUnderZbm(zbmEmployeeCode);
    const subCodes = subs.map((r) => r.employee_code);
    const allCodes = [...subCodes, zbmEmployeeCode];
    const commitments =
      allCodes.length > 0
        ? await db('ts_product_commitments')
            .whereIn('employee_code', allCodes)
            .where('fiscal_year_code', activeFy)
        : [];
    const totals = aggregateMonthlyTargets(commitments);
    const directAbms = await getAbmSubordinates(zbmEmployeeCode);
    return {
      totalAbms:        directAbms.length,
      totalCommitments: commitments.length,
      pending:          commitments.filter((c) => c.status === 'submitted').length,
      approved:         commitments.filter((c) => c.status === 'approved').length,
      draft:            commitments.filter((c) => c.status === 'draft').length,
      revGrowth:        calcGrowth(totals.lyRev, totals.cyRev),
      qtyGrowth:        calcGrowth(totals.lyQty, totals.cyQty),
    };
  },

  // GET /zbm/sh-assigned-target
  async getSHAssignedTarget(zbmEmployeeCode) {
    const CY_FY = 'FY26_27';
    const LY_FY = 'FY25_26';
    const cyRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: zbmEmployeeCode, fiscal_year_code: CY_FY })
      .first('cy_target_value');
    const lyRow = await db('ts_yearly_target_assignments')
      .where({ assignee_code: zbmEmployeeCode, fiscal_year_code: LY_FY })
      .sum({ lyTarget: 'ly_target_value', lyAchieved: 'ly_achieved_value' })
      .first();
    return {
      shAssignedTarget: cyRow ? (parseFloat(cyRow.cy_target_value) || 0) : 0,
      lyTarget:         lyRow ? (parseFloat(lyRow.lyTarget)         || 0) : 0,
      lyAchieved:       lyRow ? (parseFloat(lyRow.lyAchieved)       || 0) : 0,
    };
  },

  // GET /zbm/unique-abms
  async getUniqueAbms(zbmEmployeeCode) {
    const directAbms = await getAbmSubordinates(zbmEmployeeCode);
    return directAbms.map((r) => ({
      employeeCode: r.employee_code,
      fullName:     r.full_name,
      designation:  r.designation,
      area:         r.area_name,
    }));
  },
};

module.exports = ZBMService;

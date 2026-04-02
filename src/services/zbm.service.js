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
  // Reads from ts_geography_targets (area level) — ABMs save their area targets there.
  async getAbmSubmissions(zbmEmployeeCode, filters = {}) {
    const directAbms = await getAbmSubordinates(zbmEmployeeCode);
    if (directAbms.length === 0) return [];

    // Map area_code → { abmCode, abmName } for tagging each returned row
    const areaToAbmMap = {};
    directAbms.forEach((abm) => {
      if (abm.area_code) {
        areaToAbmMap[String(abm.area_code)] = {
          abmCode: abm.employee_code,
          abmName: abm.full_name,
          abmArea: abm.area_name || '',
        };
      }
    });

    const areaCodes = directAbms.map((a) => String(a.area_code)).filter(Boolean);
    if (areaCodes.length === 0) return [];

    const fy = filters.fy || 'FY26_27';

    let query = db('ts_geography_targets AS gt')
      .join('product_master AS pm', 'pm.productcode', 'gt.product_code')
      .where('gt.geo_level', 'area')
      .where('gt.fiscal_year_code', fy)
      .whereIn('gt.area_code', areaCodes);

    if (filters.status) {
      query = query.where('gt.status', filters.status);
    } else {
      // Include draft so ZBM sees what ABM has entered even before submission
      query = query.whereIn('gt.status', ['draft', 'submitted', 'approved', 'published']);
    }

    // Filter by specific ABM's area_code if abmId (employee_code) is provided
    if (filters.abmId) {
      const abm = directAbms.find((a) => a.employee_code === filters.abmId);
      if (abm?.area_code) query = query.where('gt.area_code', String(abm.area_code));
    }

    const rows = await query
      .select(
        'gt.id',
        'gt.product_code',
        'gt.area_code',
        'gt.area_name',
        'gt.category_id',
        'gt.monthly_targets',
        'gt.status',
        'gt.set_by_code',
        'gt.created_at',
        'gt.updated_at',
        'pm.product_name',
        'pm.product_category',
        'pm.product_group',
        'pm.product_family',
        'pm.quota_price__c AS unit_cost',
        getKnex().raw('pm.product_subgroup AS product_subgroup')
      )
      .orderBy('gt.area_code')
      .orderBy('pm.product_name');

    return rows.map((r) => {
      const abmInfo = areaToAbmMap[String(r.area_code)] || {};
      const mt = r.monthly_targets || {};
      const monthlyTargets = {};
      for (const m of FISCAL_MONTHS) {
        monthlyTargets[m] = {
          cyQty:    Number(mt[m]?.cyQty    || 0),
          cyRev:    Number(mt[m]?.cyRev    || 0),
          lyQty:    Number(mt[m]?.lyQty    || 0),
          lyRev:    Number(mt[m]?.lyRev    || 0),
          lyAchRev: Number(mt[m]?.lyAchRev || 0),
          cyAchRev: Number(mt[m]?.cyAchRev || 0),
          aopQty:   Number(mt[m]?.aopQty   || 0),
        };
      }
      return {
        id:              r.id,
        employee_code:   abmInfo.abmCode || r.set_by_code || '',
        employeeCode:    abmInfo.abmCode || r.set_by_code || '',
        employeeName:    abmInfo.abmName || '',
        abmCode:         abmInfo.abmCode || '',
        abmName:         abmInfo.abmName || '',
        productCode:     r.product_code,
        productName:     r.product_name || r.product_subgroup || r.product_code,
        name:            r.product_name || r.product_subgroup || r.product_code,
        productCategory: r.product_category || '',
        // Use product_category from product_master as fallback when category_id is null
        categoryId:      r.category_id || r.product_category || '',
        productGroup:    r.product_group  || '',
        productFamily:   r.product_family || '',
        productSubgroup: r.product_subgroup || '',
        unitCost:        parseFloat(r.unit_cost || 0),
        status:          r.status || 'draft',
        monthlyTargets,
        fiscalYearCode:  fy,
        areaCode:        r.area_code,
        areaName:        r.area_name || abmInfo.abmArea || '',
      };
    });
  },

  // PUT /zbm/approve-abm/:id
  // Approves a row in ts_geography_targets (area-level ABM submission).
  async approveAbm(commitmentId, zbmUser, { comments = '', corrections = null } = {}) {
    const row = await db('ts_geography_targets').where({ id: commitmentId }).first();
    if (!row) throw Object.assign(new Error('Submission not found.'), { status: 404 });
    if (row.status === 'approved')
      throw Object.assign(new Error('Already approved.'), { status: 400 });
    const now = new Date();
    let action = 'approved';
    if (corrections && Object.keys(corrections).length > 0) {
      const updated = { ...(row.monthly_targets || {}) };
      for (const [month, values] of Object.entries(corrections)) {
        if (updated[month]) updated[month] = { ...updated[month], ...values };
      }
      await db('ts_geography_targets')
        .where({ id: commitmentId })
        .update({ monthly_targets: JSON.stringify(updated), updated_at: now });
      action = 'corrected_and_approved';
    }
    await db('ts_geography_targets').where({ id: commitmentId }).update({
      status: 'approved', updated_at: now,
    });
    return { success: true, submissionId: commitmentId, action };
  },

  // PUT /zbm/reject-abm/:id
  // Rejects (reverts to draft) a row in ts_geography_targets.
  async rejectAbm(commitmentId, zbmUser, reason = '') {
    const row = await db('ts_geography_targets').where({ id: commitmentId }).first();
    if (!row) throw Object.assign(new Error('Submission not found.'), { status: 404 });
    if (['draft', 'approved'].includes(row.status))
      throw Object.assign(
        new Error(`Cannot reject. Current status: '${row.status}'.`),
        { status: 400 }
      );
    await db('ts_geography_targets').where({ id: commitmentId }).update({
      status: 'draft', updated_at: new Date(),
    });
    return { success: true, submissionId: commitmentId, action: 'rejected' };
  },

  // POST /zbm/bulk-approve-abm
  // Bulk-approves rows in ts_geography_targets belonging to this ZBM's ABMs.
  async bulkApproveAbm(submissionIds, zbmUser, comments = '') {
    const directAbms = await getAbmSubordinates(zbmUser.employeeCode);
    const areaCodes = directAbms.map((a) => String(a.area_code)).filter(Boolean);

    const rows = await db('ts_geography_targets')
      .whereIn('id', submissionIds)
      .whereIn('status', ['draft', 'submitted', 'published'])
      .where({ geo_level: 'area' })
      .whereIn('area_code', areaCodes);

    if (rows.length === 0)
      throw Object.assign(new Error('No eligible submissions.'), { status: 400 });

    const ids = rows.map((r) => r.id);
    const now = new Date();
    await db('ts_geography_targets').whereIn('id', ids).update({
      status: 'approved', updated_at: now,
    });
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
        // Pre-compute total LY across all categories (used when CY row has no category_name).
        // This is the case after ZBM saves/publishes a consolidated target — the saved row has
        // category_name = null, so the per-category lookup abmLy['Other'] returns empty → 0.
        const lyTotalTarget   = Object.values(abmLy).reduce((s, v) => s + (v.lyTarget   || 0), 0);
        const lyTotalAchieved = Object.values(abmLy).reduce((s, v) => s + (v.lyAchieved || 0), 0);

        targets = cyRows.map((a) => {
          const cat = a.category_name || 'Other';
          const ly  = abmLy[cat] || {};

          // When categoryName is null (consolidated row), use the summed LY total.
          // When categoryName is a real category, use the per-category lookup as before.
          const lyTarget   = !a.category_name && lyTotalTarget   ? lyTotalTarget
                           : (ly.lyTarget   || parseFloat(a.ly_target_value   || 0));
          const lyAchieved = !a.category_name && lyTotalAchieved ? lyTotalAchieved
                           : (ly.lyAchieved || parseFloat(a.ly_achieved_value || 0));

          return {
            id:           a.id,
            categoryName: a.category_name,
            yearlyTarget: parseFloat(a.cy_target_value || 0),
            lyTarget,
            lyAchieved,
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
  // Counts from ts_geography_targets (area level) — reflects ABM area target submissions.
  async getDashboardStats(zbmEmployeeCode) {
    const directAbms = await getAbmSubordinates(zbmEmployeeCode);
    const areaCodes = directAbms.map((a) => String(a.area_code)).filter(Boolean);

    const geoRows = areaCodes.length > 0
      ? await db('ts_geography_targets')
          .where({ geo_level: 'area', fiscal_year_code: 'FY26_27' })
          .whereIn('area_code', areaCodes)
      : [];

    return {
      totalAbms:        directAbms.length,
      totalCommitments: geoRows.length,
      pending:          geoRows.filter((r) => r.status === 'submitted').length,
      approved:         geoRows.filter((r) => ['approved', 'published'].includes(r.status)).length,
      draft:            geoRows.filter((r) => r.status === 'draft').length,
      revGrowth:        0,
      qtyGrowth:        0,
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

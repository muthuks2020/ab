'use strict';
/**
 * summaryZBM.service.js
 * GET  /summary/zbm                   → getSummaryData
 * POST /summary/zbm/save-yearly       → saveYearly
 * GET  /summary/zbm/product-visibility → getProductVisibility
 *
 * ZBM sees their zone: ABMs at the top level, drilling into TBMs → Reps.
 * Specialists (AT IOL, Equipment) are leaf nodes under their ABM.
 *
 * Monthly revenue per level (same sources as summaryHead.service.js):
 *   ABM        → ts_geography_targets (geo_level='area',      area_code)      cyRev
 *   TBM        → ts_geography_targets (geo_level='territory', territory_code) cyRev
 *   Rep / Spec → ts_product_commitments (employee_code)                        cyRev
 *
 * CY = FY26_27, LY = FY25_26 — hardcoded, never dynamic.
 */

const { db, getKnex } = require('../config/database');

/* ── Constants ────────────────────────────────────────────────────────────── */
const FY    = 'FY26_27';
const LY_FY = 'FY25_26';

const FISCAL_MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

/* ── Specialist role detection ───────────────────────────────────────────── */
// Specialists report directly to ABM as leaf nodes.
const SPECIALIST_FRAGMENTS = ['specialist', 'at_iol', 'eq_spec', 'at iol', 'equipment specialist'];
const isSpecialistRole = (role = '') =>
  SPECIALIST_FRAGMENTS.some(f => role.toLowerCase().includes(f));

/* ── FY normalizer: '2026-27' → 'FY26_27' ────────────────────────────────── */
const normalizeFY = (raw) => {
  if (!raw) return FY;
  const s = String(raw).trim();
  if (/^FY\d{2}_\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return `FY${m[1].slice(-2)}_${m[2]}`;
  return s;
};

/* ── Fetch direct reports from ts_auth_users ─────────────────────────────── */
const getDirectReports = async (empCode) => {
  const res = await getKnex().raw(
    `SELECT employee_code, full_name, designation,
            zone_name, zone_code, area_name, area_code,
            territory_name, territory_code, role
     FROM aop.ts_auth_users
     WHERE reports_to = ? AND is_active = true
     ORDER BY full_name`,
    [empCode]
  );
  return res.rows;
};

/* ── ABM area revenue from ts_geography_targets ──────────────────────────── */
// Mirrors getAbmAreaRevMonths in summaryHead.service.js
const getAbmAreaRevMonths = async (areaCode) => {
  const zero = FISCAL_MONTHS.reduce((a, m) => { a[m] = 0; return a; }, {});
  if (!areaCode) return { aopEntered: 0, monthTotals: { ...zero } };

  const rows = await getKnex()
    .from('aop.ts_geography_targets')
    .where({ geo_level: 'area', fiscal_year_code: FY, area_code: String(areaCode) })
    .select('monthly_targets', 'target_revenue');

  const monthTotals = { ...zero };
  let aopEntered = 0;
  rows.forEach(r => {
    const mt = r.monthly_targets || {};
    FISCAL_MONTHS.forEach(m => { monthTotals[m] += Number(mt[m]?.cyRev || 0); });
    aopEntered += parseFloat(r.target_revenue || 0);
  });
  return { aopEntered, monthTotals };
};

/* ── TBM territory revenue from ts_geography_targets ────────────────────── */
// Mirrors getTbmTerritoryRevMonths in summaryHead.service.js
const getTbmTerritoryRevMonths = async (territoryCode) => {
  const zero = FISCAL_MONTHS.reduce((a, m) => { a[m] = 0; return a; }, {});
  if (!territoryCode) return { aopEntered: 0, monthTotals: { ...zero } };

  const rows = await getKnex()
    .from('aop.ts_geography_targets')
    .where({ geo_level: 'territory', fiscal_year_code: FY, territory_code: String(territoryCode) })
    .select('monthly_targets', 'target_revenue');

  const monthTotals = { ...zero };
  let aopEntered = 0;
  rows.forEach(r => {
    const mt = r.monthly_targets || {};
    FISCAL_MONTHS.forEach(m => { monthTotals[m] += Number(mt[m]?.cyRev || 0); });
    aopEntered += parseFloat(r.target_revenue || 0);
  });
  return { aopEntered, monthTotals };
};

/* ── Sales Rep / Specialist product commitments revenue ──────────────────── */
// Mirrors getOwnProducts in summaryHead.service.js (cyRev accumulation)
const getRepRevMonths = async (empCode) => {
  const zero = FISCAL_MONTHS.reduce((a, m) => { a[m] = 0; return a; }, {});

  const res = await getKnex().raw(`
    SELECT DISTINCT ON (pc.product_code)
      pc.product_code,
      pc.monthly_targets,
      pc.target_revenue,
      pc.status,
      COALESCE(
        NULLIF(TRIM(pm.product_name),     ''),
        NULLIF(TRIM(pm.product_subgroup), ''),
        NULLIF(TRIM(pm.product_family),   ''),
        NULLIF(TRIM(pm.product_group),    ''),
        pc.product_code
      ) AS product_name
    FROM aop.ts_product_commitments pc
    LEFT JOIN (
      SELECT DISTINCT ON (productcode)
        productcode, product_name, product_subgroup, product_family, product_group
      FROM aop.product_master
      ORDER BY productcode
    ) pm ON pm.productcode = pc.product_code
    WHERE pc.employee_code    = ?
      AND pc.fiscal_year_code = ?
    ORDER BY pc.product_code, pc.updated_at DESC
  `, [empCode, FY]);

  const monthTotals = { ...zero };
  let aopEntered = 0;

  const products = res.rows.map(r => {
    const mt  = r.monthly_targets || {};
    const flat = {
      productName : r.product_name || r.product_code,
      productCode : r.product_code,
      status      : r.status,
    };
    FISCAL_MONTHS.forEach(m => {
      flat[m] = Number(mt[m]?.cyQty || 0);          // keep cyQty for sub-table display
      monthTotals[m] += Number(mt[m]?.cyRev || 0);  // accumulate revenue for monthly columns
    });
    aopEntered += parseFloat(r.target_revenue || 0);
    return flat;
  });

  return { products, aopEntered, monthTotals };
};

/* ═══════════════════════════════════════════════════════════════════════════ */

const SummaryZBMService = {

  /* ─────────────────────────────────────────────────────────────────────────
   * getSummaryData
   *
   * ZBM's direct reports = ABMs (top level) + any Specialists reporting to ZBM.
   * ABM node carries:
   *   ownMonths  : monthly revenue from ts_geography_targets (area-level)
   *   aopEntered : sum of target_revenue from ts_geography_targets
   *   tbms[]     : TBMs under this ABM
   *   specialists[]: Specialists (leaf nodes) under this ABM
   * ─────────────────────────────────────────────────────────────────────────*/
  async getSummaryData(zbmCode) {

    const allDirects = await getDirectReports(zbmCode);
    // ABMs = non-specialists; any specialist directly under ZBM is treated same as rep
    const abmRows = allDirects.filter(r => !isSpecialistRole(r.role));

    const abms = await Promise.all(abmRows.map(async (abm) => {

      /* ABM CY target — set by ZBM in ts_yearly_target_assignments */
      const cyAssign = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: FY, manager_code: zbmCode, assignee_code: abm.employee_code })
        .first();
      const cyTarget = parseFloat(cyAssign?.cy_target_value || 0);

      /* LY Target — 3-step fallback (mirrors summaryHead.service.js) */
      let lyTarget = parseFloat(cyAssign?.ly_target_value   || 0);
      let lyAhv    = parseFloat(cyAssign?.ly_achieved_value || 0);

      if (!lyTarget || !lyAhv) {
        const lyRow = await db('ts_yearly_target_assignments')
          .where({ fiscal_year_code: LY_FY, assignee_code: abm.employee_code })
          .sum({ totalTgt: 'cy_target_value', totalAhv: 'ly_achieved_value' })
          .first();
        if (!lyTarget) lyTarget = parseFloat(lyRow?.totalTgt || 0);
        if (!lyAhv)   lyAhv    = parseFloat(lyRow?.totalAhv || 0);
      }

      if (!lyTarget && abm.area_code) {
        const lyGeo = await getKnex()
          .from('aop.ts_geography_targets')
          .where({ geo_level: 'area', fiscal_year_code: LY_FY, area_code: String(abm.area_code) })
          .sum({ total: 'target_revenue' })
          .first();
        lyTarget = parseFloat(lyGeo?.total || 0);
      }

      /* ABM own monthly revenue (area targets) */
      const { aopEntered: abmAop, monthTotals: abmMonths } =
        await getAbmAreaRevMonths(abm.area_code);

      /* ABM direct reports: split into TBMs and Specialists */
      const abmDirects = await getDirectReports(abm.employee_code);
      const tbmRows    = abmDirects.filter(r => !isSpecialistRole(r.role));
      const specRows   = abmDirects.filter(r => isSpecialistRole(r.role));

      /* TBMs */
      const tbms = await Promise.all(tbmRows.map(async (tbm) => {
        const { aopEntered: tbmAop, monthTotals: tbmMonths } =
          await getTbmTerritoryRevMonths(tbm.territory_code);

        const repRows  = await getDirectReports(tbm.employee_code);
        const salesReps = await Promise.all(repRows.map(async (rep) => {
          const { products, aopEntered, monthTotals } = await getRepRevMonths(rep.employee_code);
          return {
            employeeCode : rep.employee_code,
            fullName     : rep.full_name,
            designation  : rep.designation || 'Sales Rep',
            territory    : rep.territory_name || rep.area_name || '—',
            role         : rep.role,
            aopEntered,
            ownMonths    : monthTotals,
            ownProducts  : products,
          };
        }));

        return {
          employeeCode : tbm.employee_code,
          fullName     : tbm.full_name,
          designation  : tbm.designation || 'TBM',
          territory    : tbm.territory_name || tbm.area_name || '—',
          role         : tbm.role,
          aopEntered   : tbmAop,
          ownMonths    : tbmMonths,
          salesReps,
        };
      }));

      /* Specialists under this ABM */
      const specialists = await Promise.all(specRows.map(async (spec) => {
        const { products, aopEntered, monthTotals } = await getRepRevMonths(spec.employee_code);
        return {
          employeeCode : spec.employee_code,
          fullName     : spec.full_name,
          designation  : spec.designation || spec.role,
          territory    : spec.area_name || spec.zone_name || '—',
          role         : spec.role,
          aopEntered,
          ownMonths    : monthTotals,
          ownProducts  : products,
        };
      }));

      return {
        employeeCode : abm.employee_code,
        fullName     : abm.full_name,
        designation  : abm.designation || 'ABM',
        territory    : abm.area_name || abm.zone_name || '—',
        role         : abm.role,
        lyTarget,
        lyAhv,
        cyTarget,
        aopEntered   : abmAop,
        ownMonths    : abmMonths,
        tbms,
        specialists,
      };
    }));

    /* ── Bulk-attach LY Target + LY Ahv + CY Target to TBM / Rep / Spec nodes ── */
    const allSubCodes = [];
    abms.forEach(a => {
      (a.tbms || []).forEach(t => {
        allSubCodes.push(t.employeeCode);
        (t.salesReps || []).forEach(r => allSubCodes.push(r.employeeCode));
      });
      (a.specialists || []).forEach(s => allSubCodes.push(s.employeeCode));
    });

    if (allSubCodes.length > 0) {
      const cyAssignRows = await db('ts_yearly_target_assignments')
        .whereIn('assignee_code', allSubCodes)
        .where('fiscal_year_code', FY)
        .select('assignee_code', 'cy_target_value');
      const cyTargetMap = {};
      cyAssignRows.forEach(r => { cyTargetMap[r.assignee_code] = parseFloat(r.cy_target_value || 0); });

      const lyAssignRows = await db('ts_yearly_target_assignments')
        .whereIn('assignee_code', allSubCodes)
        .where('fiscal_year_code', LY_FY)
        .select('assignee_code', 'ly_target_value', 'ly_achieved_value');
      const lyAsgTotals = {};
      lyAssignRows.forEach(r => {
        if (!lyAsgTotals[r.assignee_code]) lyAsgTotals[r.assignee_code] = { lyTarget: 0, lyAhv: 0 };
        lyAsgTotals[r.assignee_code].lyTarget += parseFloat(r.ly_target_value  || 0);
        lyAsgTotals[r.assignee_code].lyAhv   += parseFloat(r.ly_achieved_value || 0);
      });

      const lyCommitRaw = await getKnex().raw(`
        SELECT DISTINCT ON (employee_code, product_code)
          employee_code, monthly_targets
        FROM aop.ts_product_commitments
        WHERE employee_code = ANY(?) AND fiscal_year_code = ?
        ORDER BY employee_code, product_code, updated_at DESC
      `, [allSubCodes, LY_FY]);
      const lyCommitTotals = {};
      lyCommitRaw.rows.forEach(r => {
        const mt = r.monthly_targets || {};
        FISCAL_MONTHS.forEach(m => {
          const obj = mt[m] || {};
          lyCommitTotals[r.employee_code] = (lyCommitTotals[r.employee_code] || 0) + (Number(obj.cyRev) || 0);
        });
      });

      const attachLY = (node) => {
        const code   = node.employeeCode;
        const lyTgt  = lyAsgTotals[code]?.lyTarget || 0;
        node.lyTarget = lyTgt || lyCommitTotals[code] || 0;
        node.lyAhv    = lyAsgTotals[code]?.lyAhv    || 0;
        node.cyTarget = cyTargetMap[code]            || 0;
      };

      abms.forEach(a => {
        (a.tbms || []).forEach(t => {
          attachLY(t);
          (t.salesReps || []).forEach(r => attachLY(r));
        });
        (a.specialists || []).forEach(s => attachLY(s));
      });
    }

    return abms;
  },

  /* ─────────────────────────────────────────────────────────────────────────
   * saveYearly  — ZBM sets yearly ₹ targets for each ABM
   * ─────────────────────────────────────────────────────────────────────────*/
  async saveYearly(zbmCode, fiscalYear, targets) {
    const fy  = normalizeFY(fiscalYear);
    const now = new Date();
    console.log('[SummaryZBM] saveYearly — fy:', fy, 'count:', targets.length);

    for (const t of targets) {
      const existing = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, manager_code: zbmCode, assignee_code: t.employeeCode })
        .first();

      if (existing) {
        await db('ts_yearly_target_assignments')
          .where({ id: existing.id })
          .update({ cy_target_value: Number(t.yearlyTarget) || 0, manager_code: zbmCode, updated_at: now });
      } else {
        const assignee = await db('ts_auth_users').where({ employee_code: t.employeeCode }).first();
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code  : fy,
          manager_code      : zbmCode,
          manager_role      : 'zbm',
          assignee_code     : t.employeeCode,
          assignee_role     : assignee?.role || 'abm',
          geo_level         : 'area',
          zone_code         : assignee?.zone_code  || null,
          zone_name         : assignee?.zone_name  || null,
          area_code         : assignee?.area_code  || null,
          area_name         : assignee?.area_name  || null,
          cy_target_value   : Number(t.yearlyTarget) || 0,
          cy_target_qty     : 0,
          ly_target_value   : 0,
          ly_achieved_value : 0,
          status            : 'draft',
          created_at        : now,
          updated_at        : now,
        });
      }
    }
    return { success: true, savedCount: targets.length };
  },

  /* ─────────────────────────────────────────────────────────────────────────
   * getProductVisibility
   *
   * level=abm   → ts_geography_targets (geo_level='area')  cyRev per month
   * level=tbm   → ts_geography_targets (geo_level='territory') cyRev per month
   * level=rep   → ts_product_commitments (rep employee codes) cyRev per month
   * level=spec  → ts_product_commitments (specialist codes) cyRev per month
   * ─────────────────────────────────────────────────────────────────────────*/
  async getProductVisibility(zbmCode, level) {

    /* Collect hierarchy codes for this ZBM */
    const allDirects = await getDirectReports(zbmCode);
    const abmRows    = allDirects.filter(r => !isSpecialistRole(r.role));

    const areaCodes      = [];
    const territoryCodes = [];
    const repCodes       = [];
    const specCodes      = [];
    const tbmMeta        = {};  // territoryCode → { name, territory }
    const abmMeta        = {};  // areaCode      → { name, territory }
    const repMeta        = {};  // empCode       → { name, territory }

    for (const abm of abmRows) {
      if (abm.area_code) {
        areaCodes.push(String(abm.area_code));
        abmMeta[String(abm.area_code)] = { name: abm.full_name, territory: abm.area_name || '—', id: abm.employee_code };
      }
      const abmDirects = await getDirectReports(abm.employee_code);
      for (const d of abmDirects) {
        if (isSpecialistRole(d.role)) {
          specCodes.push(d.employee_code);
          repMeta[d.employee_code] = { name: d.full_name, territory: d.area_name || abm.area_name || '—' };
        } else {
          if (d.territory_code) {
            territoryCodes.push(String(d.territory_code));
            tbmMeta[String(d.territory_code)] = { name: d.full_name, territory: d.territory_name || '—', id: d.employee_code };
          }
          const reps = await getDirectReports(d.employee_code);
          reps.forEach(r => {
            repCodes.push(r.employee_code);
            repMeta[r.employee_code] = { name: r.full_name, territory: r.territory_name || d.territory_name || '—' };
          });
        }
      }
    }

    /* Product name lookup helper */
    const getProductName = async (productCode) => {
      const pm = await getKnex()
        .from('aop.product_master')
        .where('productcode', productCode)
        .select('product_name', 'product_subgroup', 'product_family', 'product_group')
        .first();
      return pm
        ? (pm.product_name?.trim() || pm.product_subgroup?.trim() || pm.product_family?.trim() || pm.product_group?.trim() || productCode)
        : productCode;
    };

    /* ── ABM level: ts_geography_targets area ── */
    if (level === 'abm') {
      if (areaCodes.length === 0) return [];
      const cyRows = await getKnex()
        .from('aop.ts_geography_targets')
        .where({ geo_level: 'area', fiscal_year_code: FY })
        .whereIn('area_code', areaCodes)
        .select('area_code', 'product_code', 'monthly_targets', 'target_revenue');

      const lyRows = await getKnex()
        .from('aop.ts_geography_targets')
        .where({ geo_level: 'area', fiscal_year_code: LY_FY })
        .whereIn('area_code', areaCodes)
        .select('area_code', 'product_code', 'monthly_targets');

      const lyMap = {};
      lyRows.forEach(r => {
        const key = `${r.area_code}:${r.product_code}`;
        const mt  = r.monthly_targets || {};
        lyMap[key] = FISCAL_MONTHS.reduce((a, m) => { a[m] = Number(mt[m]?.cyRev || 0); return a; }, {});
      });

      const grouped = {};
      cyRows.forEach(r => {
        const ac  = String(r.area_code);
        const mt  = r.monthly_targets || {};
        if (!grouped[ac]) grouped[ac] = [];
        const cyMonths = FISCAL_MONTHS.reduce((a, m) => { a[m] = Number(mt[m]?.cyRev || 0); return a; }, {});
        const lyMonths = lyMap[`${ac}:${r.product_code}`] || FISCAL_MONTHS.reduce((a,m) => { a[m]=0; return a; }, {});
        grouped[ac].push({
          productCode : r.product_code,
          productName : r.product_code,  // resolved below
          cyMonths,
          lyMonths,
          cyTotal : FISCAL_MONTHS.reduce((s, m) => s + (cyMonths[m] || 0), 0),
          lyTotal : FISCAL_MONTHS.reduce((s, m) => s + (lyMonths[m] || 0), 0),
        });
      });

      // Resolve product names and filter zero-revenue rows
      const result = [];
      for (const [ac, prods] of Object.entries(grouped)) {
        const meta = abmMeta[ac];
        if (!meta) continue;
        const resolvedProds = [];
        for (const p of prods) {
          if (p.cyTotal === 0 && p.lyTotal === 0) continue;
          p.productName = await getProductName(p.productCode);
          resolvedProds.push(p);
        }
        if (resolvedProds.length > 0) {
          result.push({ id: meta.id, name: meta.name, territory: meta.territory, products: resolvedProds });
        }
      }
      return result;
    }

    /* ── TBM level: ts_geography_targets territory ── */
    if (level === 'tbm') {
      if (territoryCodes.length === 0) return [];
      const cyRows = await getKnex()
        .from('aop.ts_geography_targets')
        .where({ geo_level: 'territory', fiscal_year_code: FY })
        .whereIn('territory_code', territoryCodes)
        .select('territory_code', 'product_code', 'monthly_targets');

      const lyRows = await getKnex()
        .from('aop.ts_geography_targets')
        .where({ geo_level: 'territory', fiscal_year_code: LY_FY })
        .whereIn('territory_code', territoryCodes)
        .select('territory_code', 'product_code', 'monthly_targets');

      const lyMap = {};
      lyRows.forEach(r => {
        const key = `${r.territory_code}:${r.product_code}`;
        const mt  = r.monthly_targets || {};
        lyMap[key] = FISCAL_MONTHS.reduce((a, m) => { a[m] = Number(mt[m]?.cyRev || 0); return a; }, {});
      });

      const grouped = {};
      cyRows.forEach(r => {
        const tc  = String(r.territory_code);
        const mt  = r.monthly_targets || {};
        if (!grouped[tc]) grouped[tc] = [];
        const cyMonths = FISCAL_MONTHS.reduce((a, m) => { a[m] = Number(mt[m]?.cyRev || 0); return a; }, {});
        const lyMonths = lyMap[`${tc}:${r.product_code}`] || FISCAL_MONTHS.reduce((a,m) => { a[m]=0; return a; }, {});
        grouped[tc].push({
          productCode : r.product_code,
          productName : r.product_code,
          cyMonths,
          lyMonths,
          cyTotal : FISCAL_MONTHS.reduce((s, m) => s + (cyMonths[m] || 0), 0),
          lyTotal : FISCAL_MONTHS.reduce((s, m) => s + (lyMonths[m] || 0), 0),
        });
      });

      const result = [];
      for (const [tc, prods] of Object.entries(grouped)) {
        const meta = tbmMeta[tc];
        if (!meta) continue;
        const resolvedProds = [];
        for (const p of prods) {
          if (p.cyTotal === 0 && p.lyTotal === 0) continue;
          p.productName = await getProductName(p.productCode);
          resolvedProds.push(p);
        }
        if (resolvedProds.length > 0) {
          result.push({ id: meta.id, name: meta.name, territory: meta.territory, products: resolvedProds });
        }
      }
      return result;
    }

    /* ── Rep / Specialist level: ts_product_commitments ── */
    const empCodes = level === 'spec' ? specCodes : repCodes;
    if (empCodes.length === 0) return [];

    const cySql = `
      SELECT DISTINCT ON (pc.employee_code, pc.product_code)
        pc.employee_code,
        pc.product_code,
        pc.monthly_targets,
        COALESCE(
          NULLIF(TRIM(pm.product_name),''),
          NULLIF(TRIM(pm.product_subgroup),''),
          NULLIF(TRIM(pm.product_family),''),
          NULLIF(TRIM(pm.product_group),''),
          pc.product_code
        ) AS product_display_name
      FROM aop.ts_product_commitments pc
      LEFT JOIN (
        SELECT DISTINCT ON (productcode) productcode, product_name, product_subgroup, product_family, product_group
        FROM aop.product_master ORDER BY productcode
      ) pm ON pm.productcode = pc.product_code
      WHERE pc.employee_code = ANY(?) AND pc.fiscal_year_code = ?
      ORDER BY pc.employee_code, pc.product_code, pc.updated_at DESC
    `;
    const cyRes = await getKnex().raw(cySql, [empCodes, FY]);

    const lySql = `
      SELECT DISTINCT ON (pc.employee_code, pc.product_code)
        pc.employee_code, pc.product_code, pc.monthly_targets
      FROM aop.ts_product_commitments pc
      WHERE pc.employee_code = ANY(?) AND pc.fiscal_year_code = ?
      ORDER BY pc.employee_code, pc.product_code, pc.updated_at DESC
    `;
    const lyRes = await getKnex().raw(lySql, [empCodes, LY_FY]);

    const lyLookup = {};
    lyRes.rows.forEach(r => {
      const key = `${r.employee_code}:${r.product_code}`;
      const mt  = r.monthly_targets || {};
      lyLookup[key] = FISCAL_MONTHS.reduce((a, m) => {
        const md = mt[m];
        a[m] = Number((md && typeof md === 'object') ? (md.cyRev || md.lyRev || 0) : (md || 0));
        return a;
      }, {});
    });

    const empMap = {};
    cyRes.rows.forEach(r => {
      const emp = r.employee_code;
      if (!empMap[emp]) empMap[emp] = [];
      const mt       = r.monthly_targets || {};
      const cyMonths = FISCAL_MONTHS.reduce((a, m) => { a[m] = Number(mt[m]?.cyRev || 0); return a; }, {});
      const lyMonths = lyLookup[`${emp}:${r.product_code}`] || FISCAL_MONTHS.reduce((a,m) => { a[m]=0; return a; }, {});
      const cyTotal  = FISCAL_MONTHS.reduce((s, m) => s + (cyMonths[m] || 0), 0);
      const lyTotal  = FISCAL_MONTHS.reduce((s, m) => s + (lyMonths[m] || 0), 0);
      if (cyTotal === 0 && lyTotal === 0) return;
      empMap[emp].push({ productCode: r.product_code, productName: r.product_display_name || r.product_code, cyMonths, lyMonths, cyTotal, lyTotal });
    });

    return Object.entries(empMap)
      .filter(([, prods]) => prods.length > 0)
      .map(([empCode, products]) => {
        const meta = repMeta[empCode] || { name: empCode, territory: '—' };
        return { id: empCode, name: meta.name, territory: meta.territory, products };
      });
  },
  /* ─────────────────────────────────────────────────────────────────────────
   * saveProducts  — update cyQty in ts_product_commitments for Rep-level rows.
   * Mirrors summaryHead.service.js saveProducts exactly.
   * assigneeCode = Sales Rep / Specialist who owns the row.
   * ─────────────────────────────────────────────────────────────────────────*/
  async saveProducts(fiscalYear, rows) {
    const fy  = normalizeFY(fiscalYear);
    const now = new Date();
    console.log('[SummaryZBM] saveProducts — fy:', fy, 'count:', rows.length);

    for (const r of rows) {
      const existing = await db('ts_product_commitments')
        .where({ fiscal_year_code: fy, employee_code: r.assigneeCode, product_code: r.productCode })
        .orderBy('updated_at', 'desc')
        .first();

      if (existing) {
        const existingMt = existing.monthly_targets || {};
        const merged = {};
        FISCAL_MONTHS.forEach(m => {
          const oldEntry = existingMt[m] || {};
          merged[m] = {
            ...oldEntry,
            cyQty: r.monthlyTargets.hasOwnProperty(m)
              ? (Number(r.monthlyTargets[m]) || 0)
              : Number(oldEntry.cyQty || 0),
          };
        });
        const targetQty = FISCAL_MONTHS.reduce((s, m) => s + Number(merged[m]?.cyQty || 0), 0);
        const targetRev = FISCAL_MONTHS.reduce((s, m) => s + Number(merged[m]?.cyRev || 0), 0);

        await db('ts_product_commitments')
          .where({ id: existing.id })
          .update({ monthly_targets: JSON.stringify(merged), target_quantity: targetQty, target_revenue: targetRev, updated_at: now });
      } else {
        const newMt = {};
        FISCAL_MONTHS.forEach(m => {
          newMt[m] = { cyQty: Number(r.monthlyTargets[m] || 0), cyRev: 0, lyQty: 0, lyRev: 0, lyAchRev: 0, aopQty: 0 };
        });
        const totalQty = FISCAL_MONTHS.reduce((s, m) => s + Number(r.monthlyTargets[m] || 0), 0);
        const assignee = await db('ts_auth_users').where({ employee_code: r.assigneeCode }).first();

        await db('ts_product_commitments').insert({
          fiscal_year_code : fy,
          employee_code    : r.assigneeCode,
          employee_role    : assignee?.role || 'sales_rep',
          product_code     : r.productCode,
          category_id      : null,
          zone_code        : assignee?.zone_code      || null,
          area_code        : assignee?.area_code      || null,
          territory_code   : assignee?.territory_code || null,
          monthly_targets  : JSON.stringify(newMt),
          target_quantity  : totalQty,
          target_revenue   : 0,
          status           : 'draft',
          created_at       : now,
          updated_at       : now,
        });
      }
    }
    return { success: true, savedCount: rows.length };
  },
};

module.exports = SummaryZBMService;

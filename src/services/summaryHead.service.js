'use strict';
/**
 * summaryHead.service.js
 * Stage 2 : getSummaryData  (GET /summary/head)
 * Stage 3 : saveYearly      (POST /summary/head/save-yearly)
 *           saveProducts    (POST /summary/head/save-products)
 *
 * KEY DESIGN:
 *   Every node in the hierarchy (ZBM / ABM / TBM / Sales Rep) shows their OWN
 *   ts_product_commitments rows for FY26_27 — exactly what they typed into their
 *   own screen.  The Sales Head drills down level by level to inspect each person's
 *   actual entries.
 *
 *   Monthly values in each row = sum of that person's own product cyQty entries.
 *   The "AOP Entered" value = that person's own sum of target_revenue.
 *   ZBM-level totals = sum of all ABMs below them (since ZBMs typically don't
 *   enter product commitments directly).
 *
 * Hierarchy fetched:
 *   Sales Head direct reports → ZBMs
 *     ZBM direct reports      → ABMs  (each ABM has own products fetched)
 *       ABM direct reports    → TBMs  (each TBM has own products fetched)
 *         TBM direct reports  → Sales Reps (each Rep has own products fetched)
 *
 * CY = FY26_27, LY = FY25_26 — hardcoded, never dynamic.
 */

const { db, getKnex } = require('../config/database');

/* ── Constants ────────────────────────────────────────────────────────────── */
const FY    = 'FY26_27';
const LY_FY = 'FY25_26';

const FISCAL_MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

/* ── FY normalizer: '2026-27' → 'FY26_27' ────────────────────────────────── */
const normalizeFY = (raw) => {
  if (!raw) return FY;
  const s = String(raw).trim();
  if (/^FY\d{2}_\d{2}$/.test(s)) return s;
  const m1 = s.match(/^(\d{4})-(\d{2})$/);
  if (m1) return `FY${m1[1].slice(-2)}_${m1[2]}`;
  const m2 = s.match(/^FY(\d{4})-(\d{2})$/);
  if (m2) return `FY${m2[1].slice(-2)}_${m2[2]}`;
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

/* ── Fetch one person's own FY26_27 product commitments ─────────────────── */
// Used for ABM (area-level), TBM (territory-level), Sales Rep (rep-level).
// Returns { products: [...], aopEntered: number, monthTotals: {apr..mar} }
const getOwnProducts = async (empCode) => {
  const sql = `
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
  `;
  const res = await getKnex().raw(sql, [empCode, FY]);

  let aopEntered = 0;
  const monthTotals = FISCAL_MONTHS.reduce((a, m) => { a[m] = 0; return a; }, {});

  const products = res.rows.map(r => {
    const mt   = r.monthly_targets || {};
    const flat = {
      productName : r.product_name || r.product_code,
      productCode : r.product_code,
      status      : r.status,
    };
    FISCAL_MONTHS.forEach(m => {
      flat[m] = Number(mt[m]?.cyQty || 0);
      monthTotals[m] += Number(mt[m]?.cyQty || 0);
    });
    aopEntered += parseFloat(r.target_revenue || 0);
    return flat;
  });

  return { products, aopEntered, monthTotals };
};

/* ═══════════════════════════════════════════════════════════════════════════ */

const SummaryHeadService = {

  /* ─────────────────────────────────────────────────────────────────────────
   * getSummaryData
   *
   * Each node carries:
   *   ownProducts   : what THEY entered (flat product rows with monthly cyQty)
   *   ownMonths     : monthly sums of their own products  { apr..mar }
   *   aopEntered    : sum of their own target_revenue
   *   ── children ──
   *   abms / tbms / salesReps
   * ─────────────────────────────────────────────────────────────────────────*/
  async getSummaryData(managerCode) {

    const zbmRows = await getDirectReports(managerCode);

    const zbms = await Promise.all(zbmRows.map(async (zbm) => {

      /* ZBM yearly-target assignment */
      const cyAssign = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: FY, manager_code: managerCode, assignee_code: zbm.employee_code })
        .first();
      const cyTarget = parseFloat(cyAssign?.cy_target_value || 0);

      /* LY Target — 3-step fallback chain */
      let lyTarget = parseFloat(cyAssign?.ly_target_value || 0);

      if (!lyTarget) {
        const lyRow = await db('ts_yearly_target_assignments')
          .where({ fiscal_year_code: LY_FY, assignee_code: zbm.employee_code })
          .sum({ total: 'cy_target_value' })
          .first();
        lyTarget = parseFloat(lyRow?.total || 0);
      }

      if (!lyTarget && zbm.zone_code) {
        const lyCommit = await db('ts_product_commitments')
          .where({ fiscal_year_code: LY_FY, zone_code: zbm.zone_code })
          .sum({ total: 'target_revenue' })
          .first();
        lyTarget = parseFloat(lyCommit?.total || 0);
      }

      /* ABMs */
      const abmRows = await getDirectReports(zbm.employee_code);

      const abms = await Promise.all(abmRows.map(async (abm) => {

        /* ABM's own entered products (area targets) */
        const { products: abmProducts, aopEntered: abmAop, monthTotals: abmMonths } =
          await getOwnProducts(abm.employee_code);

        /* TBMs under this ABM */
        const tbmRows = await getDirectReports(abm.employee_code);

        const tbms = await Promise.all(tbmRows.map(async (tbm) => {

          /* TBM's own entered products (territory targets) */
          const { products: tbmProducts, aopEntered: tbmAop, monthTotals: tbmMonths } =
            await getOwnProducts(tbm.employee_code);

          /* Sales Reps under this TBM */
          const repRows = await getDirectReports(tbm.employee_code);

          const salesReps = await Promise.all(repRows.map(async (rep) => {
            const { products, aopEntered, monthTotals } = await getOwnProducts(rep.employee_code);
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
            ownProducts  : tbmProducts,
            salesReps,
          };
        }));

        return {
          employeeCode : abm.employee_code,
          fullName     : abm.full_name,
          designation  : abm.designation || 'ABM',
          territory    : abm.area_name || abm.zone_name || '—',
          role         : abm.role,
          aopEntered   : abmAop,
          ownMonths    : abmMonths,
          ownProducts  : abmProducts,
          tbms,
        };
      }));

      /* ZBM monthly = sum of ABMs' own aopEntered / ownMonths */
      const zbmMonths     = FISCAL_MONTHS.reduce((a, m) => { a[m] = 0; return a; }, {});
      let   zbmAopEntered = 0;
      abms.forEach(abm => {
        FISCAL_MONTHS.forEach(m => { zbmMonths[m] += abm.ownMonths[m] || 0; });
        zbmAopEntered += abm.aopEntered;
      });

      const achievementPct = cyTarget > 0
        ? Math.round((zbmAopEntered / cyTarget) * 1000) / 10
        : 0;

      return {
        employeeCode   : zbm.employee_code,
        fullName       : zbm.full_name,
        designation    : zbm.designation || 'ZBM',
        zone           : zbm.zone_name || '—',
        zoneCode       : zbm.zone_code || '',
        role           : zbm.role,
        lyTarget,
        cyTarget,
        aopEntered     : zbmAopEntered,
        achievementPct,
        ownMonths      : zbmMonths,
        abms,
      };
    }));

    return zbms;
  },

  /* ─────────────────────────────────────────────────────────────────────────
   * saveYearly  (Stage 3)
   * ─────────────────────────────────────────────────────────────────────────*/
  async saveYearly(managerCode, fiscalYear, targets) {
    const fy  = normalizeFY(fiscalYear);
    const now = new Date();
    console.log('[SummaryHead] saveYearly — fy:', fy, 'count:', targets.length);

    for (const t of targets) {
      const existing = await db('ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, assignee_code: t.employeeCode })
        .first();

      if (existing) {
        await db('ts_yearly_target_assignments')
          .where({ id: existing.id })
          .update({ cy_target_value: Number(t.yearlyTarget) || 0, manager_code: managerCode, updated_at: now });
      } else {
        const assignee = await db('ts_auth_users').where({ employee_code: t.employeeCode }).first();
        await db('ts_yearly_target_assignments').insert({
          fiscal_year_code  : fy,
          manager_code      : managerCode,
          manager_role      : 'sales_head',
          assignee_code     : t.employeeCode,
          assignee_role     : assignee?.role || 'zbm',
          geo_level         : 'zone',
          zone_code         : assignee?.zone_code || null,
          zone_name         : assignee?.zone_name || null,
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
   * saveProducts  (Stage 3)
   * Only cyQty updated; existing cyRev / lyRev / lyQty preserved.
   * assigneeCode = the person who owns the row (ABM / TBM / Sales Rep).
   * ─────────────────────────────────────────────────────────────────────────*/
  async saveProducts(fiscalYear, rows) {
    const fy  = normalizeFY(fiscalYear);
    const now = new Date();
    console.log('[SummaryHead] saveProducts — fy:', fy, 'count:', rows.length);

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
          zone_code        : assignee?.zone_code     || null,
          area_code        : assignee?.area_code     || null,
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

module.exports = SummaryHeadService;

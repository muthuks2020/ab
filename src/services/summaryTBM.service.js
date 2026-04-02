'use strict';
/**
 * src/services/summaryTBM.service.js
 * TBM Performance Summary — Sales Reps under the logged-in TBM.
 *
 * LY = FY25_26  (hardcoded — never call getActiveFY())
 * CY = FY26_27  (hardcoded — never call getActiveFY())
 */

const { db, getKnex } = require('../config/database');

const CY_FY  = 'FY26_27';
const LY_FY  = 'FY25_26';
const MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Sum one JSONB field across all 12 months for a single commitment row. */
function rowMonthSum(monthlyTargets, field) {
  return MONTHS.reduce((acc, m) => {
    const cap = m.charAt(0).toUpperCase() + m.slice(1);
    const obj = monthlyTargets?.[m] || monthlyTargets?.[cap] || {};
    return acc + (Number(obj[field]) || 0);
  }, 0);
}

/** Build ownMonths {apr:n, ...} from an array of commitment rows. */
function buildOwnMonths(commitRows, field) {
  const out = {};
  MONTHS.forEach(m => { out[m] = 0; });
  commitRows.forEach(row => {
    const mt = row.monthly_targets || {};
    MONTHS.forEach(m => {
      const cap = m.charAt(0).toUpperCase() + m.slice(1);
      const obj = mt[m] || mt[cap] || {};
      out[m] += Number(obj[field]) || 0;
    });
  });
  return out;
}

/** Build ownProducts [{productCode, apr, ...}] from commitment rows. */
function buildOwnProducts(commitRows, field) {
  return commitRows.map(row => {
    const p  = { productCode: row.product_code };
    const mt = row.monthly_targets || {};
    MONTHS.forEach(m => {
      const cap = m.charAt(0).toUpperCase() + m.slice(1);
      const obj = mt[m] || mt[cap] || {};
      p[m] = Number(obj[field]) || 0;
    });
    return p;
  });
}

/** DISTINCT ON (employee_code, product_code) commitments for a code list + FY. */
async function fetchCommitments(codes, fy) {
  if (!codes.length) return [];
  const raw = await getKnex().raw(`
    SELECT DISTINCT ON (employee_code, product_code)
      employee_code, product_code, monthly_targets
    FROM aop.ts_product_commitments
    WHERE employee_code = ANY(?) AND fiscal_year_code = ?
    ORDER BY employee_code, product_code, updated_at DESC
  `, [codes, fy]);
  return raw.rows;
}

/** Group array into { key: [rows] } map. */
function groupBy(rows, key) {
  return rows.reduce((acc, r) => {
    const k = r[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(r);
    return acc;
  }, {});
}

/* ════════════════════════════════════════════════════════════════════════ */

const SummaryTBMService = {

  /**
   * getSummaryData(tbmEmployeeCode)
   * Returns array of Sales Rep objects:
   *   { employeeCode, fullName, territory,
   *     lyTarget, lyAhv, cyTarget, aopEntered,
   *     ownMonths, ownProducts }
   */
  async getSummaryData(tbmEmployeeCode) {

    /* 1. Direct Sales Reps (WHERE reports_to = tbmEmployeeCode) */
    const repRows = await db('aop.ts_auth_users')
      .where('reports_to', tbmEmployeeCode)
      .select('employee_code', 'full_name', 'area_name', 'area_code');

    if (!repRows.length) return [];
    const repCodes = repRows.map(r => r.employee_code);

    /* 2. LY commitments for Reps (for lyTarget = sum of lyRev) */
    const lyRepCommits = await fetchCommitments(repCodes, LY_FY);
    const lyRepMap     = groupBy(lyRepCommits, 'employee_code');

    /* 3. CY commitments for Reps */
    const cyRepCommits = await fetchCommitments(repCodes, CY_FY);
    const cyMap        = groupBy(cyRepCommits, 'employee_code');

    /* 4. Yearly assignments for Reps */
    const lyAssignments = await db('aop.ts_yearly_target_assignments')
      .whereIn('assignee_code', repCodes)
      .where('fiscal_year_code', LY_FY)
      .select('assignee_code', 'ly_target_value', 'ly_achieved_value');

    const cyAssignments = await db('aop.ts_yearly_target_assignments')
      .whereIn('assignee_code', repCodes)
      .where('fiscal_year_code', CY_FY)
      .select('assignee_code', 'cy_target_value');

    /* Sum ALL rows per assignee (multiple category rows per person) */
    const lyAsgTotals = {};
    lyAssignments.forEach(r => {
      if (!lyAsgTotals[r.assignee_code]) lyAsgTotals[r.assignee_code] = { lyTarget: 0, lyAhv: 0 };
      lyAsgTotals[r.assignee_code].lyTarget += parseFloat(r.ly_target_value  || 0);
      lyAsgTotals[r.assignee_code].lyAhv   += parseFloat(r.ly_achieved_value || 0);
    });
    const cyAsgTotals = {};
    cyAssignments.forEach(r => {
      cyAsgTotals[r.assignee_code] = (cyAsgTotals[r.assignee_code] || 0) + parseFloat(r.cy_target_value || 0);
    });

    /* 5. Build Sales Rep nodes */
    return repRows.map(rep => {
      const repCode    = rep.employee_code;
      const lyRows     = lyRepMap[repCode] || [];
      const cyRows     = cyMap[repCode]    || [];
      // lyRev in FY25_26 JSONB = FY24_25 data (wrong). cyRev = actual FY25_26 target.
      const lyTargetFromCommits = lyRows.reduce((s, r) => s + rowMonthSum(r.monthly_targets, 'cyRev'), 0);
      const lyTargetFromAssign  = lyAsgTotals[repCode]?.lyTarget || 0;
      const lyTarget   = lyTargetFromCommits || lyTargetFromAssign;
      const lyAhv      = lyAsgTotals[repCode]?.lyAhv || 0;
      const cyTarget   = cyAsgTotals[repCode]         || 0;
      const aopEntered = cyRows.reduce((s, r) => s + rowMonthSum(r.monthly_targets, 'cyRev'), 0);

      return {
        employeeCode : repCode,
        fullName     : rep.full_name,
        territory    : rep.area_name,
        lyTarget,
        lyAhv,
        cyTarget,
        aopEntered,
        ownMonths    : buildOwnMonths(cyRows, 'cyRev'),
        ownProducts  : buildOwnProducts(cyRows, 'cyRev'),
      };
    });
  },

  /* ── Save CY yearly targets for Sales Reps ───────────────────────────── */

  async saveYearly(managerCode, fiscalYear, targets) {
    const fy = fiscalYear || CY_FY;
    let saved = 0;

    for (const t of targets) {
      const { employeeCode, yearlyTarget } = t;

      const existing = await db('aop.ts_yearly_target_assignments')
        .where({ fiscal_year_code: fy, assignee_code: employeeCode })
        .first();

      if (existing) {
        await db('aop.ts_yearly_target_assignments')
          .where({ id: existing.id })
          .update({ cy_target_value: yearlyTarget, updated_at: getKnex().fn.now() });
      } else {
        await db('aop.ts_yearly_target_assignments').insert({
          fiscal_year_code : fy,
          manager_code     : managerCode,
          assignee_code    : employeeCode,
          cy_target_value  : yearlyTarget,
          created_at       : getKnex().fn.now(),
          updated_at       : getKnex().fn.now(),
        });
      }
      saved++;
    }
    return { success: true, saved };
  },

  /* ── Save product-level monthly cyRev targets ─────────────────────────── */

  async saveProducts(fiscalYear, rows) {
    const fy = fiscalYear || CY_FY;
    let saved = 0;

    for (const row of rows) {
      const { assigneeCode, productCode, monthlyTargets } = row;

      const existing = await getKnex().raw(`
        SELECT id, monthly_targets
        FROM aop.ts_product_commitments
        WHERE employee_code = ? AND product_code = ? AND fiscal_year_code = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `, [assigneeCode, productCode, fy]);

      if (existing.rows.length > 0) {
        const current = existing.rows[0].monthly_targets || {};
        const updated = { ...current };

        MONTHS.forEach(m => {
          const cap = m.charAt(0).toUpperCase() + m.slice(1);
          const key = updated.hasOwnProperty(cap) ? cap : m;
          updated[key] = { ...(updated[key] || {}), cyRev: Number(monthlyTargets[m]) || 0 };
        });

        await db('aop.ts_product_commitments')
          .where({ id: existing.rows[0].id })
          .update({ monthly_targets: JSON.stringify(updated), updated_at: getKnex().fn.now() });
        saved++;
      }
    }
    return { success: true, saved };
  },
};

module.exports = SummaryTBMService;

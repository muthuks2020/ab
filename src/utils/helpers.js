/**
 * helpers.js — Shared Utility Functions
 * @version 2.0.0 - Migrated to aop schema (v5). formatCommitment updated for product_master JOINs.
 */

const MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];

const successResponse = (data, message = 'Success') => ({
  success: true,
  message,
  ...data,
});

const errorResponse = (message, details = null) => ({
  success: false,
  message,
  ...(details && { details }),
});

const aggregateMonthlyTargets = (commitments) => {
  let lyQty = 0, cyQty = 0, lyRev = 0, cyRev = 0;
  for (const c of commitments) {
    const mt = c.monthly_targets || c.monthlyTargets || {};
    for (const m of MONTHS) {
      const data = mt[m] || {};
      lyQty += Number(data.lyQty || 0);
      cyQty += Number(data.cyQty || 0);
      lyRev += Number(data.lyRev || 0);
      cyRev += Number(data.cyRev || 0);
    }
  }
  return { lyQty, cyQty, lyRev, cyRev };
};

const calcGrowth = (lyValue, cyValue) => {
  if (!lyValue || lyValue === 0) return 0;
  return Math.round(((cyValue - lyValue) / lyValue) * 100 * 10) / 10;
};

/**
 * Format a ts_product_commitments row for API response.
 * In v5, product_name/employee_name/unit are NO LONGER columns on ts_product_commitments.
 * They come from JOINs to product_master / ts_auth_users.
 */
const formatCommitment = (row) => ({
  id: row.id,
  fiscalYearCode: row.fiscal_year_code,
  employeeCode: row.employee_code,
  employeeName: row.employee_name || row.full_name || null,       // from JOIN to ts_auth_users
  employeeRole: row.employee_role || row.role || null,             // from JOIN to ts_auth_users
  productCode: row.product_code,
  productName: row.product_name || null,                           // from JOIN to product_master
  categoryId: row.category_id || row.product_category || null,
  unit: row.unit || null,
  zoneCode: row.zone_code,
  zoneName: row.zone_name,
  areaCode: row.area_code,
  areaName: row.area_name,
  territoryCode: row.territory_code,
  territoryName: row.territory_name,
  monthlyTargets: row.monthly_targets,
  status: row.status,
  submittedAt: row.submitted_at,
  approvedAt: row.approved_at,
  approvedByCode: row.approved_by_code,
  approvedByName: row.approved_by_name,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  // NEW v5: product details from JOIN (available when JOINed)
  unitCost: row.unit_cost ? parseFloat(row.unit_cost) : null,
  productCategory: row.product_category || null,
  productFamily: row.product_family || null,
});

/**
 * Format a ts_auth_users row for API response.
 */
const formatUser = (row) => ({
  id: row.id,
  employeeCode: row.employee_code,
  username: row.username,
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  designation: row.designation,
  zoneCode: row.zone_code,
  zoneName: row.zone_name,
  areaCode: row.area_code,
  areaName: row.area_name,
  territoryCode: row.territory_code,
  territoryName: row.territory_name,
  reportsTo: row.reports_to,
  isActive: row.is_active,
  isVacant: row.is_vacant || false,   // NEW in v5
});

module.exports = {
  MONTHS,
  successResponse,
  errorResponse,
  aggregateMonthlyTargets,
  calcGrowth,
  formatCommitment,
  formatUser,
};

/**
 * common.service.js — Shared Service (Categories, Products, Fiscal Years, Org Hierarchy)
 * @version 2.2.0 - Fixed getCategories():
 *   1. Replaced db.raw() in JOIN (fails locally) with getKnex().raw()
 *   2. ts_role_product_access.category_id values don't match ts_product_categories.id
 *      (access table has 'PMMA','Diagnostic & laser' etc; categories table has 'equipment','iol')
 *      So role filtering via JOIN is unreliable — return all active categories for any logged-in role.
 *      All 4 categories (equipment, iol, consumable-sales, msi) are valid for TBM.
 */

const { db, getKnex } = require('../config/database');

const CommonService = {

  /**
   * GET /categories — returns all active product categories
   * Role-based filtering removed: ts_role_product_access category_id values
   * don't match ts_product_categories id values so the JOIN was always broken.
   * All active categories are returned for any authenticated user.
   */
  async getCategories(userRole) {
    const rows = await db('ts_product_categories AS c')
      .where('c.is_active', true)
      .select('c.id', 'c.name', 'c.icon', 'c.color_class', 'c.is_revenue_only', 'c.display_order')
      .orderBy('c.display_order');

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      color: r.color_class,
      isRevenueOnly: r.is_revenue_only,
      displayOrder: r.display_order,
    }));
  },

  /**
   * GET /products — reads from aop.product_master
   */
  async getProducts(categoryId) {
    let query = db('product_master')
      .select(
        'productcode AS product_code',
        'product_subgroup AS product_name',   // human-readable name (product_name col is SF ID)
        'product_category AS category_id',
        'product_family AS subcategory',       // e.g. "Diagnostic", "Surgical", "Monofocal"
        'product_group AS subgroup',           // sub-grouping within subcategory
        'quota_price__c AS unit_cost',
        'isactive'
      )
      .where('isactive', true)
      .orderBy('product_family')
      .orderBy('product_group')
      .orderBy('product_subgroup');

    if (categoryId) {
      query = query.where('product_category', categoryId);
    }

    const rows = await query;
    return rows.map((r) => ({
      id: r.product_code,
      productCode: r.product_code,
      code: r.product_code,
      name: r.product_name || r.product_code,
      productName: r.product_name,
      categoryId: r.category_id,
      subcategory: r.subcategory,
      subgroup: r.subgroup,
      unitCost: parseFloat(r.unit_cost || 0),
      currency: 'INR',
    }));
  },

  /**
   * GET /product-pricing — reads from aop.product_master
   */
  async getProductPricing(categoryId) {
    let query = db('product_master')
      .select(
        'productcode AS product_code',
        'product_name',
        'product_category AS category_id',
        'product_family AS subcategory',
        'quota_price__c AS unit_cost'
      )
      .where('isactive', true)
      .whereNotNull('quota_price__c')
      .orderBy('product_name');

    if (categoryId) {
      query = query.where('product_category', categoryId);
    }

    const rows = await query;
    return rows.map((r) => ({
      productCode: r.product_code,
      productName: r.product_name,
      categoryId: r.category_id,
      subcategory: r.subcategory,
      unitCost: parseFloat(r.unit_cost || 0),
      currency: 'INR',
    }));
  },

  /**
   * GET /fiscal-years
   */
  async getFiscalYears() {
    const rows = await db('ts_fiscal_years')
      .select('id', 'code', 'label', 'start_date', 'end_date', 'is_active', 'is_commitment_open', 'commitment_deadline')
      .orderBy('start_date', 'desc');

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      label: r.label,
      startDate: r.start_date,
      endDate: r.end_date,
      isActive: r.is_active,
      isCommitmentOpen: r.is_commitment_open,
      commitmentDeadline: r.commitment_deadline,
    }));
  },

  /**
   * GET /aop-targets
   */
  async getAopTargets(userId, fiscalYear) {
    try {
      const rows = await getKnex().raw(
        `SELECT product_code, monthly_targets FROM aop.employee_product_targets
         WHERE employee_code = ? AND fiscal_year = ?`,
        [userId, fiscalYear]
      );
      return rows.rows;
    } catch {
      return [];
    }
  },

  /**
   * GET /org-hierarchy — from ts_v_org_hierarchy view
   */
  async getOrgHierarchy() {
    const rows = await db('ts_v_org_hierarchy').select('*');

    return rows.map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      fullName: r.full_name,
      role: r.role,
      designation: r.designation,
      email: r.email,
      phone: r.phone,
      zoneName: r.zone_name,
      areaName: r.area_name,
      territoryName: r.territory_name,
      reportsTo: r.reports_to,
      isActive: r.is_active,
      managerName: r.manager_name,
      managerRole: r.manager_role,
      directReportCount: parseInt(r.direct_report_count || 0),
    }));
  },

  /**
   * Get active fiscal year
   */
  async getActiveFiscalYear() {
    return db('ts_fiscal_years').where('is_active', true).first();
  },
};

module.exports = CommonService;

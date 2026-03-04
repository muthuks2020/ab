/**
 * admin.service.js — Admin Service (v5)
 * Full user CRUD, product management, fiscal year management, employee transfers, vacant positions.
 */
'use strict';
const { db } = require('../config/database');
const bcrypt = require('bcrypt');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const AdminService = {
  // ─── User Management ────────────────────────────────────────────────

  // GET /admin/users
  async getUsers(filters = {}) {
    let query = db('ts_auth_users').orderBy('full_name');
    if (filters.role) query = query.where('role', filters.role);
    if (filters.zone_code) query = query.where('zone_code', filters.zone_code);
    if (filters.area_code) query = query.where('area_code', filters.area_code);
    if (filters.is_active !== undefined) query = query.where('is_active', filters.is_active === 'true');
    if (filters.search) query = query.where(function() { this.where('full_name', 'ilike', `%${filters.search}%`).orWhere('employee_code', 'ilike', `%${filters.search}%`).orWhere('email', 'ilike', `%${filters.search}%`); });
    const rows = await query;
    return rows.map((r) => ({
      id: r.id, employeeCode: r.employee_code, username: r.username, fullName: r.full_name,
      email: r.email, phone: r.phone, role: r.role, designation: r.designation,
      zoneCode: r.zone_code, zoneName: r.zone_name, areaCode: r.area_code, areaName: r.area_name,
      territoryCode: r.territory_code, territoryName: r.territory_name, reportsTo: r.reports_to,
      isActive: r.is_active, isVacant: r.is_vacant || false, lastLoginAt: r.last_login_at,
      authProvider: r.auth_provider, createdAt: r.created_at,
    }));
  },

  // POST /admin/users
  async createUser(data) {
    const existing = await db('ts_auth_users').where('employee_code', data.employeeCode).first();
    if (existing) throw Object.assign(new Error('Employee code already exists.'), { status: 409 });
    const hash = data.password ? await bcrypt.hash(data.password, 10) : await bcrypt.hash('demo123', 10);
    const [user] = await db('ts_auth_users').insert({
      employee_code: data.employeeCode, username: data.username || data.employeeCode.toLowerCase(),
      password_hash: hash, full_name: data.fullName, email: data.email, phone: data.phone,
      role: data.role, designation: data.designation,
      zone_code: data.zoneCode, zone_name: data.zoneName,
      area_code: data.areaCode, area_name: data.areaName,
      territory_code: data.territoryCode, territory_name: data.territoryName,
      reports_to: data.reportsTo, is_active: true, is_vacant: false, auth_provider: 'local',
    }).returning('*');
    return { success: true, user: { id: user.id, employeeCode: user.employee_code, fullName: user.full_name } };
  },

  // PUT /admin/users/:id
  async updateUser(userId, data) {
    const user = await db('ts_auth_users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
    const updateData = {};
    if (data.fullName !== undefined) updateData.full_name = data.fullName;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.role !== undefined) updateData.role = data.role;
    if (data.designation !== undefined) updateData.designation = data.designation;
    if (data.zoneCode !== undefined) updateData.zone_code = data.zoneCode;
    if (data.zoneName !== undefined) updateData.zone_name = data.zoneName;
    if (data.areaCode !== undefined) updateData.area_code = data.areaCode;
    if (data.areaName !== undefined) updateData.area_name = data.areaName;
    if (data.territoryCode !== undefined) updateData.territory_code = data.territoryCode;
    if (data.territoryName !== undefined) updateData.territory_name = data.territoryName;
    if (data.reportsTo !== undefined) updateData.reports_to = data.reportsTo;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;
    if (data.isVacant !== undefined) updateData.is_vacant = data.isVacant;
    if (data.password) updateData.password_hash = await bcrypt.hash(data.password, 10);
    updateData.updated_at = new Date();
    await db('ts_auth_users').where({ id: userId }).update(updateData);
    return { success: true };
  },

  // DELETE /admin/users/:id (soft delete)
  async deleteUser(userId) {
    const user = await db('ts_auth_users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
    await db('ts_auth_users').where({ id: userId }).update({ is_active: false, updated_at: new Date() });
    return { success: true };
  },

  // PUT /admin/users/:id/toggle-status
  async toggleUserStatus(userId) {
    const user = await db('ts_auth_users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
    await db('ts_auth_users').where({ id: userId }).update({ is_active: !user.is_active, updated_at: new Date() });
    return { success: true, isActive: !user.is_active };
  },

  // ─── Employee Transfers ─────────────────────────────────────────────

  // POST /admin/transfer-employee  AND  POST /admin/reassign-position
  async transferEmployee(employeeCode, newGeo, transferredBy, reason) {
    const user = await db('ts_auth_users').where('employee_code', employeeCode).first();
    if (!user) throw Object.assign(new Error('Employee not found.'), { status: 404 });
    const activeFy = await getActiveFY();
    await db('ts_employee_territory_log').insert({
      employee_code: employeeCode, fiscal_year_code: activeFy,
      prev_zone_code: user.zone_code, prev_zone_name: user.zone_name,
      prev_area_code: user.area_code, prev_area_name: user.area_name,
      prev_territory_code: user.territory_code, prev_territory_name: user.territory_name,
      new_zone_code: newGeo.zoneCode, new_zone_name: newGeo.zoneName,
      new_area_code: newGeo.areaCode, new_area_name: newGeo.areaName,
      new_territory_code: newGeo.territoryCode, new_territory_name: newGeo.territoryName,
      prev_reports_to: user.reports_to, new_reports_to: newGeo.reportsTo,
      transferred_by: transferredBy, transfer_reason: reason, effective_date: new Date(),
    });
    await db('ts_auth_users').where('employee_code', employeeCode).update({
      zone_code: newGeo.zoneCode, zone_name: newGeo.zoneName,
      area_code: newGeo.areaCode, area_name: newGeo.areaName,
      territory_code: newGeo.territoryCode, territory_name: newGeo.territoryName,
      reports_to: newGeo.reportsTo, updated_at: new Date(),
    });
    return { success: true };
  },

  // GET /admin/transfer-history
  async getTransferHistory(employeeCode) {
    let query = db('ts_employee_territory_log').orderBy('effective_date', 'desc');
    if (employeeCode) query = query.where('employee_code', employeeCode);
    const rows = await query;
    return rows.map((r) => ({
      id: r.id, employeeCode: r.employee_code, fiscalYear: r.fiscal_year_code,
      prevZone: r.prev_zone_name, prevArea: r.prev_area_name, prevTerritory: r.prev_territory_name,
      newZone: r.new_zone_name, newArea: r.new_area_name, newTerritory: r.new_territory_name,
      prevReportsTo: r.prev_reports_to, newReportsTo: r.new_reports_to,
      transferredBy: r.transferred_by, reason: r.transfer_reason, effectiveDate: r.effective_date,
    }));
  },

  // ─── Product Management (read from product_master, admin can't edit SF data) ─

  // GET /admin/products
  async getProducts(filters = {}) {
    let query = db('product_master').orderBy('product_name');
    if (filters.category) query = query.where('product_category', filters.category);
    if (filters.search) query = query.where(function() { this.where('product_name', 'ilike', `%${filters.search}%`).orWhere('productcode', 'ilike', `%${filters.search}%`); });
    if (filters.isActive !== undefined) query = query.where('isactive', filters.isActive === 'true');
    const rows = await query.limit(500);
    return rows.map((r) => ({
      productCode: r.productcode, productName: r.product_name, categoryId: r.product_category,
      productFamily: r.product_family, productGroup: r.product_group,
      unitCost: parseFloat(r.quota_price__c || 0), isActive: r.isactive,
    }));
  },

  // GET /admin/categories
  async getCategories() {
    return db('ts_product_categories').where('is_active', true).orderBy('display_order');
  },

  // PUT /admin/products/:code/toggle-status (toggle local active flag if applicable)
  async toggleProductStatus(productCode) {
    const product = await db('product_master').where('productcode', productCode).first();
    if (!product) throw Object.assign(new Error('Product not found.'), { status: 404 });
    await db('product_master').where('productcode', productCode).update({ isactive: !product.isactive });
    return { success: true, isActive: !product.isactive };
  },

  // ─── Org Hierarchy ──────────────────────────────────────────────────

  // GET /admin/hierarchy
  async getHierarchy() {
    const rows = await db('ts_v_org_hierarchy');
    return rows;
  },

  // ─── Vacant Positions ───────────────────────────────────────────────

  // GET /admin/vacant-positions
  async getVacantPositions() {
    const rows = await db('ts_auth_users').where({ is_vacant: true, is_active: true }).orderBy('territory_name');
    return rows.map((r) => ({
      id: r.id, employeeCode: r.employee_code, fullName: r.full_name, role: r.role,
      designation: r.designation, zoneCode: r.zone_code, zoneName: r.zone_name,
      areaCode: r.area_code, areaName: r.area_name, territoryCode: r.territory_code,
      territoryName: r.territory_name, reportsTo: r.reports_to,
    }));
  },

  // PUT /admin/vacant-positions/:id/fill
  async fillVacantPosition(positionId, data) {
    const position = await db('ts_auth_users').where({ id: positionId, is_vacant: true }).first();
    if (!position) throw Object.assign(new Error('Vacant position not found.'), { status: 404 });
    const updateData = { is_vacant: false, updated_at: new Date() };
    if (data.fullName) updateData.full_name = data.fullName;
    if (data.email) updateData.email = data.email;
    if (data.phone) updateData.phone = data.phone;
    if (data.employeeCode) updateData.employee_code = data.employeeCode;
    if (data.password) updateData.password_hash = await bcrypt.hash(data.password, 10);
    await db('ts_auth_users').where({ id: positionId }).update(updateData);
    return { success: true };
  },

  // ─── Fiscal Year Management ─────────────────────────────────────────

  // GET /admin/fiscal-years
  async getFiscalYears() {
    return db('ts_fiscal_years').orderBy('start_date', 'desc');
  },

  // PUT /admin/fiscal-years/:fyCode/activate
  async activateFiscalYear(fyCode) {
    await db('ts_fiscal_years').update({ is_active: false });
    await db('ts_fiscal_years').where('code', fyCode).update({ is_active: true });
    return { success: true, activatedFY: fyCode };
  },

  // ─── Dashboard Stats ───────────────────────────────────────────────

  // GET /admin/dashboard-stats
  async getDashboardStats() {
    const activeFy = await getActiveFY();
    const totalUsers = await db('ts_auth_users').where('is_active', true).count('id as count').first();
    const vacantPositions = await db('ts_auth_users').where({ is_active: true, is_vacant: true }).count('id as count').first();
    const commitments = await db('ts_product_commitments').where('fiscal_year_code', activeFy);
    const transfers = await db('ts_employee_territory_log').where('fiscal_year_code', activeFy).count('id as count').first();
    return {
      totalUsers: parseInt(totalUsers.count),
      vacantPositions: parseInt(vacantPositions.count),
      totalCommitments: commitments.length,
      approved: commitments.filter((c) => c.status === 'approved').length,
      pending: commitments.filter((c) => c.status === 'submitted').length,
      draft: commitments.filter((c) => c.status === 'draft').length,
      transfers: parseInt(transfers.count),
      activeFiscalYear: activeFy,
    };
  },
};

module.exports = AdminService;

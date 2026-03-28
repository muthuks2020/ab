'use strict';
const { db, getKnex } = require('../config/database');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const getActiveFY = async () => {
  const fy = await db('ts_fiscal_years').where({ is_active: true }).first();
  return fy?.code || 'FY26_27';
};

const AdminService = {

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
      mustChangePassword: r.must_change_password || false,  // ← Phase 2 addition
    }));
  },

  async createUser(data) {
    const existing = await db('ts_auth_users').where('employee_code', data.employeeCode).first();
    if (existing) throw Object.assign(new Error('Employee code already exists.'), { status: 409 });

    // ← Phase 2: default password = employee code, must change on first login
    const defaultPassword = data.employeeCode;
    const hash = await bcrypt.hash(defaultPassword, 10);

    const [user] = await db('ts_auth_users').insert({
      employee_code: data.employeeCode, username: data.username || data.employeeCode.toLowerCase(),
      password_hash: hash, full_name: data.fullName, email: data.email, phone: data.phone,
      role: data.role, designation: data.designation,
      zone_code: data.zoneCode, zone_name: data.zoneName,
      area_code: data.areaCode, area_name: data.areaName,
      territory_code: data.territoryCode, territory_name: data.territoryName,
      reports_to: data.reportsTo, is_active: true, is_vacant: false, auth_provider: 'local',
      must_change_password: true,  // ← Phase 2: always forced on new users
    }).returning('*');
    return { success: true, user: { id: user.id, employeeCode: user.employee_code, fullName: user.full_name } };
  },

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

  async deleteUser(userId) {
    const user = await db('ts_auth_users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
    await db('ts_auth_users').where({ id: userId }).update({ is_active: false, updated_at: new Date() });
    return { success: true };
  },

  async toggleUserStatus(userId) {
    const user = await db('ts_auth_users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
    await db('ts_auth_users').where({ id: userId }).update({ is_active: !user.is_active, updated_at: new Date() });
    return { success: true, isActive: !user.is_active };
  },

  // ← Phase 2 addition: admin resets a user's password back to their employee code
  // Sets must_change_password = true so user is forced to change on next login
  async resetPassword(userId) {
    const user = await db('ts_auth_users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });

    const tempPassword = user.employee_code;   // reset to employee code
    const hash = await bcrypt.hash(tempPassword, 10);

    await db('ts_auth_users').where({ id: userId }).update({
      password_hash        : hash,
      must_change_password : true,
      updated_at           : new Date(),
    });

    console.log(`[Admin] Password reset for: ${user.employee_code} (${user.email})`);

    return {
      success      : true,
      message      : `Password reset to employee code. User must change password on next login.`,
      employeeCode : user.employee_code,
    };
  },

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

  async getProducts(filters = {}) {
    let query = db('product_master').orderBy('product_subgroup');
    if (filters.category) query = query.where('product_category', filters.category);
    if (filters.search) query = query.where(function() { this.where('product_subgroup', 'ilike', `%${filters.search}%`).orWhere('product_name', 'ilike', `%${filters.search}%`).orWhere('productcode', 'ilike', `%${filters.search}%`); });
    if (filters.isActive !== undefined) query = query.where('isactive', filters.isActive === 'true');
    const rows = await query.limit(500);
    return rows.map((r) => ({
      id: r.productcode,           // used as URL param in updateProduct
      productCode: r.productcode,
      // product_name is NULL in DB — actual name lives in product_subgroup
      productName: r.product_subgroup || r.product_name || '',
      productSubgroup: r.product_subgroup || r.product_name || '',
      categoryId: r.product_category,
      productFamily: r.product_family, productGroup: r.product_group,
      // quota_price__c is the populated price field; unitprice is NULL
      unitCost: parseFloat(r.quota_price__c || 0),
      quotaPrice: parseFloat(r.quota_price__c || 0),
      isActive: r.isactive,
      // Serialize DATE → 'YYYY-MM-DD' string (pg returns Date objects for DATE columns)
      activeFrom: r.active_from ? new Date(r.active_from).toISOString().slice(0, 10) : null,
      activeTo:   r.active_to   ? new Date(r.active_to).toISOString().slice(0, 10)   : null,
    }));
  },

  async createProduct(data) {
    // Generate AOP ID: 'AOP' prefix + 14 random alphanumeric chars (17 chars total)
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const rand = crypto.randomBytes(14);
    const suffix = Array.from(rand).map(b => chars[b % chars.length]).join('');
    const productCode = 'AOP' + suffix;   // AOP prefix = created in AOP application

    // Check for duplicate productcode (shouldn't happen with random, but guard it)
    const existing = await db('product_master').where('productcode', productCode).first();
    if (existing) throw Object.assign(new Error('Generated code collision, please retry.'), { status: 409 });

    // INSERT includes active_from/active_to — columns confirmed to exist
    const row = {
      productcode:      productCode,
      product_subgroup: data.name        || '',
      product_name:     data.name        || '',
      product_category: data.categoryId  || null,
      product_family:   data.subcategory || null,
      product_group:    data.subcategory || null,
      quota_price__c:   data.listPrice != null ? Number(data.listPrice) : null,
      isactive:         data.isActive !== undefined ? data.isActive : true,
      active_from:      data.activeFrom || null,
      active_to:        data.activeTo   || null,
      created_at:       new Date(),
      updated_at:       new Date(),
    };

    await db('product_master').insert(row);

    return { success: true, productCode, id: productCode };
  },

  async updateProduct(productCode, data) {
    const product = await db('product_master').where('productcode', productCode).first();
    if (!product) throw Object.assign(new Error('Product not found.'), { status: 404 });

    // Single UPDATE — all fields including active_from/active_to (ALTER TABLE confirmed run)
    const updateData = { updated_at: new Date() };
    if (data.name        !== undefined) updateData.product_subgroup = data.name;
    if (data.categoryId  !== undefined) updateData.product_category = data.categoryId;
    if (data.subcategory !== undefined) updateData.product_family   = data.subcategory;
    if (data.listPrice   !== undefined) updateData.quota_price__c   = Number(data.listPrice) || null;
    if (data.isActive    !== undefined) updateData.isactive         = data.isActive;
    if (data.activeFrom  !== undefined) updateData.active_from      = data.activeFrom || null;
    if (data.activeTo    !== undefined) updateData.active_to        = data.activeTo   || null;
    await db('product_master').where('productcode', productCode).update(updateData);

    return { success: true, productCode };
  },

  async getCategories() {
    return db('ts_product_categories').where('is_active', true).orderBy('display_order');
  },

  async toggleProductStatus(productCode) {
    const product = await db('product_master').where('productcode', productCode).first();
    if (!product) throw Object.assign(new Error('Product not found.'), { status: 404 });
    await db('product_master').where('productcode', productCode).update({ isactive: !product.isactive });
    return { success: true, isActive: !product.isactive };
  },

  async getHierarchy() {
    const result = await getKnex().raw(`
      WITH RECURSIVE org AS (
        SELECT employee_code, full_name, role::text AS role,
               designation, zone_name, area_name, territory_name,
               reports_to, zone_code, area_code, territory_code,
               is_vacant, is_active, 0 AS depth
        FROM   aop.ts_auth_users
        WHERE  reports_to IS NULL AND is_active = TRUE
        UNION ALL
        SELECT u.employee_code, u.full_name, u.role::text,
               u.designation, u.zone_name, u.area_name, u.territory_name,
               u.reports_to, u.zone_code, u.area_code, u.territory_code,
               u.is_vacant, u.is_active, o.depth + 1
        FROM   aop.ts_auth_users u
        JOIN   org o ON u.reports_to = o.employee_code
        WHERE  u.is_active = TRUE AND o.depth < 6
      )
      SELECT * FROM org ORDER BY depth, zone_name, area_name, full_name
    `);
    return result.rows;
  },

  async getVacantPositions() {
    const rows = await db('ts_auth_users').where({ is_vacant: true, is_active: true }).orderBy('territory_name');
    return rows.map((r) => ({
      id: r.id, employeeCode: r.employee_code, fullName: r.full_name, role: r.role,
      designation: r.designation, zoneCode: r.zone_code, zoneName: r.zone_name,
      areaCode: r.area_code, areaName: r.area_name, territoryCode: r.territory_code,
      territoryName: r.territory_name, reportsTo: r.reports_to,
    }));
  },

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

  async getFiscalYears() {
    return db('ts_fiscal_years').orderBy('start_date', 'desc');
  },

  async activateFiscalYear(fyCode) {
    await db('ts_fiscal_years').update({ is_active: false });
    await db('ts_fiscal_years').where('code', fyCode).update({ is_active: true });
    return { success: true, activatedFY: fyCode };
  },

  async getTargetProgress() {
    const FY = 'FY26_27';

    // ── Pending approvals: commitments submitted but not yet approved ─────────
    const pendingApprovalRow = await db('ts_product_commitments')
      .where({ fiscal_year_code: FY, status: 'submitted' })
      .countDistinct('employee_code as count')
      .first();
    const pendingApprovals = parseInt(pendingApprovalRow?.count || 0);

    // ── Per-employee target status: one row per assignee, best status wins ──
    // Uses DISTINCT ON to collapse multiple manager assignments per user.
    const result = await getKnex().raw(`
      SELECT DISTINCT ON (u.employee_code)
        u.employee_code,
        u.full_name,
        u.designation,
        u.role,
        u.zone_code,
        u.zone_name,
        u.area_code,
        u.area_name,
        u.territory_code,
        u.territory_name,
        u.reports_to,
        m.full_name         AS manager_name,
        m.designation       AS manager_designation,
        yta.cy_target_value,
        yta.status,
        yta.updated_at
      FROM   aop.ts_auth_users u
      LEFT   JOIN aop.ts_yearly_target_assignments yta
             ON  yta.assignee_code    = u.employee_code
             AND yta.fiscal_year_code = ?
      LEFT   JOIN aop.ts_auth_users m ON m.employee_code = u.reports_to
      WHERE  u.is_active  = TRUE
        AND  u.is_vacant  = FALSE
        AND  u.role NOT IN ('admin')
      ORDER  BY u.employee_code,
                CASE yta.status
                  WHEN 'published' THEN 1
                  WHEN 'draft'     THEN 2
                  ELSE 3
                END
    `, [FY]);

    const rows = result.rows.map((r) => ({
      employeeCode       : r.employee_code,
      fullName           : r.full_name,
      designation        : r.designation,
      role               : r.role,
      zoneCode           : r.zone_code,
      zoneName           : r.zone_name,
      areaCode           : r.area_code,
      areaName           : r.area_name,
      territoryCode      : r.territory_code,
      territoryName      : r.territory_name,
      managerName        : r.manager_name        || '—',
      managerDesignation : r.manager_designation || '—',
      cyTargetValue      : r.cy_target_value ? parseFloat(r.cy_target_value) : null,
      status             : r.status || 'not_set',
      updatedAt          : r.updated_at || null,
    }));

    const total     = rows.length;
    const entered   = rows.filter((r) => r.status !== 'not_set').length;
    const frozen    = rows.filter((r) => r.status === 'published').length;
    const notSet    = rows.filter((r) => r.status === 'not_set').length;

    return {
      summary: { total, entered, frozen, notSet, pendingApprovals },
      rows,
    };
  },

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

/**
 * auth.controller.js — Email + Password Authentication
 *
 * Login  : POST /auth/login       { email, password }
 * Logout : POST /auth/logout
 * Me     : GET  /auth/me
 *
 * @version 5.0.0 - Email login, no SSO, simple JWT
 */

const jwt    = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db     = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'appasamy-target-setting-jwt-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY  || '8h';

const ROLE_LABELS = {
  sales_rep          : 'Sales Representative',
  tbm                : 'Territory Business Manager',
  abm                : 'Area Business Manager',
  zbm                : 'Zonal Business Manager',
  sales_head         : 'Sales Head',
  admin              : 'System Administrator',
  at_iol_specialist  : 'AT/IOL Specialist',
  eq_spec_diagnostic : 'Equipment Specialist (Diagnostic)',
  eq_spec_surgical   : 'Equipment Specialist (Surgical)',
  at_iol_manager     : 'AT/IOL Manager',
  eq_mgr_diagnostic  : 'Equipment Manager (Diagnostic)',
  eq_mgr_surgical    : 'Equipment Manager (Surgical)',
};

// ═══════════════════════════════════════════════════════════════════
// POST /auth/login
// ═══════════════════════════════════════════════════════════════════
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const knex = db.getKnex();

    const user = await knex('aop.ts_auth_users')
      .where('email', email.trim().toLowerCase())
      .andWhere('is_active', true)
      .first();

    if (!user || !user.password_hash) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, employeeCode: user.employee_code },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    await knex('aop.ts_auth_users').where('id', user.id).update({ last_login_at: new Date() });

    return res.json({ success: true, token, user: formatUser(user) });

  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/logout
// ═══════════════════════════════════════════════════════════════════
async function logout(req, res) {
  return res.json({ success: true, message: 'Logged out successfully' });
}

// ═══════════════════════════════════════════════════════════════════
// GET /auth/me
// ═══════════════════════════════════════════════════════════════════
async function me(req, res) {
  try {
    const knex = db.getKnex();
    const user = await knex('aop.ts_auth_users')
      .where('id', req.user.id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({ success: true, user: formatUser(user) });

  } catch (err) {
    console.error('[Auth] Me error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════════
function formatUser(user) {
  return {
    id             : user.id,
    employee_code  : user.employee_code,
    employeeCode   : user.employee_code,
    name           : user.full_name,
    fullName       : user.full_name,
    username       : user.username,
    email          : user.email,
    role           : user.role,
    roleLabel      : ROLE_LABELS[user.role] || user.role,
    designation    : user.designation,
    territory      : user.territory_name || user.area_name || user.zone_name || 'Unassigned',
    zone_code      : user.zone_code,
    zone_name      : user.zone_name,
    area_code      : user.area_code,
    area_name      : user.area_name,
    territory_code : user.territory_code,
    territory_name : user.territory_name,
    reports_to     : user.reports_to,
    is_vacant      : user.is_vacant || false,
  };
}

module.exports = { login, logout, me };

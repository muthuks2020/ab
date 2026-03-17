const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const db     = require('../config/database');

const JWT_SECRET     = process.env.JWT_SECRET     || 'appasamy-target-setting-jwt-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

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

const ROLE_MAP = {
  'sales_rep'                         : 'sales_rep',
  'sales rep'                         : 'sales_rep',
  'salesrep'                          : 'sales_rep',
  'sales representative'              : 'sales_rep',
  'sales_representative'              : 'sales_rep',
  'sr'                                : 'sales_rep',
  'tbm'                               : 'tbm',
  'territory business manager'        : 'tbm',
  'territory_business_manager'        : 'tbm',
  'territory manager'                 : 'tbm',
  'abm'                               : 'abm',
  'area business manager'             : 'abm',
  'area_business_manager'             : 'abm',
  'area manager'                      : 'abm',
  'zbm'                               : 'zbm',
  'zonal business manager'            : 'zbm',
  'zonal_business_manager'            : 'zbm',
  'zonal manager'                     : 'zbm',
  'sales_head'                        : 'sales_head',
  'sales head'                        : 'sales_head',
  'saleshead'                         : 'sales_head',
  'head of sales'                     : 'sales_head',
  'national sales head'               : 'sales_head',
  'sales head (surgical)'             : 'sales_head',
  'sales head (diagnostic)'           : 'sales_head',
  'sales head surgical'               : 'sales_head',
  'sales head diagnostic'             : 'sales_head',
  'at_iol_specialist'                 : 'at_iol_specialist',
  'at iol specialist'                 : 'at_iol_specialist',
  'iol specialist'                    : 'at_iol_specialist',
  'at/iol specialist'                 : 'at_iol_specialist',
  'eq_spec_diagnostic'                : 'eq_spec_diagnostic',
  'equipment specialist diagnostic'   : 'eq_spec_diagnostic',
  'equipment specialist (diagnostic)' : 'eq_spec_diagnostic',
  'eq_spec_surgical'                  : 'eq_spec_surgical',
  'equipment specialist surgical'     : 'eq_spec_surgical',
  'equipment specialist (surgical)'   : 'eq_spec_surgical',
  'at_iol_manager'                    : 'at_iol_manager',
  'at iol manager'                    : 'at_iol_manager',
  'iol manager'                       : 'at_iol_manager',
  'at/iol manager'                    : 'at_iol_manager',
  'eq_mgr_diagnostic'                 : 'eq_mgr_diagnostic',
  'equipment manager diagnostic'      : 'eq_mgr_diagnostic',
  'equipment manager (diagnostic)'    : 'eq_mgr_diagnostic',
  'eq_mgr_surgical'                   : 'eq_mgr_surgical',
  'equipment manager surgical'        : 'eq_mgr_surgical',
  'equipment manager (surgical)'      : 'eq_mgr_surgical',
  'admin'                             : 'admin',
  'administrator'                     : 'admin',
  'system administrator'              : 'admin',
  'sysadmin'                          : 'admin',
};

function normalizeRole(raw) {
  if (!raw) return null;
  return ROLE_MAP[raw.trim().toLowerCase()] || null;
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    const knex = db.getKnex();

    const user = await knex('aop.ts_auth_users')
      .where('email', email.trim().toLowerCase())
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (!user.password_hash) {
      return res.status(401).json({ success: false, message: 'Password not set. Contact your administrator.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      console.log(`[Auth] Failed login attempt for: ${email}`);
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    await knex('aop.ts_auth_users').where('id', user.id).update({ last_login_at: new Date() });

    const token = jwt.sign(
      {
        userId       : user.id,
        employeeCode : user.employee_code,
        role         : normalizeRole(user.role) || user.role,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    console.log(`[Auth] Login OK: ${user.email} → role="${user.role}" → mustChangePassword=${user.must_change_password}`);

    return res.json({ success: true, token, user: formatUser(user) });

  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ─── Change Password ──────────────────────────────────────────────────────────
// Requires valid JWT (authenticated user).
// User must supply correct current password to set a new one.
// Clears must_change_password flag on success.
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from current password' });
    }

    const knex = db.getKnex();

    const user = await knex('aop.ts_auth_users')
      .where('id', req.user.id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await knex('aop.ts_auth_users').where('id', user.id).update({
      password_hash        : newHash,
      must_change_password : false,
      updated_at           : new Date(),
    });

    console.log(`[Auth] Password changed successfully for: ${user.email}`);

    return res.json({ success: true, message: 'Password changed successfully' });

  } catch (err) {
    console.error('[Auth] Change password error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout(req, res) {
  return res.json({ success: true, message: 'Logged out successfully' });
}

// ─── Me ───────────────────────────────────────────────────────────────────────
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

// ─── Format user for API response ─────────────────────────────────────────────
function formatUser(user) {
  const normalizedRole = normalizeRole(user.role) || user.role;
  return {
    id                 : user.id,
    employee_code      : user.employee_code,
    employeeCode       : user.employee_code,
    name               : user.full_name,
    fullName           : user.full_name,
    username           : user.username,
    email              : user.email,
    role               : normalizedRole,
    roleLabel          : ROLE_LABELS[normalizedRole] || user.role,
    designation        : user.designation,
    territory          : user.territory_name || user.area_name || user.zone_name || 'Unassigned',
    zone_code          : user.zone_code,
    zone_name          : user.zone_name,
    area_code          : user.area_code,
    area_name          : user.area_name,
    territory_code     : user.territory_code,
    territory_name     : user.territory_name,
    reports_to         : user.reports_to,
    is_vacant          : user.is_vacant || false,
    mustChangePassword : user.must_change_password || false,  // ← Phase 2: drives forced change screen
  };
}

module.exports = { login, logout, me, changePassword };

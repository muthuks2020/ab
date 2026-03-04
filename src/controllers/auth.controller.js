/**
 * auth.controller.js — Authentication Controller
 *
 * @version 3.1.0 - SSO: extract employee_code from phone_number claim
 * @author Appasamy Associates - Target Setting PWA
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../config/database');
const azureConfig = require('../config/azure-ad');
const ssoService = require('../services/sso.service');

const JWT_SECRET = process.env.JWT_SECRET || 'appasamy-target-setting-jwt-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';
const REFRESH_EXPIRY = process.env.REFRESH_EXPIRY || '7d';

const ROLE_LABELS = {
  sales_rep: 'Sales Representative',
  tbm: 'Territory Business Manager',
  abm: 'Area Business Manager',
  zbm: 'Zonal Business Manager',
  sales_head: 'Sales Head',
  admin: 'System Administrator',
  at_iol_specialist: 'AT/IOL Specialist',
  eq_spec_diagnostic: 'Equipment Specialist (Diagnostic)',
  eq_spec_surgical: 'Equipment Specialist (Surgical)',
  at_iol_manager: 'AT/IOL Manager',
  eq_mgr_diagnostic: 'Equipment Manager (Diagnostic)',
  eq_mgr_surgical: 'Equipment Manager (Surgical)',
};

// ═══════════════════════════════════════════════════════════════════
// POST /auth/login — Local credential login
// ═══════════════════════════════════════════════════════════════════
async function login(req, res) {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required',
      });
    }

    const knex = db.getKnex();

    const user = await knex('ts_auth_users')
      .where('username', username)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    if (user.auth_provider === 'azure_ad') {
      return res.status(401).json({
        success: false,
        message: 'This account uses Microsoft SSO. Please use "Sign in with Microsoft".',
      });
    }

    if (!user.password_hash) {
      return res.status(401).json({
        success: false,
        message: 'No password set. Please use SSO or contact admin.',
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
      });
    }

    const tokenData = await createSessionAndToken(knex, user, 'local', req);

    return res.json({
      success: true,
      ...tokenData,
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/sso-login — Azure AD SSO login
// ═══════════════════════════════════════════════════════════════════
async function ssoLogin(req, res) {
  try {
    if (!azureConfig.SSO_ENABLED) {
      return res.status(403).json({
        success: false,
        message: 'SSO is not enabled on this server',
      });
    }

    const { azure_token, email, name, azure_oid } = req.body;

    if (!azure_token) {
      return res.status(400).json({
        success: false,
        message: 'Azure AD token is required',
      });
    }

    let claims;
    try {
      claims = await ssoService.validateAzureToken(azure_token);
    } catch (tokenErr) {
      console.error('[SSO] Token validation failed:', tokenErr.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired Azure AD token',
      });
    }

    const validatedEmail  = (claims.preferred_username || claims.email || email || '').toLowerCase();
    const validatedName   = claims.name || name || validatedEmail.split('@')[0];
    const validatedOid    = claims.oid || claims.sub || azure_oid || '';
    const employeeCode    = claims.phone_number || claims.phoneNumber || '';  // Employee ID from Azure AD phone field
    const groups          = claims.groups || [];

    console.log('[SSO] Claims received — oid:', validatedOid,
      'email:', validatedEmail, 'employee_code:', employeeCode);

    if (!validatedOid) {
      return res.status(400).json({
        success: false,
        message: 'Could not determine Azure AD user identity',
      });
    }

    const knex = db.getKnex();
    const user = await ssoService.findOrCreateSsoUser({
      azure_oid: validatedOid,
      email: validatedEmail,
      name: validatedName,
      employee_code: employeeCode,
      groups,
    });

    if (!user || !user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact admin.',
      });
    }

    const tokenData = await createSessionAndToken(knex, user, 'azure_ad', req);

    return res.json({
      success: true,
      ...tokenData,
    });
  } catch (error) {
    console.error('[Auth] SSO Login error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/logout
// ═══════════════════════════════════════════════════════════════════
async function logout(req, res) {
  try {
    const knex = db.getKnex();

    if (req.user?.jti) {
      await knex('ts_user_sessions')
        .where('token_jti', req.user.jti)
        .update({ revoked_at: knex.fn.now() });
    }

    return res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Auth] Logout error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/refresh
// ═══════════════════════════════════════════════════════════════════
async function refresh(req, res) {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret');
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    const knex = db.getKnex();

    const session = await knex('ts_user_sessions')
      .where('token_jti', decoded.jti)
      .whereNull('revoked_at')
      .where('expires_at', '>', knex.fn.now())
      .first();

    if (!session) {
      return res.status(401).json({ success: false, message: 'Session not found or expired' });
    }

    // Revoke old session
    await knex('ts_user_sessions').where('id', session.id).update({ revoked_at: knex.fn.now() });

    const user = await knex('ts_auth_users')
      .where('id', session.user_id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    const tokenData = await createSessionAndToken(knex, user, user.auth_provider || 'local', req);

    return res.json({ success: true, ...tokenData });
  } catch (error) {
    console.error('[Auth] Refresh error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// GET /auth/me
// ═══════════════════════════════════════════════════════════════════
async function me(req, res) {
  try {
    const knex = db.getKnex();
    const user = await knex('ts_auth_users')
      .where('id', req.user.id)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.json({
      success: true,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error('[Auth] Me error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Create session and JWT
// ═══════════════════════════════════════════════════════════════════
async function createSessionAndToken(knex, user, provider, req) {
  const jti = crypto.randomUUID();
  const refreshToken = crypto.randomBytes(48).toString('hex');

  const token = jwt.sign(
    {
      id: user.id,
      userId: user.id,
      employeeCode: user.employee_code,
      role: user.role,
      jti,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  const decoded = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000);

  await knex('ts_user_sessions').insert({
    user_id: user.id,
    token_jti: jti,
    refresh_token: refreshToken,
    expires_at: expiresAt,
    ip_address: req.ip || req.connection?.remoteAddress || '0.0.0.0',
    user_agent: req.get('User-Agent') || '',
  });

  await knex('ts_auth_users')
    .where('id', user.id)
    .update({ last_login_at: knex.fn.now() });

  return {
    token,
    refresh_token: refreshToken,
    expires_at: expiresAt.toISOString(),
    user: formatUserResponse(user),
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Format user object for API response
// ═══════════════════════════════════════════════════════════════════
function formatUserResponse(user) {
  return {
    id: user.id,
    employee_code: user.employee_code,
    name: user.full_name,
    username: user.username,
    email: user.email,
    role: user.role,
    roleLabel: ROLE_LABELS[user.role] || user.role,
    designation: user.designation,
    territory: user.territory_name || user.area_name || user.zone_name || 'Unassigned',
    zone_code: user.zone_code,
    zone_name: user.zone_name,
    area_code: user.area_code,
    area_name: user.area_name,
    territory_code: user.territory_code,
    territory_name: user.territory_name,
    reports_to: user.reports_to,
    auth_provider: user.auth_provider,
    azure_oid: user.azure_oid || null,
    is_vacant: user.is_vacant || false,
  };
}

module.exports = {
  login,
  ssoLogin,
  logout,
  refresh,
  me,
};

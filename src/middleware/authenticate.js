/**
 * authenticate.js — Dual-Auth Middleware
 * 
 * Verifies the app JWT on protected routes.
 * DEMO_MODE: Bypasses all auth, injects a static user based on token role.
 * 
 * @version 3.2.0 - Fixed getDemoUser to read role from Bearer demo-token-{role}
 */

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'appasamy-target-setting-jwt-secret-change-me';
const DEMO_MODE = process.env.DEMO_MODE === 'true';

// ── Demo user profiles (used when DEMO_MODE=true) ──────────────────────
const DEMO_USERS = {
  sales_rep: {
    id: 1, employeeCode: 'E-000001', employee_code: 'E-000001',
    username: 'salesrep', name: 'Demo Sales Rep', fullName: 'Demo Sales Rep',
    email: 'salesrep@appasamy.com', role: 'sales_rep',
    designation: 'Sales Representative',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: 'A-BHR', area_name: 'Bihar',
    territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1',
    reports_to: 'E-000002', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  tbm: {
    id: 2, employeeCode: 'E-000002', employee_code: 'E-000002',
    username: 'tbm', name: 'Demo TBM', fullName: 'Demo TBM',
    email: 'tbm@appasamy.com', role: 'tbm',
    designation: 'Territory Business Manager',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: 'A-BHR', area_name: 'Bihar',
    territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1',
    reports_to: 'E-000003', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  abm: {
    id: 3, employeeCode: 'E-000003', employee_code: 'E-000003',
    username: 'abm', name: 'Demo ABM', fullName: 'Demo ABM',
    email: 'abm@appasamy.com', role: 'abm',
    designation: 'Area Business Manager',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: 'A-BHR', area_name: 'Bihar',
    territory_code: null, territory_name: null,
    reports_to: 'E-000004', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  zbm: {
    id: 4, employeeCode: 'E-000004', employee_code: 'E-000004',
    username: 'zbm', name: 'Demo ZBM', fullName: 'Demo ZBM',
    email: 'zbm@appasamy.com', role: 'zbm',
    designation: 'Zonal Business Manager',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: null, area_name: null,
    territory_code: null, territory_name: null,
    reports_to: 'E-000005', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  sales_head: {
    id: 5, employeeCode: 'E-000005', employee_code: 'E-000005',
    username: 'saleshead', name: 'Demo Sales Head', fullName: 'Demo Sales Head',
    email: 'saleshead@appasamy.com', role: 'sales_head',
    designation: 'Sales Head',
    zone_code: null, zone_name: null,
    area_code: null, area_name: null,
    territory_code: null, territory_name: null,
    reports_to: null, auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  at_iol_specialist: {
    id: 6, employeeCode: 'E-000006', employee_code: 'E-000006',
    username: 'iolspec', name: 'Demo IOL Specialist', fullName: 'Demo IOL Specialist',
    email: 'iolspec@appasamy.com', role: 'at_iol_specialist',
    designation: 'AT/IOL Specialist',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: 'A-BHR', area_name: 'Bihar',
    territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1',
    reports_to: 'E-000003', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  eq_spec_diagnostic: {
    id: 7, employeeCode: 'E-000007', employee_code: 'E-000007',
    username: 'eqdiag', name: 'Demo Equip Spec Diagnostic', fullName: 'Demo Equip Spec Diagnostic',
    email: 'eqdiag@appasamy.com', role: 'eq_spec_diagnostic',
    designation: 'Equipment Specialist (Diagnostic)',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: 'A-BHR', area_name: 'Bihar',
    territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1',
    reports_to: 'E-000003', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  eq_spec_surgical: {
    id: 8, employeeCode: 'E-000008', employee_code: 'E-000008',
    username: 'eqsurg', name: 'Demo Equip Spec Surgical', fullName: 'Demo Equip Spec Surgical',
    email: 'eqsurg@appasamy.com', role: 'eq_spec_surgical',
    designation: 'Equipment Specialist (Surgical)',
    zone_code: 'Z3', zone_name: 'Zone-3',
    area_code: 'A-BHR', area_name: 'Bihar',
    territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1',
    reports_to: 'E-000003', auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
  admin: {
    id: 99, employeeCode: 'E-000099', employee_code: 'E-000099',
    username: 'admin', name: 'Demo Admin', fullName: 'Demo Admin',
    email: 'admin@appasamy.com', role: 'admin',
    designation: 'System Administrator',
    zone_code: null, zone_name: null,
    area_code: null, area_name: null,
    territory_code: null, territory_name: null,
    reports_to: null, auth_provider: 'local', isVacant: false, jti: 'demo-jti',
  },
};

/**
 * Get demo user — reads role from:
 *   1. x-demo-role header
 *   2. Bearer demo-token-{role} token  ★ THIS WAS MISSING
 *   3. DEMO_ROLE env variable
 *   4. Defaults to sales_rep
 */
function getDemoUser(req) {
  let role = req.headers['x-demo-role'];

  // ★ FIX: Extract role from demo token (demo-token-tbm → tbm)
  if (!role) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (token.startsWith('demo-token-')) {
      role = token.replace('demo-token-', '');
    }
  }

  if (!role) {
    role = process.env.DEMO_ROLE;
  }

  role = (role || 'sales_rep').toLowerCase();
  
  console.log(`[Auth DEMO] Resolved role: ${role}`);
  
  return DEMO_USERS[role] || DEMO_USERS.sales_rep;
}

/**
 * Main authentication middleware.
 */
async function authenticate(req, res, next) {
  try {
    // ── DEMO MODE: bypass all auth ──────────────────────────────────────
    if (DEMO_MODE) {
      req.user = getDemoUser(req);
      return next();
    }

    // ── Step 1: Extract token ───────────────────────────────────────────
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.',
      });
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. Invalid token format.',
      });
    }

    // ── Step 2: Verify JWT ──────────────────────────────────────────────
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expired. Please login again.',
          code: 'TOKEN_EXPIRED',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
      });
    }

    // ── Step 3: Check session is not revoked ────────────────────────────
    const knex = db.getKnex();

    if (decoded.jti) {
      const session = await knex('ts_user_sessions')
        .where('token_jti', decoded.jti)
        .whereNull('revoked_at')
        .where('expires_at', '>', knex.fn.now())
        .first();

      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'Session expired or revoked. Please login again.',
          code: 'SESSION_REVOKED',
        });
      }
    }

    // ── Step 4: Fetch user and verify active ────────────────────────────
    const user = await knex('ts_auth_users')
      .where('id', decoded.id || decoded.userId)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User account not found or deactivated.',
      });
    }

    // ── Step 5: Attach user to request ──────────────────────────────────
    req.user = {
      id: user.id,
      employeeCode: user.employee_code,
      employee_code: user.employee_code,
      username: user.username,
      name: user.full_name,
      fullName: user.full_name,
      email: user.email,
      role: user.role,
      designation: user.designation,
      zone_code: user.zone_code,
      zone_name: user.zone_name,
      area_code: user.area_code,
      area_name: user.area_name,
      territory_code: user.territory_code,
      territory_name: user.territory_name,
      reports_to: user.reports_to,
      auth_provider: user.auth_provider,
      isVacant: user.is_vacant || false,
      jti: decoded.jti,
    };

    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication error.',
    });
  }
}

/**
 * Optional auth middleware — attaches user if token present, doesn't block.
 */
async function optionalAuth(req, res, next) {
  if (DEMO_MODE) {
    req.user = getDemoUser(req);
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  try {
    await authenticate(req, res, () => {});
  } catch {
    req.user = null;
  }

  next();
}

module.exports = {
  authenticate,
  optionalAuth,
};

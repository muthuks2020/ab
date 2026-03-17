const jwt = require('jsonwebtoken');
const db  = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'appasamy-target-setting-jwt-secret-change-me';

const ROLE_MAP = {
  'sales_rep'                         : 'sales_rep',
  'sales rep'                         : 'sales_rep',
  'salesrep'                          : 'sales_rep',
  'sales representative'              : 'sales_rep',
  'sales_representative'              : 'sales_rep',
  'salesrepresentative'               : 'sales_rep',
  'sr'                                : 'sales_rep',
  'tbm'                               : 'tbm',
  'territory business manager'        : 'tbm',
  'territory_business_manager'        : 'tbm',
  'territorybusinessmanager'          : 'tbm',
  'territory manager'                 : 'tbm',
  'territory_manager'                 : 'tbm',
  'abm'                               : 'abm',
  'area business manager'             : 'abm',
  'area_business_manager'             : 'abm',
  'areabusinessmanager'               : 'abm',
  'area manager'                      : 'abm',
  'area_manager'                      : 'abm',
  'zbm'                               : 'zbm',
  'zonal business manager'            : 'zbm',
  'zonal_business_manager'            : 'zbm',
  'zonalbusinessmanager'              : 'zbm',
  'zonal manager'                     : 'zbm',
  'zonal_manager'                     : 'zbm',
  'sales_head'                        : 'sales_head',
  'sales head'                        : 'sales_head',
  'saleshead'                         : 'sales_head',
  'head of sales'                     : 'sales_head',
  'head_of_sales'                     : 'sales_head',
  'national sales head'               : 'sales_head',
  'sales head (surgical)'             : 'sales_head',
  'sales head (diagnostic)'           : 'sales_head',
  'equipment specialist - surgical systems'  : 'sales_rep',
  'equipment specialist- surgical systems'   : 'sales_rep',
  'at_iol_specialist'                 : 'at_iol_specialist',
  'at iol specialist'                 : 'at_iol_specialist',
  'iol specialist'                    : 'at_iol_specialist',
  'iol_specialist'                    : 'at_iol_specialist',
  'at/iol specialist'                 : 'at_iol_specialist',
  'eq_spec_diagnostic'                : 'eq_spec_diagnostic',
  'eq spec diagnostic'                : 'eq_spec_diagnostic',
  'equipment specialist diagnostic'   : 'eq_spec_diagnostic',
  'equipment_specialist_diagnostic'   : 'eq_spec_diagnostic',
  'equipment specialist (diagnostic)' : 'eq_spec_diagnostic',
  'eq_spec_surgical'                  : 'eq_spec_surgical',
  'eq spec surgical'                  : 'eq_spec_surgical',
  'equipment specialist surgical'     : 'eq_spec_surgical',
  'equipment_specialist_surgical'     : 'eq_spec_surgical',
  'equipment specialist (surgical)'   : 'eq_spec_surgical',
  'at_iol_manager'                    : 'at_iol_manager',
  'at iol manager'                    : 'at_iol_manager',
  'iol manager'                       : 'at_iol_manager',
  'iol_manager'                       : 'at_iol_manager',
  'at/iol manager'                    : 'at_iol_manager',
  'eq_mgr_diagnostic'                 : 'eq_mgr_diagnostic',
  'eq mgr diagnostic'                 : 'eq_mgr_diagnostic',
  'equipment manager diagnostic'      : 'eq_mgr_diagnostic',
  'equipment_manager_diagnostic'      : 'eq_mgr_diagnostic',
  'equipment manager (diagnostic)'    : 'eq_mgr_diagnostic',
  'eq_mgr_surgical'                   : 'eq_mgr_surgical',
  'eq mgr surgical'                   : 'eq_mgr_surgical',
  'equipment manager surgical'        : 'eq_mgr_surgical',
  'equipment_manager_surgical'        : 'eq_mgr_surgical',
  'equipment manager (surgical)'      : 'eq_mgr_surgical',
  'admin'                             : 'admin',
  'administrator'                     : 'admin',
  'system administrator'              : 'admin',
  'system_administrator'              : 'admin',
  'sysadmin'                          : 'admin',
};

function normalizeRole(rawRole) {
  if (!rawRole) return null;
  const key    = rawRole.trim().toLowerCase();
  const mapped = ROLE_MAP[key];
  if (!mapped) {
    console.warn(`[Auth] Unknown role in DB: "${rawRole}" — access will be denied`);
  }
  return mapped || null;
}

const DEMO_USERS = {
  sales_rep  : { id: 1,  employeeCode: 'E-000001', employee_code: 'E-000001', username: 'salesrep',  name: 'Demo Sales Rep',   fullName: 'Demo Sales Rep',   email: 'salesrep@appasamy.com',  role: 'sales_rep',  designation: 'Sales Representative',          zone_code: 'Z3', zone_name: 'Zone-3', area_code: 'A-BHR', area_name: 'Bihar', territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1', reports_to: 'E-000002', isVacant: false },
  tbm        : { id: 2,  employeeCode: 'E-000002', employee_code: 'E-000002', username: 'tbm',        name: 'Demo TBM',         fullName: 'Demo TBM',         email: 'tbm@appasamy.com',       role: 'tbm',        designation: 'Territory Business Manager',     zone_code: 'Z3', zone_name: 'Zone-3', area_code: 'A-BHR', area_name: 'Bihar', territory_code: 'T-BHR-PAT-1', territory_name: 'Bihar(Patna)-1', reports_to: 'E-000003', isVacant: false },
  abm        : { id: 3,  employeeCode: 'E-000003', employee_code: 'E-000003', username: 'abm',        name: 'Demo ABM',         fullName: 'Demo ABM',         email: 'abm@appasamy.com',       role: 'abm',        designation: 'Area Business Manager',          zone_code: 'Z3', zone_name: 'Zone-3', area_code: 'A-BHR', area_name: 'Bihar', territory_code: null,           territory_name: null,             reports_to: 'E-000004', isVacant: false },
  zbm        : { id: 4,  employeeCode: 'E-000004', employee_code: 'E-000004', username: 'zbm',        name: 'Demo ZBM',         fullName: 'Demo ZBM',         email: 'zbm@appasamy.com',       role: 'zbm',        designation: 'Zonal Business Manager',         zone_code: 'Z3', zone_name: 'Zone-3', area_code: null,     area_name: null,    territory_code: null,           territory_name: null,             reports_to: 'E-000005', isVacant: false },
  sales_head : { id: 5,  employeeCode: 'E-000005', employee_code: 'E-000005', username: 'saleshead', name: 'Demo Sales Head',  fullName: 'Demo Sales Head',  email: 'saleshead@appasamy.com', role: 'sales_head', designation: 'Sales Head',                     zone_code: null, zone_name: null,     area_code: null,     area_name: null,    territory_code: null,           territory_name: null,             reports_to: null,        isVacant: false },
  admin      : { id: 99, employeeCode: 'E-000099', employee_code: 'E-000099', username: 'admin',      name: 'Demo Admin',       fullName: 'Demo Admin',       email: 'admin@appasamy.com',     role: 'admin',      designation: 'System Administrator',           zone_code: null, zone_name: null,     area_code: null,     area_name: null,    territory_code: null,           territory_name: null,             reports_to: null,        isVacant: false },
};

const DEMO_MODE = process.env.DEMO_MODE === 'true';

function getDemoUser(req) {
  let role = req.headers['x-demo-role'];
  if (!role) {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (token.startsWith('demo-token-')) role = token.replace('demo-token-', '');
  }
  if (!role) role = process.env.DEMO_ROLE;
  role = (role || 'sales_rep').toLowerCase();
  return DEMO_USERS[role] || DEMO_USERS.sales_rep;
}

async function authenticate(req, res, next) {
  try {
    // ── Demo mode bypass ────────────────────────────────────────────────────
    if (DEMO_MODE) {
      req.user = getDemoUser(req);
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    // ── Verify JWT (replaces old base64 decodeToken) ────────────────────────
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Session expired. Please log in again.', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ success: false, message: 'Invalid token.' });
    }

    const userId = decoded.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Invalid token payload.' });
    }

    // ── Load fresh user from DB ─────────────────────────────────────────────
    const knex = db.getKnex();
    const user = await knex('aop.ts_auth_users')
      .where('id', userId)
      .andWhere('is_active', true)
      .first();

    if (!user) {
      return res.status(401).json({ success: false, message: 'User account not found or deactivated.' });
    }

    const normalizedRole = normalizeRole(user.role);
    if (!normalizedRole) {
      console.error(`[Auth] Cannot map DB role "${user.role}" for user ${user.email}`);
      return res.status(403).json({ success: false, message: `Unrecognized role "${user.role}". Please contact admin.` });
    }

    req.user = {
      id             : user.id,
      employeeCode   : user.employee_code,
      employee_code  : user.employee_code,
      username       : user.username,
      name           : user.full_name,
      fullName       : user.full_name,
      email          : user.email,
      role           : normalizedRole,
      designation    : user.designation,
      zone_code      : user.zone_code,
      zone_name      : user.zone_name,
      area_code      : user.area_code,
      area_name      : user.area_name,
      territory_code : user.territory_code,
      territory_name : user.territory_name,
      reports_to     : user.reports_to,
      isVacant       : user.is_vacant || false,
    };

    next();
  } catch (error) {
    console.error('[Auth Middleware] Error:', error);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
}

function optionalAuth(req, res, next) {
  req.user = null;
  next();
}

module.exports = { authenticate, optionalAuth };

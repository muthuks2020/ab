require('dotenv').config();

// Fix: dotenv strips # from password
if (process.env.DB_PASSWORD === 'Appa321!@') {
  process.env.DB_PASSWORD = 'Appa321!@#';
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const { testConnection } = require('./config/database');
const { auditMiddleware } = require('./middleware/audit');
const errorHandler = require('./middleware/errorHandler');

// Route imports
const authRoutes = require('./routes/auth.routes');
const commonRoutes = require('./routes/common.routes');
const salesrepRoutes = require('./routes/salesrep.routes');
const tbmRoutes = require('./routes/tbm.routes');
const specialistRoutes = require('./routes/specialist.routes');
const abmSpecialistRoutes = require('./routes/abmSpecialist.routes');
const abmRoutes = require('./routes/abm.routes');
const zbmRoutes = require('./routes/zbm.routes');
const salesheadRoutes = require('./routes/saleshead.routes');
const adminRoutes     = require('./routes/admin.routes');

// Middleware imports for inline auth on ABM specialist routes
const authenticate = require('./middleware/authenticate');
const authorize = require('./middleware/authorize');

const app = express();
app.disable('etag');

// ── Disable all caching ────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.set({
    'Cache-Control'    : 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma'           : 'no-cache',
    'Expires'          : '0',
    'Surrogate-Control': 'no-store',
  });
  next();
});
const PORT = parseInt(process.env.PORT || '4001', 10);
const API_PREFIX = process.env.API_PREFIX || '/api/v1';
const DEMO_MODE = process.env.DEMO_MODE === 'true';


app.use(helmet());


const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:4000')
  .split(',')
  .map((o) => o.trim());

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));


app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));


app.use(compression());


if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}


const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  message: { success: false, message: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(API_PREFIX, limiter);


app.use(auditMiddleware);


app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'target-setting-api',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    demoMode: DEMO_MODE,
  });
});


// ========== DEMO MODE LOGIN BYPASS ==========
// When DEMO_MODE=true, accepts any credentials and returns a static token.
// The role is determined by the username typed in the login form.
// e.g., username "tbm" → TBM role, username "abm" → ABM role, etc.
if (DEMO_MODE) {
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

  // Map login usernames to roles
  const USERNAME_TO_ROLE = {
    salesrep: 'sales_rep',
    sales_rep: 'sales_rep',
    sr: 'sales_rep',
    tbm: 'tbm',
    abm: 'abm',
    zbm: 'zbm',
    saleshead: 'sales_head',
    sales_head: 'sales_head',
    sh: 'sales_head',
    admin: 'admin',
    iolspec: 'at_iol_specialist',
    at_iol_specialist: 'at_iol_specialist',
    eqdiag: 'eq_spec_diagnostic',
    eq_spec_diagnostic: 'eq_spec_diagnostic',
    eqsurg: 'eq_spec_surgical',
    eq_spec_surgical: 'eq_spec_surgical',
    iolmgr: 'at_iol_manager',
    at_iol_manager: 'at_iol_manager',
    eqmgrdiag: 'eq_mgr_diagnostic',
    eq_mgr_diagnostic: 'eq_mgr_diagnostic',
    eqmgrsurg: 'eq_mgr_surgical',
    eq_mgr_surgical: 'eq_mgr_surgical',
  };

  const DEMO_USERS = {
    sales_rep: {
      id: 1, employeeCode: 'E-000001', username: 'salesrep',
      fullName: 'Demo Sales Rep', email: 'salesrep@appasamy.com',
      role: 'sales_rep', designation: 'Sales Representative',
      zoneCode: 'Z3', zoneName: 'Zone-3',
      areaCode: 'A-BHR', areaName: 'Bihar',
      territoryCode: 'T-BHR-PAT-1', territoryName: 'Bihar(Patna)-1',
      reportsTo: 'E-000002', isVacant: false,
    },
    tbm: {
      id: 2, employeeCode: 'E-000002', username: 'tbm',
      fullName: 'Demo TBM', email: 'tbm@appasamy.com',
      role: 'tbm', designation: 'Territory Business Manager',
      zoneCode: 'Z3', zoneName: 'Zone-3',
      areaCode: 'A-BHR', areaName: 'Bihar',
      territoryCode: 'T-BHR-PAT-1', territoryName: 'Bihar(Patna)-1',
      reportsTo: 'E-000003', isVacant: false,
    },
    abm: {
      id: 3, employeeCode: 'E-000003', username: 'abm',
      fullName: 'Demo ABM', email: 'abm@appasamy.com',
      role: 'abm', designation: 'Area Business Manager',
      zoneCode: 'Z3', zoneName: 'Zone-3',
      areaCode: 'A-BHR', areaName: 'Bihar',
      territoryCode: null, territoryName: null,
      reportsTo: 'E-000004', isVacant: false,
    },
    zbm: {
      id: 4, employeeCode: 'E-000004', username: 'zbm',
      fullName: 'Demo ZBM', email: 'zbm@appasamy.com',
      role: 'zbm', designation: 'Zonal Business Manager',
      zoneCode: 'Z3', zoneName: 'Zone-3',
      areaCode: null, areaName: null,
      territoryCode: null, territoryName: null,
      reportsTo: 'E-000005', isVacant: false,
    },
    sales_head: {
      id: 5, employeeCode: 'E-000005', username: 'saleshead',
      fullName: 'Demo Sales Head', email: 'saleshead@appasamy.com',
      role: 'sales_head', designation: 'Sales Head',
      zoneCode: null, zoneName: null,
      areaCode: null, areaName: null,
      territoryCode: null, territoryName: null,
      reportsTo: null, isVacant: false,
    },
    admin: {
      id: 99, employeeCode: 'E-000099', username: 'admin',
      fullName: 'Demo Admin', email: 'admin@appasamy.com',
      role: 'admin', designation: 'System Administrator',
      zoneCode: null, zoneName: null,
      areaCode: null, areaName: null,
      territoryCode: null, territoryName: null,
      reportsTo: null, isVacant: false,
    },
  };

  // Demo login — accepts any password, role based on username
  app.post(`${API_PREFIX}/auth/login`, (req, res) => {
    const { username } = req.body;
    const roleKey = USERNAME_TO_ROLE[(username || '').toLowerCase()] || 'sales_rep';
    const user = DEMO_USERS[roleKey];

    console.log(`[DEMO] Login as "${username}" → role: ${roleKey}`);

    return res.json({
      success: true,
      token: 'demo-token-' + roleKey,
      accessToken: 'demo-token-' + roleKey,
      refresh_token: 'demo-refresh-' + roleKey,
      user,
    });
  });

  // Demo /auth/me — returns current demo user
  app.get(`${API_PREFIX}/auth/me`, (req, res) => {
    // Try to figure out role from the token
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    const roleKey = token.replace('demo-token-', '').replace('demo-sso-token-', '') || 'sales_rep';
    const user = DEMO_USERS[roleKey] || DEMO_USERS.sales_rep;

    return res.json({ success: true, user });
  });

  console.log('⚠️  DEMO MODE ENABLED — Auth bypassed, any credentials accepted');
  console.log('   Login as: salesrep, tbm, abm, zbm, saleshead, admin, iolspec, eqdiag, eqsurg');
}


// ========== API ROUTES ==========
// ★ ORDER MATTERS: salesrepRoutes MUST come before commonRoutes
// Both define GET /products — salesrepRoutes returns commitment data
// (with monthlyTargets from ts_product_commitments), while commonRoutes
// returns catalog data (just product names from product_master).
// The sales rep dashboard needs commitment data.
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(API_PREFIX, salesrepRoutes);          // ★ FIRST — GET /products → CommitmentService (with monthlyTargets)
app.use(API_PREFIX, commonRoutes);            // ★ SECOND — /categories, /fiscal-years, etc.
app.use(`${API_PREFIX}/tbm`, tbmRoutes);
app.use(`${API_PREFIX}/specialist`, specialistRoutes);
app.use(`${API_PREFIX}/abm`, abmSpecialistRoutes);
app.use(`${API_PREFIX}/abm`, abmRoutes);
app.use(`${API_PREFIX}/zbm`, zbmRoutes);
app.use(`${API_PREFIX}/saleshead`, salesheadRoutes);
app.use(`${API_PREFIX}/admin`,    adminRoutes);



app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});


app.use(errorHandler);


const startServer = async () => {
  await testConnection();

  app.listen(PORT, () => {
    console.log(`\nTarget Setting API running on port ${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV}`);
    console.log(`   API prefix:  ${API_PREFIX}`);
    console.log(`   Auth mode:   ${DEMO_MODE ? '⚠️  DEMO (no auth)' : (process.env.AUTH_MODE || 'local')}`);
    console.log(`   Health:      http://localhost:${PORT}/health`);
    console.log(`   CORS:        ${corsOrigins.join(', ')}\n`);
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;

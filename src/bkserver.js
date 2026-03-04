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

// Middleware imports for inline auth on ABM specialist routes
const authenticate = require('./middleware/authenticate');
const authorize = require('./middleware/authorize');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);
const API_PREFIX = process.env.API_PREFIX || '/api/v1';


app.use(helmet());


const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
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
  });
});


// ========== API ROUTES ==========
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(API_PREFIX, commonRoutes);
app.use(API_PREFIX, salesrepRoutes);
app.use(`${API_PREFIX}/tbm`, tbmRoutes);
app.use(`${API_PREFIX}/specialist`, specialistRoutes);
app.use(`${API_PREFIX}/abm`, abmSpecialistRoutes);



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
    console.log(`   Auth mode:   ${process.env.AUTH_MODE || 'local'}`);
    console.log(`   Health:      http://localhost:${PORT}/health`);
    console.log(`   CORS:        ${corsOrigins.join(', ')}\n`);
  });
};

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = app;

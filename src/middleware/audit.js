/**
 * audit.js — Audit Logging Middleware
 * @version 2.0.0 - Migrated to aop.ts_* schema (v5)
 */

const { db } = require('../config/database');

const logAudit = async ({ actorCode, actorRole, action, entityType, entityId, detail, ipAddress }) => {
  try {
    await db('ts_audit_log').insert({
      actor_code: actorCode,
      actor_role: actorRole,
      action,
      entity_type: entityType,
      entity_id: entityId,
      detail: detail ? JSON.stringify(detail) : null,
      ip_address: ipAddress || null,
    });
  } catch (err) {
    console.error('Audit log write failed:', err.message);
  }
};

const auditMiddleware = (req, res, next) => {
  req.logAudit = (params) =>
    logAudit({
      actorCode: req.user?.employeeCode || 'system',
      actorRole: req.user?.role || null,
      ipAddress: req.ip,
      ...params,
    });
  next();
};

module.exports = { auditMiddleware, logAudit };

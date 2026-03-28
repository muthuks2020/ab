'use strict';
/**
 * summaryHead.controller.js
 * Stage 3 — adds saveYearly and saveProducts handlers
 *
 * Thin controller pattern — reads from req.user / req.body,
 * delegates all DB work to summaryHead.service.js, returns JSON.
 */

const SummaryHeadService = require('../services/summaryHead.service');

module.exports = {

  /* ── Stage 1 / 2 ─────────────────────────────────────────────────────── */

  async getSummaryForHead(req, res, next) {
    try {
      const managerCode = req.user.employeeCode || req.user.employee_code;

      if (!managerCode) {
        return res.status(400).json({
          success : false,
          message : 'Employee code not found in JWT — cannot resolve team.',
        });
      }

      const data = await SummaryHeadService.getSummaryData(managerCode);

      return res.json({
        success     : true,
        managerCode,
        count       : data.length,
        zbms        : data,
      });

    } catch (err) {
      console.error('[SummaryHead] getSummaryForHead error:', err);
      next(err);
    }
  },

  /* ── Stage 3 — Save yearly targets ───────────────────────────────────── */

  async saveYearly(req, res, next) {
    try {
      const managerCode = req.user.employeeCode || req.user.employee_code;
      if (!managerCode) {
        return res.status(400).json({ success: false, message: 'Employee code not found in JWT.' });
      }

      const { fiscalYear, targets } = req.body;

      if (!Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ success: false, message: '`targets` must be a non-empty array.' });
      }

      const result = await SummaryHeadService.saveYearly(managerCode, fiscalYear, targets);
      return res.json(result);

    } catch (err) {
      console.error('[SummaryHead] saveYearly error:', err);
      next(err);
    }
  },

  /* ── Stage 3 — Save product monthly targets ──────────────────────────── */

  async saveProducts(req, res, next) {
    try {
      const { fiscalYear, rows } = req.body;

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: '`rows` must be a non-empty array.' });
      }

      const result = await SummaryHeadService.saveProducts(fiscalYear, rows);
      return res.json(result);

    } catch (err) {
      console.error('[SummaryHead] saveProducts error:', err);
      next(err);
    }
  },
};

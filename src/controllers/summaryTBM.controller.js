'use strict';
/**
 * src/controllers/summaryTBM.controller.js
 * Thin controller — reads req.user / req.body, delegates to SummaryTBMService.
 */

const SummaryTBMService = require('../services/summaryTBM.service');

module.exports = {

  /* GET /tbm/summary-data */
  async getSummaryData(req, res, next) {
    try {
      const managerCode = req.user.employeeCode || req.user.employee_code;

      if (!managerCode) {
        return res.status(400).json({
          success : false,
          message : 'Employee code not found in JWT — cannot resolve team.',
        });
      }

      const data = await SummaryTBMService.getSummaryData(managerCode);

      return res.json({
        success     : true,
        managerCode,
        count       : data.length,
        reps        : data,
      });

    } catch (err) {
      console.error('[SummaryTBM] getSummaryData error:', err);
      next(err);
    }
  },

  /* POST /tbm/summary-data/save-yearly */
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

      const result = await SummaryTBMService.saveYearly(managerCode, fiscalYear, targets);
      return res.json(result);

    } catch (err) {
      console.error('[SummaryTBM] saveYearly error:', err);
      next(err);
    }
  },

  /* POST /tbm/summary-data/save-products */
  async saveProducts(req, res, next) {
    try {
      const { fiscalYear, rows } = req.body;

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: '`rows` must be a non-empty array.' });
      }

      const result = await SummaryTBMService.saveProducts(fiscalYear, rows);
      return res.json(result);

    } catch (err) {
      console.error('[SummaryTBM] saveProducts error:', err);
      next(err);
    }
  },
};

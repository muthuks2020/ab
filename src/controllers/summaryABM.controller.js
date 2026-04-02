'use strict';
/**
 * src/controllers/summaryABM.controller.js
 * Thin controller — reads req.user / req.body, delegates to SummaryABMService.
 */

const SummaryABMService = require('../services/summaryABM.service');

module.exports = {

  /* GET /abm/summary-data */
  async getSummaryData(req, res, next) {
    try {
      const managerCode = req.user.employeeCode || req.user.employee_code;

      if (!managerCode) {
        return res.status(400).json({
          success : false,
          message : 'Employee code not found in JWT — cannot resolve team.',
        });
      }

      const data = await SummaryABMService.getSummaryData(managerCode);

      return res.json({
        success     : true,
        managerCode,
        count       : data.length,
        tbms        : data,
      });

    } catch (err) {
      console.error('[SummaryABM] getSummaryData error:', err);
      next(err);
    }
  },

  /* POST /abm/summary-data/save-yearly */
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

      const result = await SummaryABMService.saveYearly(managerCode, fiscalYear, targets);
      return res.json(result);

    } catch (err) {
      console.error('[SummaryABM] saveYearly error:', err);
      next(err);
    }
  },

  /* POST /abm/summary-data/save-products */
  async saveProducts(req, res, next) {
    try {
      const { fiscalYear, rows } = req.body;

      if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ success: false, message: '`rows` must be a non-empty array.' });
      }

      const result = await SummaryABMService.saveProducts(fiscalYear, rows);
      return res.json(result);

    } catch (err) {
      console.error('[SummaryABM] saveProducts error:', err);
      next(err);
    }
  },
};

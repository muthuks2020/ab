'use strict';
/**
 * summaryZBM.controller.js
 * Thin controller — delegates all DB work to summaryZBM.service.js.
 *
 *   GET  /summary/zbm                    → getSummaryForZBM
 *   POST /summary/zbm/save-yearly        → saveYearly
 *   GET  /summary/zbm/product-visibility → getProductVisibility
 */

const SummaryZBMService = require('../services/summaryZBM.service');

module.exports = {

  /* alias — zbm.routes.js calls getSummaryData; delegate to getSummaryForZBM */
  async getSummaryData(req, res, next) {
    return module.exports.getSummaryForZBM(req, res, next);
  },

  async getSummaryForZBM(req, res, next) {
    try {
      const zbmCode = req.user.employeeCode || req.user.employee_code;
      if (!zbmCode)
        return res.status(400).json({ success: false, message: 'Employee code not found in JWT.' });

      const data = await SummaryZBMService.getSummaryData(zbmCode);
      return res.json({ success: true, zbmCode, count: data.length, abms: data });
    } catch (err) {
      console.error('[SummaryZBM] getSummaryForZBM error:', err);
      next(err);
    }
  },

  async saveYearly(req, res, next) {
    try {
      const zbmCode = req.user.employeeCode || req.user.employee_code;
      if (!zbmCode)
        return res.status(400).json({ success: false, message: 'Employee code not found in JWT.' });

      const { fiscalYear, targets } = req.body;
      if (!Array.isArray(targets) || targets.length === 0)
        return res.status(400).json({ success: false, message: '`targets` must be a non-empty array.' });

      const result = await SummaryZBMService.saveYearly(zbmCode, fiscalYear, targets);
      return res.json(result);
    } catch (err) {
      console.error('[SummaryZBM] saveYearly error:', err);
      next(err);
    }
  },

  async saveProducts(req, res, next) {
    try {
      const { fiscalYear, rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0)
        return res.status(400).json({ success: false, message: '`rows` must be a non-empty array.' });
      const result = await SummaryZBMService.saveProducts(fiscalYear, rows);
      return res.json(result);
    } catch (err) {
      console.error('[SummaryZBM] saveProducts error:', err);
      next(err);
    }
  },

  async getProductVisibility(req, res, next) {
    try {
      const zbmCode = req.user.employeeCode || req.user.employee_code;
      if (!zbmCode)
        return res.status(400).json({ success: false, message: 'Employee code not found in JWT.' });

      const level = req.query.level || 'rep';  // abm | tbm | rep | spec
      const data  = await SummaryZBMService.getProductVisibility(zbmCode, level);
      return res.json({ success: true, level, count: data.length, data });
    } catch (err) {
      console.error('[SummaryZBM] getProductVisibility error:', err);
      next(err);
    }
  },
};

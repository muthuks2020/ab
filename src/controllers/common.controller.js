/**
 * common.controller.js — NO CHANGES from v4 (thin controller)
 */
const CommonService = require('../services/common.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const CommonController = {
  async getCategories(req, res, next) {
    try { res.json(await CommonService.getCategories(req.user.role)); }
    catch (err) { next(err); }
  },
  async getProducts(req, res, next) {
    try { res.json(await CommonService.getProducts(req.query.category)); }
    catch (err) { next(err); }
  },
  async getProductPricing(req, res, next) {
    try { res.json(await CommonService.getProductPricing(req.query.category)); }
    catch (err) { next(err); }
  },
  async getFiscalYears(req, res, next) {
    try { res.json(await CommonService.getFiscalYears()); }
    catch (err) { next(err); }
  },
  async getAopTargets(req, res, next) {
    try {
      const { userId, fy } = req.query;
      res.json(await CommonService.getAopTargets(userId || req.user.employeeCode, fy));
    } catch (err) { next(err); }
  },
  async getOrgHierarchy(req, res, next) {
    try { res.json(await CommonService.getOrgHierarchy()); }
    catch (err) { next(err); }
  },
};
module.exports = CommonController;

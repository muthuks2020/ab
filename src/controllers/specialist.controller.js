'use strict';
const specialistService = require('../services/specialist.service');
const { errorResponse } = require('../utils/helpers');

const SpecialistController = {
  async getProducts(req, res, next) {
    try { res.json(await specialistService.getProducts(req.user.employeeCode, req.query.fy)); }
    catch (err) { next(err); }
  },
  async saveProduct(req, res, next) {
    try { res.json(await specialistService.saveProduct(parseInt(req.params.id), req.body.monthlyTargets, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async submitProduct(req, res, next) {
    try { res.json(await specialistService.submitProduct(parseInt(req.params.id), req.user, req.body.comments)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async submitMultiple(req, res, next) {
    try { res.json(await specialistService.submitMultiple(req.body.productIds, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async saveAll(req, res, next) {
    try { res.json(await specialistService.saveAll(req.body.products, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getDashboardSummary(req, res, next) {
    try { res.json(await specialistService.getDashboardSummary(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async getQuarterlySummary(req, res, next) {
    try { res.json(await specialistService.getQuarterlySummary(req.user.employeeCode, req.query.fy)); }
    catch (err) { next(err); }
  },
  async getCategoryPerformance(req, res, next) {
    try { res.json(await specialistService.getCategoryPerformance(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
};
module.exports = SpecialistController;

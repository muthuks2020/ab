/**
 * salesrep.controller.js — NO CHANGES from v4 (thin controller)
 */
const CommitmentService = require('../services/commitment.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const SalesRepController = {
  async getProducts(req, res, next) {
    try { res.json(await CommitmentService.getProducts(req.user.employeeCode, req.query.fy)); }
    catch (err) { next(err); }
  },
  async updateMonthlyTarget(req, res, next) {
    try { res.json(await CommitmentService.updateMonthlyTarget(parseInt(req.params.id), req.params.month, req.body, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async saveProduct(req, res, next) {
    try {
      const result = await CommitmentService.saveProduct(parseInt(req.params.id), req.body.monthlyTargets, req.user);
      req.logAudit({ action: 'save_product', entityType: 'ts_product_commitments', entityId: parseInt(req.params.id) });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async submitProduct(req, res, next) {
    try {
      const result = await CommitmentService.submitProduct(parseInt(req.params.id), req.user, req.body.comments);
      req.logAudit({ action: 'submit_product', entityType: 'ts_product_commitments', entityId: parseInt(req.params.id) });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async submitMultiple(req, res, next) {
    try {
      const result = await CommitmentService.submitMultiple(req.body.productIds, req.user);
      req.logAudit({ action: 'submit_multiple', entityType: 'ts_product_commitments', detail: { productIds: req.body.productIds } });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async saveAll(req, res, next) {
    try { res.json(await CommitmentService.saveAll(req.body.products, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getDashboardSummary(req, res, next) {
    try { res.json(await CommitmentService.getDashboardSummary(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async getQuarterlySummary(req, res, next) {
    try { res.json(await CommitmentService.getQuarterlySummary(req.user.employeeCode, req.query.fy)); }
    catch (err) { next(err); }
  },
  async getCategoryPerformance(req, res, next) {
    try { res.json(await CommitmentService.getCategoryPerformance(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async approveProduct(req, res, next) {
    try { res.json(await CommitmentService.approveProduct(parseInt(req.params.id), req.user, req.body.comments || '')); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async rejectProduct(req, res, next) {
    try { res.json(await CommitmentService.rejectProduct(parseInt(req.params.id), req.user, req.body.reason || '')); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
};
module.exports = SalesRepController;

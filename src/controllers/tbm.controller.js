/**
 * tbm.controller.js — NO logic changes (thin controller)
 * @version 2.0.0 - Updated audit entity types to ts_ prefix
 */
const TBMService = require('../services/tbm.service');
const { successResponse, errorResponse } = require('../utils/helpers');

const TBMController = {
  async getSalesRepSubmissions(req, res, next) {
    try { res.json(await TBMService.getSalesRepSubmissions(req.user.employeeCode, req.query)); }
    catch (err) { next(err); }
  },
  async approveSalesRepTarget(req, res, next) {
    try {
      const result = await TBMService.approveSalesRepTarget(parseInt(req.params.id), req.user, req.body);
      req.logAudit({ action: 'approve_sr_target', entityType: 'ts_product_commitments', entityId: parseInt(req.params.id), detail: { corrections: req.body.corrections } });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async bulkApproveSalesRep(req, res, next) {
    try {
      const result = await TBMService.bulkApproveSalesRep(req.body.submissionIds, req.user, req.body.comments);
      req.logAudit({ action: 'bulk_approve_sr', entityType: 'ts_product_commitments', detail: { submissionIds: req.body.submissionIds } });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async rejectSalesRepTarget(req, res, next) {
    try {
      const result = await TBMService.rejectSalesRepTarget(parseInt(req.params.id), req.user, req.body.reason || '');
      req.logAudit({ action: 'reject_sr_target', entityType: 'ts_product_commitments', entityId: parseInt(req.params.id) });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async bulkRejectSalesRep(req, res, next) {
    try { res.json(await TBMService.bulkRejectSalesRep(req.body.submissionIds, req.user, req.body.reason || '')); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getTerritoryTargets(req, res, next) {
    try { res.json(await TBMService.getTerritoryTargets(req.user.employeeCode, req.query)); }
    catch (err) { next(err); }
  },
  async saveTerritoryTargets(req, res, next) {
    try { res.json(await TBMService.saveTerritoryTargets(req.body.targets, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async submitTerritoryTargets(req, res, next) {
    try { res.json(await TBMService.submitTerritoryTargets(req.body.targetIds, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async updateTerritoryTarget(req, res, next) {
    try { res.json(await TBMService.updateSingleTarget(parseInt(req.params.id), req.user, req.body)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getIndividualTargets(req, res, next) {
    try { res.json(await TBMService.getIndividualTargets(req.user.employeeCode, req.query)); }
    catch (err) { next(err); }
  },
  async saveIndividualTargets(req, res, next) {
    try { res.json(await TBMService.saveIndividualTargets(req.body.targets, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async submitIndividualTargets(req, res, next) {
    try { res.json(await TBMService.submitIndividualTargets(req.body.targetIds, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async updateIndividualTarget(req, res, next) {
    try { res.json(await TBMService.updateSingleTarget(parseInt(req.params.id), req.user, req.body)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getDashboardStats(req, res, next) {
    try { res.json(await TBMService.getDashboardStats(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async getYearlyTargets(req, res, next) {
    try { res.json(await TBMService.getYearlyTargets(req.user.employeeCode, req.query.fy)); }
    catch (err) { next(err); }
  },
  async saveYearlyTargets(req, res, next) {
    try { res.json(await TBMService.saveYearlyTargets(req.user, req.body.fiscalYear, req.body.members)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async publishYearlyTargets(req, res, next) {
    try {
      const result = await TBMService.publishYearlyTargets(req.user, req.body.fiscalYear, req.body.memberIds);
      req.logAudit({ action: 'publish_yearly_targets', entityType: 'ts_yearly_target_assignments', detail: { memberIds: req.body.memberIds } });
      res.json(result);
    } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getTeamTargetsSummary(req, res, next) {
    try { res.json(await TBMService.getTeamTargetsSummary(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async getTeamTargetsForRep(req, res, next) {
    try { res.json(await TBMService.getTeamTargetsForRep(req.user, req.params.repId)); }
    catch (err) { next(err); }
  },
  async saveTeamTargetsForRep(req, res, next) {
    try { res.json(await TBMService.saveTeamTargetsForRep(req.user, req.params.repId, req.body.targets)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async assignTeamTargetsToRep(req, res, next) {
    try { res.json(await TBMService.assignTeamTargetsToRep(req.user, req.params.repId, req.body.targets)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async getTeamMembers(req, res, next) {
    try { res.json(await TBMService.getTeamMembers(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async getUniqueReps(req, res, next) {
    try { res.json(await TBMService.getUniqueReps(req.user.employeeCode)); }
    catch (err) { next(err); }
  },
  async saveSingleTerritoryTarget(req, res, next) {
    try { res.json(await TBMService.saveSingleTerritoryTarget(parseInt(req.params.id), req.body.monthlyTargets, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
  async saveSingleIndividualTarget(req, res, next) {
    try { res.json(await TBMService.saveSingleIndividualTarget(parseInt(req.params.id), req.body.monthlyTargets, req.user)); }
    catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); }
  },
};
module.exports = TBMController;

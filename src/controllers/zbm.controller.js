'use strict';
const ZBMService = require('../services/zbm.service');
const { errorResponse } = require('../utils/helpers');

module.exports = {
  async getAbmSubmissions(req, res, next) { try { res.json(await ZBMService.getAbmSubmissions(req.user.employeeCode, req.query)); } catch (err) { next(err); } },
  async approveAbm(req, res, next) { try { res.json(await ZBMService.approveAbm(parseInt(req.params.id), req.user, req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async rejectAbm(req, res, next) { try { res.json(await ZBMService.rejectAbm(parseInt(req.params.id), req.user, req.body.reason || '')); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async bulkApproveAbm(req, res, next) { try { res.json(await ZBMService.bulkApproveAbm(req.body.submissionIds, req.user, req.body.comments)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getZoneTargets(req, res, next) { try { res.json(await ZBMService.getZoneTargets(req.user, req.query.fy)); } catch (err) { next(err); } },
  async getAbmHierarchy(req, res, next) { try { res.json(await ZBMService.getAbmHierarchy(req.user.employeeCode)); } catch (err) { next(err); } },
  async getTeamMembers(req, res, next) { try { res.json(await ZBMService.getTeamMembers(req.user.employeeCode)); } catch (err) { next(err); } },
  async getTeamYearlyTargets(req, res, next) { try { res.json(await ZBMService.getTeamYearlyTargets(req.user.employeeCode, req.query.fy)); } catch (err) { next(err); } },
  async saveTeamYearlyTargets(req, res, next) { try { res.json(await ZBMService.saveTeamYearlyTargets(req.body.targets, req.user, req.body.fiscalYear)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getDashboardStats(req, res, next) { try { res.json(await ZBMService.getDashboardStats(req.user.employeeCode)); } catch (err) { next(err); } },
  async getUniqueAbms(req, res, next) { try { res.json(await ZBMService.getUniqueAbms(req.user.employeeCode)); } catch (err) { next(err); } },
};

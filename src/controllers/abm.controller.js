'use strict';
const ABMService = require('../services/abm.service');
const { errorResponse } = require('../utils/helpers');

module.exports = {
  async getTbmSubmissions(req, res, next) { try { res.json(await ABMService.getTbmSubmissions(req.user.employeeCode, req.query)); } catch (err) { next(err); } },
  async approveTbm(req, res, next) { try { res.json(await ABMService.approveTbm(parseInt(req.params.id), req.user, req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async rejectTbm(req, res, next) { try { res.json(await ABMService.rejectTbm(parseInt(req.params.id), req.user, req.body.reason || '')); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async bulkApproveTbm(req, res, next) { try { res.json(await ABMService.bulkApproveTbm(req.body.submissionIds, req.user, req.body.comments)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getAreaTargets(req, res, next) { try { res.json(await ABMService.getAreaTargets(req.user, req.query.fy)); } catch (err) { next(err); } },
  async saveAreaTarget(req, res, next) { try { res.json(await ABMService.saveAreaTarget(parseInt(req.params.id), req.body.monthlyTargets, req.user)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async saveAreaTargetsBulk(req, res, next) { try { res.json(await ABMService.saveAreaTargetsBulk(req.body.targets, req.user)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async submitAreaTargets(req, res, next) { try { res.json(await ABMService.submitAreaTargets(req.body.targetIds, req.user)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getTeamMembers(req, res, next) { try { res.json(await ABMService.getTeamMembers(req.user.employeeCode)); } catch (err) { next(err); } },
  async getTbmHierarchy(req, res, next) { try { res.json(await ABMService.getTbmHierarchy(req.user.employeeCode)); } catch (err) { next(err); } },
  async getTeamYearlyTargets(req, res, next) { try { res.json(await ABMService.getTeamYearlyTargets(req.user.employeeCode, req.query.fy)); } catch (err) { next(err); } },
  async saveTeamYearlyTargets(req, res, next) { try { res.json(await ABMService.saveTeamYearlyTargets(req.body.targets, req.user, req.body.fiscalYear)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getUniqueTbms(req, res, next) { try { res.json(await ABMService.getUniqueTbms(req.user.employeeCode)); } catch (err) { next(err); } },
  async getDashboardStats(req, res, next) { try { res.json(await ABMService.getDashboardStats(req.user.employeeCode)); } catch (err) { next(err); } },
};

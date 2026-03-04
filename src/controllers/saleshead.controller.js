'use strict';
const SalesHeadService = require('../services/saleshead.service');
const { errorResponse } = require('../utils/helpers');

module.exports = {
  async getZbmSubmissions(req, res, next) { try { res.json(await SalesHeadService.getZbmSubmissions(req.query)); } catch (err) { next(err); } },
  async approveZbm(req, res, next) { try { res.json(await SalesHeadService.approveZbm(parseInt(req.params.id), req.user, req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async rejectZbm(req, res, next) { try { res.json(await SalesHeadService.rejectZbm(parseInt(req.params.id), req.user, req.body.reason || '')); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async bulkApproveZbm(req, res, next) { try { res.json(await SalesHeadService.bulkApproveZbm(req.body.submissionIds, req.user, req.body.comments)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getZbmHierarchy(req, res, next) { try { res.json(await SalesHeadService.getZbmHierarchy(req.user.employeeCode)); } catch (err) { next(err); } },
  async getTeamMembers(req, res, next) { try { res.json(await SalesHeadService.getTeamMembers(req.user.employeeCode)); } catch (err) { next(err); } },
  async getTeamYearlyTargets(req, res, next) { try { res.json(await SalesHeadService.getTeamYearlyTargets(req.user.employeeCode, req.query.fy)); } catch (err) { next(err); } },
  async saveTeamYearlyTargets(req, res, next) { try { res.json(await SalesHeadService.saveTeamYearlyTargets(req.body.targets, req.user, req.body.fiscalYear)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getUniqueZbms(req, res, next) { try { res.json(await SalesHeadService.getUniqueZbms(req.user.employeeCode)); } catch (err) { next(err); } },
  async getDashboardStats(req, res, next) { try { res.json(await SalesHeadService.getDashboardStats(req.user.employeeCode)); } catch (err) { next(err); } },
  async getRegionalPerformance(req, res, next) { try { res.json(await SalesHeadService.getRegionalPerformance()); } catch (err) { next(err); } },
  async getMonthlyTrend(req, res, next) { try { res.json(await SalesHeadService.getMonthlyTrend(req.query.fy)); } catch (err) { next(err); } },
  async setGeographyTargets(req, res, next) { try { res.json(await SalesHeadService.setGeographyTargets(req.user, req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getCategories(req, res, next) { try { res.json(await SalesHeadService.getCategories(req.user.role)); } catch (err) { next(err); } },
  async getAnalyticsDistribution(req, res, next) { try { res.json(await SalesHeadService.getAnalyticsDistribution(req.query)); } catch (err) { next(err); } },
  async getAnalyticsComparison(req, res, next) { try { res.json(await SalesHeadService.getAnalyticsComparison(req.query)); } catch (err) { next(err); } },
  async getAnalyticsAchievement(req, res, next) { try { res.json(await SalesHeadService.getAnalyticsAchievement(req.query)); } catch (err) { next(err); } },
};

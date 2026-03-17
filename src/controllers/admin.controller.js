'use strict';
const AdminService = require('../services/admin.service');
const GeographyService = require('../services/geography.service');
const { errorResponse } = require('../utils/helpers');

module.exports = {

  async getUsers(req, res, next) { try { res.json(await AdminService.getUsers(req.query)); } catch (err) { next(err); } },
  async createUser(req, res, next) { try { res.json(await AdminService.createUser(req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async updateUser(req, res, next) { try { res.json(await AdminService.updateUser(parseInt(req.params.id), req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async deleteUser(req, res, next) { try { res.json(await AdminService.deleteUser(parseInt(req.params.id))); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async toggleUserStatus(req, res, next) { try { res.json(await AdminService.toggleUserStatus(parseInt(req.params.id))); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },

  // ← Phase 2 addition: admin resets a user's password to their employee code
  async resetPassword(req, res, next) { try { res.json(await AdminService.resetPassword(parseInt(req.params.id))); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },

  async transferEmployee(req, res, next) { try { res.json(await AdminService.transferEmployee(req.body.employeeCode, req.body.newGeo || req.body, req.user.employeeCode, req.body.reason)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },
  async getTransferHistory(req, res, next) { try { res.json(await AdminService.getTransferHistory(req.query.employeeCode)); } catch (err) { next(err); } },

  async getProducts(req, res, next) { try { res.json(await AdminService.getProducts(req.query)); } catch (err) { next(err); } },
  async createProduct(req, res, next) { try { res.status(501).json({ success: false, message: 'Products are managed via Salesforce. Local creation not supported.' }); } catch (err) { next(err); } },
  async updateProduct(req, res, next) { try { res.status(501).json({ success: false, message: 'Products are managed via Salesforce. Local update not supported.' }); } catch (err) { next(err); } },
  async deleteProduct(req, res, next) { try { res.status(501).json({ success: false, message: 'Products are managed via Salesforce. Local deletion not supported.' }); } catch (err) { next(err); } },
  async toggleProductStatus(req, res, next) { try { res.json(await AdminService.toggleProductStatus(req.params.id)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },

  async getCategories(req, res, next) { try { res.json(await AdminService.getCategories()); } catch (err) { next(err); } },

  async getHierarchy(req, res, next) { try { res.json(await AdminService.getHierarchy()); } catch (err) { next(err); } },

  async getVacantPositions(req, res, next) { try { res.json(await AdminService.getVacantPositions()); } catch (err) { next(err); } },
  async fillVacantPosition(req, res, next) { try { res.json(await AdminService.fillVacantPosition(parseInt(req.params.id), req.body)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },

  async getFiscalYears(req, res, next) { try { res.json(await AdminService.getFiscalYears()); } catch (err) { next(err); } },
  async activateFiscalYear(req, res, next) { try { res.json(await AdminService.activateFiscalYear(req.params.fyCode)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },

  async getGeographyTargets(req, res, next) { try { res.json(await GeographyService.getGeographyTargets(req.query.geoLevel, req.query.geoCode, req.query.fy)); } catch (err) { next(err); } },
  async setGeographyTargets(req, res, next) { try { res.json(await GeographyService.setGeographyTargets(req.body.geoLevel, req.body.geoCode, req.body.geoName, req.body.fiscalYear, req.body.targets, req.user.employeeCode)); } catch (err) { if (err.status) return res.status(err.status).json(errorResponse(err.message)); next(err); } },

  async getDashboardStats(req, res, next) { try { res.json(await AdminService.getDashboardStats()); } catch (err) { next(err); } },
};

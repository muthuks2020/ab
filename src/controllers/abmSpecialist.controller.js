'use strict';
const abmSpecialistService = require('../services/abmSpecialist.service');

const getSpecialistSubmissions = async (req, res, next) => { try { res.json(await abmSpecialistService.getSpecialistSubmissions(req.user.employeeCode, req.query.fy || null)); } catch (err) { next(err); } };
const approveSpecialist = async (req, res, next) => { try { res.json(await abmSpecialistService.approveSpecialist(parseInt(req.params.id, 10), req.user, req.body.corrections || null, req.body.comments || null)); } catch (err) { next(err); } };
const bulkApproveSpecialist = async (req, res, next) => { try { res.json(await abmSpecialistService.bulkApproveSpecialist(req.body.submissionIds, req.user)); } catch (err) { next(err); } };
const getSpecialists = async (req, res, next) => { try { res.json(await abmSpecialistService.getSpecialists(req.user.employeeCode)); } catch (err) { next(err); } };
const getSpecialistYearlyTargets = async (req, res, next) => { try { res.json(await abmSpecialistService.getSpecialistYearlyTargets(req.user.employeeCode, req.query.fy || null)); } catch (err) { next(err); } };
const saveSpecialistYearlyTargets = async (req, res, next) => { try { res.json(await abmSpecialistService.saveSpecialistYearlyTargets(req.body.targets, req.user, req.body.fiscalYear || null)); } catch (err) { next(err); } };
const publishSpecialistYearlyTargets = async (req, res, next) => { try { res.json(await abmSpecialistService.publishSpecialistYearlyTargets(req.body.targets, req.user, req.body.fiscalYear || null)); } catch (err) { next(err); } };
const getSpecialistDashboardStats = async (req, res, next) => { try { res.json(await abmSpecialistService.getSpecialistDashboardStats(req.user.employeeCode, req.query.fy || null)); } catch (err) { next(err); } };
const rejectSpecialist = async (req, res, next) => { try { res.json(await abmSpecialistService.rejectSpecialist(parseInt(req.params.id, 10), req.user, req.body.reason || '')); } catch (err) { if (err.status) return res.status(err.status).json({ success: false, message: err.message }); next(err); } };
const getUniqueSpecialists = async (req, res, next) => { try { res.json(await abmSpecialistService.getUniqueSpecialists(req.user.employeeCode)); } catch (err) { next(err); } };

module.exports = { getSpecialistSubmissions, approveSpecialist, rejectSpecialist, bulkApproveSpecialist, getSpecialists, getUniqueSpecialists, getSpecialistYearlyTargets, saveSpecialistYearlyTargets, publishSpecialistYearlyTargets, getSpecialistDashboardStats };

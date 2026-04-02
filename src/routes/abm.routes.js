'use strict';
const express = require('express');
const router = express.Router();
const ABMController = require('../controllers/abm.controller');
const SummaryABMController = require('../controllers/summaryABM.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateBody } = require('../middleware/validate');
const { approveSchema, bulkApproveSchema } = require('../validators/schemas');
router.use(authenticate);
router.use(authorize('abm'));

router.get('/tbm-submissions', ABMController.getTbmSubmissions);
router.put('/approve-tbm/:id', validateBody(approveSchema), ABMController.approveTbm);
router.put('/reject-tbm/:id', ABMController.rejectTbm);
router.put('/save-correction/:id', ABMController.saveCorrection);
router.post('/bulk-approve-tbm', validateBody(bulkApproveSchema), ABMController.bulkApproveTbm);

router.get('/area-targets', ABMController.getAreaTargets);
router.put('/area-targets/:id/save', ABMController.saveAreaTarget);
router.post('/area-targets/save', ABMController.saveAreaTargetsBulk);
router.post('/area-targets/submit', ABMController.submitAreaTargets);

router.get('/team-members', ABMController.getTeamMembers);
router.get('/tbm-hierarchy', ABMController.getTbmHierarchy);
router.get('/team-yearly-targets', ABMController.getTeamYearlyTargets);
router.post('/team-yearly-targets/save', ABMController.saveTeamYearlyTargets);
router.post('/team-yearly-targets/publish', ABMController.publishTeamYearlyTargets);
router.get('/unique-tbms', ABMController.getUniqueTbms);

router.get('/specialist-yearly-targets', ABMController.getSpecialistYearlyTargets);
router.post('/specialist-yearly-targets/save', ABMController.saveSpecialistYearlyTargets);
router.post('/specialist-yearly-targets/publish', ABMController.publishSpecialistYearlyTargets);

router.get('/dashboard-stats', ABMController.getDashboardStats);

router.get('/summary-data',                  SummaryABMController.getSummaryData);
router.post('/summary-data/save-yearly',     SummaryABMController.saveYearly);
router.post('/summary-data/save-products',   SummaryABMController.saveProducts);

module.exports = router;

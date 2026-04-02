'use strict';
const express = require('express');
const router = express.Router();
const ZBMController = require('../controllers/zbm.controller');
const SummaryZBMController = require('../controllers/summaryZBM.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateBody } = require('../middleware/validate');
const { approveSchema, bulkApproveSchema } = require('../validators/schemas');
router.use(authenticate);
router.use(authorize('zbm'));

router.get('/abm-submissions', ZBMController.getAbmSubmissions);
router.put('/approve-abm/:id', validateBody(approveSchema), ZBMController.approveAbm);
router.put('/reject-abm/:id', ZBMController.rejectAbm);
router.post('/bulk-approve-abm', validateBody(bulkApproveSchema), ZBMController.bulkApproveAbm);

router.get('/zone-targets', ZBMController.getZoneTargets);

router.get('/team-members', ZBMController.getTeamMembers);
router.get('/abm-hierarchy', ZBMController.getAbmHierarchy);
router.get('/team-yearly-targets', ZBMController.getTeamYearlyTargets);
router.post('/team-yearly-targets/save', ZBMController.saveTeamYearlyTargets);
router.post('/team-yearly-targets/publish', ZBMController.publishTeamYearlyTargets);
router.get('/unique-abms', ZBMController.getUniqueAbms);

router.get('/sh-assigned-target', ZBMController.getSHAssignedTarget);
router.get('/dashboard-stats', ZBMController.getDashboardStats);

router.get('/summary-data',                 SummaryZBMController.getSummaryData);
router.post('/summary-data/save-yearly',    SummaryZBMController.saveYearly);
router.post('/summary-data/save-products',  SummaryZBMController.saveProducts);
router.get('/product-visibility',           SummaryZBMController.getProductVisibility);

module.exports = router;

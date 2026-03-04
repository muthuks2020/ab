'use strict';
const express = require('express');
const router = express.Router();
const ZBMController = require('../controllers/zbm.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateBody } = require('../middleware/validate');
const { approveSchema, bulkApproveSchema } = require('../validators/schemas');
router.use(authenticate);
router.use(authorize('zbm'));
// Submissions
router.get('/abm-submissions', ZBMController.getAbmSubmissions);
router.put('/approve-abm/:id', validateBody(approveSchema), ZBMController.approveAbm);
router.put('/reject-abm/:id', ZBMController.rejectAbm);
router.post('/bulk-approve-abm', validateBody(bulkApproveSchema), ZBMController.bulkApproveAbm);
// Zone Targets
router.get('/zone-targets', ZBMController.getZoneTargets);
// Team
router.get('/team-members', ZBMController.getTeamMembers);
router.get('/abm-hierarchy', ZBMController.getAbmHierarchy);
router.get('/team-yearly-targets', ZBMController.getTeamYearlyTargets);
router.post('/team-yearly-targets/save', ZBMController.saveTeamYearlyTargets);
router.get('/unique-abms', ZBMController.getUniqueAbms);
// Dashboard
router.get('/dashboard-stats', ZBMController.getDashboardStats);
module.exports = router;

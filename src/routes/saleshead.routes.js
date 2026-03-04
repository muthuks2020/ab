'use strict';
const express = require('express');
const router = express.Router();
const SalesHeadController = require('../controllers/saleshead.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateBody } = require('../middleware/validate');
const { approveSchema, bulkApproveSchema, geographyTargetSchema } = require('../validators/schemas');
router.use(authenticate);
router.use(authorize('sales_head'));
// Submissions
router.get('/zbm-submissions', SalesHeadController.getZbmSubmissions);
router.put('/approve-zbm/:id', validateBody(approveSchema), SalesHeadController.approveZbm);
router.post('/reject-zbm/:id', SalesHeadController.rejectZbm);
router.post('/bulk-approve-zbm', validateBody(bulkApproveSchema), SalesHeadController.bulkApproveZbm);
// Team
router.get('/team-members', SalesHeadController.getTeamMembers);
router.get('/zbm-hierarchy', SalesHeadController.getZbmHierarchy);
router.get('/team-yearly-targets', SalesHeadController.getTeamYearlyTargets);
router.post('/team-yearly-targets/save', SalesHeadController.saveTeamYearlyTargets);
router.get('/unique-zbms', SalesHeadController.getUniqueZbms);
// Categories
router.get('/categories', SalesHeadController.getCategories);
// Dashboard & Reports
router.get('/dashboard-stats', SalesHeadController.getDashboardStats);
router.get('/regional-performance', SalesHeadController.getRegionalPerformance);
router.get('/monthly-trend', SalesHeadController.getMonthlyTrend);
// Geography Targets
router.post('/geography-targets', validateBody(geographyTargetSchema), SalesHeadController.setGeographyTargets);
// Analytics
router.get('/analytics/distribution', SalesHeadController.getAnalyticsDistribution);
router.get('/analytics/comparison', SalesHeadController.getAnalyticsComparison);
router.get('/analytics/achievement', SalesHeadController.getAnalyticsAchievement);
module.exports = router;

'use strict';
const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/admin.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');
const { validateBody } = require('../middleware/validate');
const { geographyTargetSchema, transferEmployeeSchema } = require('../validators/schemas');
router.use(authenticate);
router.use(authorize('admin'));

router.get('/users', AdminController.getUsers);
router.post('/users', AdminController.createUser);
router.put('/users/:id', AdminController.updateUser);
router.delete('/users/:id', AdminController.deleteUser);
router.put('/users/:id/toggle-status', AdminController.toggleUserStatus);
router.put('/users/:id/reset-password', AdminController.resetPassword);  // ← Phase 2 addition

router.get('/products', AdminController.getProducts);
router.post('/products', AdminController.createProduct);
router.put('/products/:id', AdminController.updateProduct);
router.delete('/products/:id', AdminController.deleteProduct);
router.put('/products/:id/toggle-status', AdminController.toggleProductStatus);

router.get('/categories', AdminController.getCategories);

router.get('/hierarchy', AdminController.getHierarchy);

router.post('/transfer-employee', validateBody(transferEmployeeSchema), AdminController.transferEmployee);
router.post('/reassign-position', AdminController.transferEmployee);
router.get('/transfer-history', AdminController.getTransferHistory);

router.get('/vacant-positions', AdminController.getVacantPositions);
router.put('/vacant-positions/:id/fill', AdminController.fillVacantPosition);

router.get('/fiscal-years', AdminController.getFiscalYears);
router.put('/fiscal-years/:fyCode/activate', AdminController.activateFiscalYear);

router.get('/geography-targets', AdminController.getGeographyTargets);
router.post('/geography-targets', validateBody(geographyTargetSchema), AdminController.setGeographyTargets);

router.get('/dashboard-stats', AdminController.getDashboardStats);
router.get('/target-progress', AdminController.getTargetProgress);
module.exports = router;

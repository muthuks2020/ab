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
// Users
router.get('/users', AdminController.getUsers);
router.post('/users', AdminController.createUser);
router.put('/users/:id', AdminController.updateUser);
router.delete('/users/:id', AdminController.deleteUser);
router.put('/users/:id/toggle-status', AdminController.toggleUserStatus);
// Products (read-only from product_master, toggle local flag)
router.get('/products', AdminController.getProducts);
router.post('/products', AdminController.createProduct);
router.put('/products/:id', AdminController.updateProduct);
router.delete('/products/:id', AdminController.deleteProduct);
router.put('/products/:id/toggle-status', AdminController.toggleProductStatus);
// Categories
router.get('/categories', AdminController.getCategories);
// Org Hierarchy
router.get('/hierarchy', AdminController.getHierarchy);
// Transfers
router.post('/transfer-employee', validateBody(transferEmployeeSchema), AdminController.transferEmployee);
router.post('/reassign-position', AdminController.transferEmployee);
router.get('/transfer-history', AdminController.getTransferHistory);
// Vacant Positions
router.get('/vacant-positions', AdminController.getVacantPositions);
router.put('/vacant-positions/:id/fill', AdminController.fillVacantPosition);
// Fiscal Years
router.get('/fiscal-years', AdminController.getFiscalYears);
router.put('/fiscal-years/:fyCode/activate', AdminController.activateFiscalYear);
// Geography Targets
router.get('/geography-targets', AdminController.getGeographyTargets);
router.post('/geography-targets', validateBody(geographyTargetSchema), AdminController.setGeographyTargets);
// Dashboard
router.get('/dashboard-stats', AdminController.getDashboardStats);
module.exports = router;

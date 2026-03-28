'use strict';
/**
 * summaryHead.routes.js
 * Stage 3 — adds save-yearly and save-products POST endpoints
 *
 * Mounts under: /api/v1/summary  (registered in server.js)
 *
 *   GET  /head               → getSummaryForHead
 *   POST /head/save-yearly   → saveYearly
 *   POST /head/save-products → saveProducts
 *
 * All routes protected by authenticate + authorize('sales_head').
 */

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/summaryHead.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize }    = require('../middleware/authorize');

router.use(authenticate);
router.use(authorize('sales_head'));

// Stage 1 + 2
router.get('/head', controller.getSummaryForHead);

// Stage 3 — save endpoints
router.post('/head/save-yearly',   controller.saveYearly);
router.post('/head/save-products', controller.saveProducts);

module.exports = router;

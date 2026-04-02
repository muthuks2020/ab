'use strict';
/**
 * summaryZBM.routes.js
 *
 * Mount in server.js under /api/v1/zbm (alongside zbm.routes.js):
 *   const summaryZBMRouter = require('./routes/summaryZBM.routes');
 *   app.use('/api/v1/zbm', summaryZBMRouter);
 *
 * Resulting endpoints (all gated by authenticate + authorize('zbm')):
 *   GET  /zbm/summary-data               → getSummaryForZBM
 *   POST /zbm/summary-data/save-yearly   → saveYearly
 *   POST /zbm/summary-data/save-products → saveProducts
 *   GET  /zbm/product-visibility         → getProductVisibility
 */

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/summaryZBM.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize }    = require('../middleware/authorize');

router.use(authenticate);
router.use(authorize('zbm'));

router.get('/summary-data',                controller.getSummaryForZBM);
router.post('/summary-data/save-yearly',   controller.saveYearly);
router.post('/summary-data/save-products', controller.saveProducts);
router.get('/product-visibility',          controller.getProductVisibility);

module.exports = router;

'use strict';
/**
 * abmAreaTargets.routes.js
 *
 * Two new endpoints mounted at /api/v1/abm:
 *   GET  /area-targets-v2        → getAreaTargets
 *   POST /area-targets-v2/save   → saveAreaTargets
 *
 * Uses same authenticate + authorize('abm') middleware as existing abm.routes.js
 */

const express    = require('express');
const router     = express.Router();
const controller = require('../controllers/abmAreaTargets.controller');
const { authenticate } = require('../middleware/authenticate');
const { authorize }    = require('../middleware/authorize');

router.use(authenticate);
router.use(authorize('abm'));

router.get('/area-targets-v2',        controller.getAreaTargets);
router.post('/area-targets-v2/save',   controller.saveAreaTargets);
router.post('/area-targets-v2/submit', controller.submitAreaTargets);

module.exports = router;

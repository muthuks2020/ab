'use strict';
/**
 * abmAreaTargets.controller.js
 *
 * Controller for the two new ABM area-target endpoints.
 * Delegates to abmAreaTargets.service.js only.
 */

const ABMAreaTargetsService = require('../services/abmAreaTargets.service');

module.exports = {

  async getAreaTargets(req, res, next) {
    try {
      const data = await ABMAreaTargetsService.getAreaTargets(req.user);
      res.json(data);
    } catch (err) {
      next(err);
    }
  },

  async saveAreaTargets(req, res, next) {
    try {
      const targets = req.body.targets;
      if (!Array.isArray(targets)) {
        return res.status(400).json({ success: false, message: 'targets must be an array' });
      }
      const result = await ABMAreaTargetsService.saveAreaTargets(targets, req.user);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

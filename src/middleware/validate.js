'use strict';
/**
 * validate.js — Joi validation middleware
 * @version 2.0.0
 */
const { errorResponse } = require('../utils/helpers');

const validateBody = (schema) => (req, res, next) => {
  if (!schema) return next();
  const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const messages = error.details.map(d => d.message).join('; ');
    return res.status(400).json(errorResponse(`Validation failed: ${messages}`));
  }
  req.body = value;
  next();
};

const validateQuery = (schema) => (req, res, next) => {
  if (!schema) return next();
  const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true });
  if (error) {
    const messages = error.details.map(d => d.message).join('; ');
    return res.status(400).json(errorResponse(`Validation failed: ${messages}`));
  }
  req.query = value;
  next();
};

module.exports = { validateBody, validateQuery };

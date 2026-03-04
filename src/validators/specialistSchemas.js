'use strict';
/**
 * specialistSchemas.js — Joi schemas for specialist + ABM-specialist routes
 * @version 2.0.0 — productCode instead of productId
 */
const Joi = require('joi');

const monthlyTargetsSchema = Joi.object().pattern(
  Joi.string().pattern(/^(apr|may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar)$/),
  Joi.number().min(0)
);

const saveSpecialistProductSchema = Joi.object({
  monthlyTargets: monthlyTargetsSchema.required(),
});

const submitSpecialistMultipleSchema = Joi.object({
  productIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
  comments: Joi.string().allow(null, '').optional(),
});

const saveAllSpecialistProductsSchema = Joi.object({
  products: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().positive().required(),
      monthlyTargets: monthlyTargetsSchema.required(),
    })
  ).min(1).required(),
});

const approveSpecialistSchema = Joi.object({
  corrections: Joi.object().pattern(
    Joi.string(),
    Joi.number().min(0)
  ).allow(null).optional(),
  comments: Joi.string().allow(null, '').optional(),
});

const bulkApproveSpecialistSchema = Joi.object({
  submissionIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
  comments: Joi.string().allow(null, '').optional(),
});

const saveSpecialistYearlyTargetsSchema = Joi.object({
  targets: Joi.array().items(
    Joi.object({
      employeeCode: Joi.string().required(),
      productCode: Joi.string().required(),
      yearlyTarget: Joi.number().min(0).required(),
    })
  ).min(1).required(),
  fiscalYear: Joi.string().allow(null, '').optional(),
});

module.exports = {
  saveSpecialistProductSchema,
  submitSpecialistMultipleSchema,
  saveAllSpecialistProductsSchema,
  approveSpecialistSchema,
  bulkApproveSpecialistSchema,
  saveSpecialistYearlyTargetsSchema,
};

const Joi = require('joi');

const MONTHS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];

const monthDataSchema = Joi.object({
  lyQty: Joi.number().default(0),
  cyQty: Joi.number().default(0),
  lyRev: Joi.number().default(0),
  cyRev: Joi.number().default(0),
  aopQty: Joi.number().optional(),
  aopRev: Joi.number().optional(),
});

const monthlyTargetsSchema = Joi.object(
  MONTHS.reduce((acc, m) => { acc[m] = monthDataSchema.optional(); return acc; }, {})
).required();

const loginSchema = Joi.object({
  username: Joi.string().required().trim(),
  password: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

const saveProductSchema = Joi.object({
  monthlyTargets: monthlyTargetsSchema,
  productCode: Joi.string().allow(null, '').optional(),
  territoryCode: Joi.string().allow(null, '').optional(),
});

const submitProductSchema = Joi.object({
  comments: Joi.string().allow(null, '').optional(),
});

const submitMultipleSchema = Joi.object({
  productIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

const saveAllProductsSchema = Joi.object({
  products: Joi.array().items(
    Joi.object({
      id: Joi.number().integer().positive().required(),
      monthlyTargets: monthlyTargetsSchema,
    })
  ).min(1).required(),
});

const approveSchema = Joi.object({
  comments: Joi.string().allow(null, '').optional(),
  corrections: Joi.object().allow(null).optional(),
});

const bulkApproveSchema = Joi.object({
  submissionIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
  comments: Joi.string().allow(null, '').optional(),
});

const saveTerritoryTargetsSchema = Joi.object({
  targets: Joi.array().items(
    Joi.object({
      id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string()).required(),
      monthlyTargets: monthlyTargetsSchema,
    })
  ).min(1).required(),
});

const submitTerritoryTargetsSchema = Joi.object({
  targetIds: Joi.array().items(Joi.number().integer().positive()).min(1).required(),
});

const saveYearlyTargetsSchema = Joi.object({
  fiscalYear: Joi.string().required(),
  members: Joi.array().items(
    Joi.object({
      id: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string()).required(),
      cyTarget: Joi.number().optional(),
      cyTargetValue: Joi.number().optional(),
      categoryBreakdown: Joi.array().items(
        Joi.object({
          id: Joi.string().required(),
          cyTarget: Joi.number().optional(),
          cyTargetValue: Joi.number().optional(),
        })
      ).optional(),
    })
  ).min(1).required(),
});

const publishYearlyTargetsSchema = Joi.object({
  fiscalYear: Joi.string().required(),
  memberIds: Joi.array().items(
    Joi.alternatives().try(Joi.number().integer().positive(), Joi.string())
  ).min(1).required(),
});

const fiscalYearQuery = Joi.object({
  fy: Joi.string().optional(),
});

const paginationQuery = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
  status: Joi.string().valid('not_started', 'draft', 'submitted', 'approved').optional(),
  categoryId: Joi.string().optional(),
  salesRepId: Joi.string().optional(),
});

const geographyTargetSchema = Joi.object({
  geoLevel: Joi.string().valid('zone', 'area', 'territory').required(),
  geoCode: Joi.string().required(),
  fiscalYear: Joi.string().required(),
  targets: Joi.array().items(
    Joi.object({
      productCode: Joi.string().required(),
      annualTarget: Joi.number().min(0).required(),
      monthlyTargets: monthlyTargetsSchema.optional(),
    })
  ).min(1).required(),
});

const transferEmployeeSchema = Joi.object({
  employeeCode: Joi.string().required(),
  newGeo: Joi.object({
    zoneCode: Joi.string().allow(null, ''),
    zoneName: Joi.string().allow(null, ''),
    areaCode: Joi.string().allow(null, ''),
    areaName: Joi.string().allow(null, ''),
    territoryCode: Joi.string().allow(null, ''),
    territoryName: Joi.string().allow(null, ''),
    reportsTo: Joi.string().allow(null, ''),
  }).required(),
  reason: Joi.string().allow('').optional(),
});

module.exports = {
  loginSchema,
  refreshTokenSchema,
  saveProductSchema,
  submitProductSchema,
  submitMultipleSchema,
  saveAllProductsSchema,
  approveSchema,
  bulkApproveSchema,
  saveTerritoryTargetsSchema,
  submitTerritoryTargetsSchema,
  saveYearlyTargetsSchema,
  publishYearlyTargetsSchema,
  fiscalYearQuery,
  paginationQuery,
  monthlyTargetsSchema,
  geographyTargetSchema,
  transferEmployeeSchema,
};

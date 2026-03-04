/**
 * geography.service.js — Geography Targets Service (NEW in v5)
 * Manages zone/area/territory level targets in ts_geography_targets.
 */

'use strict';

const { db } = require('../config/database');

const GeographyService = {

  /**
   * Get geography targets by level and code
   */
  async getGeographyTargets(geoLevel, geoCode, fiscalYear) {
    const rows = await db('ts_geography_targets AS gt')
      .join('product_master AS pm', 'pm.productcode', 'gt.product_code')
      .where('gt.geo_level', geoLevel)
      .modify((qb) => {
        if (geoLevel === 'zone') qb.where('gt.zone_code', geoCode);
        if (geoLevel === 'area') qb.where('gt.area_code', geoCode);
        if (geoLevel === 'territory') qb.where('gt.territory_code', geoCode);
      })
      .where('gt.fiscal_year_code', fiscalYear)
      .select('gt.*', 'pm.product_name', 'pm.product_category', 'pm.quota_price__c AS unit_cost');

    return rows.map((r) => ({
      id: r.id,
      geoLevel: r.geo_level,
      zoneCode: r.zone_code,
      zoneName: r.zone_name,
      areaCode: r.area_code,
      areaName: r.area_name,
      territoryCode: r.territory_code,
      territoryName: r.territory_name,
      productCode: r.product_code,
      productName: r.product_name,
      productCategory: r.product_category,
      unitCost: r.unit_cost ? parseFloat(r.unit_cost) : null,
      fiscalYearCode: r.fiscal_year_code,
      annualTarget: parseFloat(r.annual_target || 0),
      monthlyTargets: r.monthly_targets || {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  /**
   * Set/update geography targets
   */
  async setGeographyTargets(geoLevel, geoCode, geoName, fiscalYear, targets, actorCode) {
    const now = new Date();

    // Resolve geo fields based on level
    const geoFields = {};
    if (geoLevel === 'zone') {
      geoFields.zone_code = geoCode;
      geoFields.zone_name = geoName;
    } else if (geoLevel === 'area') {
      geoFields.area_code = geoCode;
      geoFields.area_name = geoName;
    } else if (geoLevel === 'territory') {
      geoFields.territory_code = geoCode;
      geoFields.territory_name = geoName;
    }

    let savedCount = 0;

    for (const t of targets) {
      const existing = await db('ts_geography_targets')
        .where({
          geo_level: geoLevel,
          fiscal_year_code: fiscalYear,
          product_code: t.productCode,
          ...geoFields,
        })
        .first();

      if (existing) {
        await db('ts_geography_targets').where({ id: existing.id }).update({
          annual_target: t.annualTarget || 0,
          monthly_targets: t.monthlyTargets ? JSON.stringify(t.monthlyTargets) : existing.monthly_targets,
          updated_at: now,
        });
      } else {
        await db('ts_geography_targets').insert({
          geo_level: geoLevel,
          fiscal_year_code: fiscalYear,
          product_code: t.productCode,
          annual_target: t.annualTarget || 0,
          monthly_targets: t.monthlyTargets ? JSON.stringify(t.monthlyTargets) : '{}',
          created_at: now,
          updated_at: now,
          ...geoFields,
        });
      }
      savedCount++;
    }

    await db('ts_audit_log').insert({
      actor_code: actorCode,
      action: 'geography_targets_set',
      entity_type: 'geography_targets',
      detail: JSON.stringify({ geoLevel, geoCode, fiscalYear, count: savedCount }),
      created_at: now,
    });

    return { success: true, savedCount };
  },

  /**
   * Get geography coverage from view
   */
  async getGeographyCoverage() {
    const rows = await db('ts_v_geography_coverage').select('*');
    return rows;
  },
};

module.exports = GeographyService;

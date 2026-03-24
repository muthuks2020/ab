'use strict';
/**
 * abmAreaTargets.service.js
 *
 * Standalone service for ABM area-level monthly target GET and SAVE.
 * Reads/writes ts_geography_targets (geo_level='area').
 * Does NOT touch or require abm.service.js.
 */

const { db } = require('../config/database');

const MONTHS = ['apr','may','jun','jul','aug','sep','oct','nov','dec','jan','feb','mar'];

const MONTH_NAME_MAP = {
  april:'apr', may:'may', june:'jun', july:'jul',
  august:'aug', september:'sep', october:'oct', november:'nov',
  december:'dec', january:'jan', february:'feb', march:'mar',
};

const normalizeCat = (cat) => {
  if (!cat) return 'others';
  const c = cat.toLowerCase();
  if (c.includes('equipment'))  return 'equipment';
  if (c.includes('iol'))        return 'iol';
  if (c.includes('consumable')) return 'consumable-sales';
  if (c.includes('msi') || c.includes('surgical')) return 'msi';
  return c.replace(/[\s-]+/g, '-');
};

const ABMAreaTargetsService = {

  /**
   * GET area targets for ABM.
   * CY data: ts_geography_targets WHERE geo_level='area' AND area_code AND fy=FY26_27
   * LY data: ts_geography_targets WHERE geo_level='area' AND area_code AND fy=FY25_26
   */
  async getAreaTargets(abmUser) {
    const fy       = 'FY26_27';
    const lyFy     = 'FY25_26';
    const areaCode = abmUser.areaCode || abmUser.area_code;

    // 1. Load all active products as the base map
    const allProducts = await db('product_master')
      .where('isactive', true)
      .select(
        'productcode',
        'product_name',
        'product_subgroup AS display_name',
        'product_category',
        'product_family AS subcategory',
        'product_group   AS subgroup',
        'quota_price__c  AS unit_cost',
        'active_from'
      )
      .orderBy('product_family')
      .orderBy('product_group')
      .orderBy('product_subgroup');

    const productMap = {};
    allProducts.forEach((p) => {
      const code = p.productcode;
      productMap[code] = {
        id:          code,
        productCode: code,
        code,
        name:        p.display_name || p.product_name || code,
        categoryId:  normalizeCat(p.product_category),
        subcategory: p.subcategory || null,
        subgroup:    p.subgroup    || null,
        unitCost:    Number(p.unit_cost) || 0,
        activeFrom:  p.active_from ? new Date(p.active_from).toISOString().substring(0, 10) : null,
        status:      'not_started',
        monthlyTargets: {},
      };
      MONTHS.forEach((m) => {
        productMap[code].monthlyTargets[m] = { cyQty: 0, cyRev: 0, lyQty: 0, lyRev: 0 };
      });
    });

    if (!areaCode) {
      return Object.values(productMap).sort((a, b) =>
        a.categoryId.localeCompare(b.categoryId) || a.name.localeCompare(b.name)
      );
    }

    // 2. Load CY saved targets (what ABM entered this year)
    const cyRows = await db('ts_geography_targets')
      .where({ geo_level: 'area', fiscal_year_code: fy, area_code: String(areaCode) })
      .select('id', 'product_code', 'status', 'monthly_targets');

    cyRows.forEach((r) => {
      const code = r.product_code;
      if (!productMap[code]) return;
      productMap[code].status = r.status || 'draft';
      productMap[code].id     = r.id;
      const mt = r.monthly_targets || {};
      MONTHS.forEach((m) => {
        if (!mt[m]) return;
        if (mt[m].cyQty != null) productMap[code].monthlyTargets[m].cyQty = Number(mt[m].cyQty) || 0;
        if (mt[m].cyRev != null) productMap[code].monthlyTargets[m].cyRev = Number(mt[m].cyRev) || 0;
        if (mt[m].lyQty != null) productMap[code].monthlyTargets[m].lyQty = Number(mt[m].lyQty) || 0;
        if (mt[m].lyRev != null) productMap[code].monthlyTargets[m].lyRev = Number(mt[m].lyRev) || 0;
      });
    });

    // 3. Load LY targets for reference (read-only, fills lyQty/lyRev where still 0)
    const lyRows = await db('ts_geography_targets')
      .where({ geo_level: 'area', fiscal_year_code: lyFy, area_code: String(areaCode) })
      .where(function () {
        this.where('target_quantity', '>', 0).orWhere('target_revenue', '>', 0);
      })
      .select('product_code', 'fiscal_month', 'target_quantity', 'target_revenue', 'monthly_targets');

    lyRows.forEach((r) => {
      const code = r.product_code;
      if (!productMap[code]) return;

      // Try monthly_targets JSONB first, fall back to flat fiscal_month columns
      const mt = r.monthly_targets || {};
      if (Object.keys(mt).length > 0) {
        MONTHS.forEach((m) => {
          if (!mt[m]) return;
          if (productMap[code].monthlyTargets[m].lyQty === 0 && mt[m].cyQty != null) {
            productMap[code].monthlyTargets[m].lyQty = Number(mt[m].cyQty) || 0;
          }
          if (productMap[code].monthlyTargets[m].lyRev === 0 && mt[m].cyRev != null) {
            productMap[code].monthlyTargets[m].lyRev = Number(mt[m].cyRev) || 0;
          }
        });
      } else {
        const monthKey = MONTH_NAME_MAP[r.fiscal_month && r.fiscal_month.toLowerCase()];
        if (!monthKey) return;
        if (productMap[code].monthlyTargets[monthKey].lyQty === 0) {
          productMap[code].monthlyTargets[monthKey].lyQty = Number(r.target_quantity) || 0;
          productMap[code].monthlyTargets[monthKey].lyRev = Number(r.target_revenue)  || 0;
        }
      }
    });

    return Object.values(productMap).sort((a, b) =>
      a.categoryId.localeCompare(b.categoryId) || a.name.localeCompare(b.name)
    );
  },

  /**
   * SAVE area targets for ABM.
   * Upsert into ts_geography_targets (geo_level='area').
   * One row per (fy, geo_level='area', area_code, product_code).
   */
  async saveAreaTargets(targets, abmUser) {
    const fy       = 'FY26_27';
    const areaCode = String(abmUser.areaCode || abmUser.area_code || '');
    const zoneCode = String(abmUser.zoneCode || abmUser.zone_code || '');
    const now      = new Date();
    let savedCount = 0;

    for (const t of targets) {
      const productCode = t.productCode || t.code;
      if (!productCode) continue;

      const existing = await db('ts_geography_targets')
        .where({ fiscal_year_code: fy, geo_level: 'area', area_code: areaCode, product_code: productCode })
        .first();

      if (existing) {
        // Never downgrade published → draft
        const newStatus = existing.status === 'published' ? 'published' : 'draft';
        await db('ts_geography_targets')
          .where({ id: existing.id })
          .update({
            monthly_targets: JSON.stringify(t.monthlyTargets || {}),
            set_by_code:     abmUser.employeeCode,
            set_by_role:     abmUser.role,
            status:          newStatus,
            updated_at:      now,
          });
      } else {
        await db('ts_geography_targets').insert({
          fiscal_year_code: fy,
          geo_level:        'area',
          zone_code:        zoneCode,
          zone_name:        abmUser.zoneName  || abmUser.zone_name  || null,
          area_code:        areaCode,
          area_name:        abmUser.areaName  || abmUser.area_name  || null,
          territory_code:   null,
          territory_name:   null,
          product_code:     productCode,
          category_id:      t.categoryId || null,
          monthly_targets:  JSON.stringify(t.monthlyTargets || {}),
          set_by_code:      abmUser.employeeCode,
          set_by_role:      abmUser.role,
          status:           'draft',
          created_at:       now,
          updated_at:       now,
        });
      }
      savedCount++;
    }

    return { success: true, savedCount };
  },
};

module.exports = ABMAreaTargetsService;

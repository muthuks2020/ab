-- ============================================================================
-- AOP DIAGNOSTIC & SEED SCRIPT
-- Run on the PostgreSQL backend database
-- ============================================================================

-- ======================== STEP 1: DIAGNOSTIC ========================
-- Run these first to understand the current state

-- 1a. Check active fiscal year
SELECT code, label, is_active, start_date, end_date 
FROM aop.ts_fiscal_years 
WHERE is_active = true;

-- 1b. Check if demo user E-000001 exists in auth table
SELECT id, employee_code, full_name, role, territory_code, territory_name
FROM aop.ts_auth_users 
WHERE employee_code = 'E-000001';

-- 1c. Count commitments for E-000001 in active FY
SELECT COUNT(*) AS commitment_count, fiscal_year_code, status
FROM aop.ts_product_commitments 
WHERE employee_code = 'E-000001'
GROUP BY fiscal_year_code, status;

-- 1d. Check what products exist in product_master (sample)
SELECT productcode, product_name, product_category, product_family, 
       quota_price__c, isactive
FROM aop.product_master 
WHERE isactive = true 
ORDER BY product_category, product_name
LIMIT 20;

-- 1e. Check active categories
SELECT id, name, is_revenue_only, display_order
FROM aop.ts_product_categories 
WHERE is_active = true 
ORDER BY display_order;


-- ======================== STEP 2: SEED COMMITMENTS ========================
-- Run this ONLY if Step 1c returns 0 rows.
--
-- This creates one commitment per product category for demo user E-000001
-- with sample monthly target data so the grid shows real numbers.
-- =========================================================================

DO $$
DECLARE
    v_fy_code  TEXT;
    v_emp_code TEXT := 'E-000001';
    v_product  RECORD;
    v_monthly  JSONB;
    v_count    INTEGER := 0;
BEGIN
    -- Get active fiscal year
    SELECT code INTO v_fy_code 
    FROM aop.ts_fiscal_years 
    WHERE is_active = true 
    LIMIT 1;

    IF v_fy_code IS NULL THEN
        RAISE NOTICE 'No active fiscal year found! Please activate one first.';
        RETURN;
    END IF;

    RAISE NOTICE 'Using fiscal year: %', v_fy_code;

    -- Check if commitments already exist
    SELECT COUNT(*) INTO v_count
    FROM aop.ts_product_commitments
    WHERE employee_code = v_emp_code
      AND fiscal_year_code = v_fy_code;

    IF v_count > 0 THEN
        RAISE NOTICE 'Commitments already exist for % in % (count: %). Skipping seed.', v_emp_code, v_fy_code, v_count;
        RETURN;
    END IF;

    -- Pick one representative product per active category
    FOR v_product IN
        SELECT DISTINCT ON (pc.id)
            pm.productcode,
            pm.product_name,
            pc.id AS category_id,
            pc.is_revenue_only,
            COALESCE(pm.quota_price__c, 0) AS unit_cost
        FROM aop.ts_product_categories pc
        JOIN aop.product_master pm 
            ON pm.product_category = pc.id 
           AND pm.isactive = true
        WHERE pc.is_active = true
        ORDER BY pc.id, pm.product_name
    LOOP
        -- Build sample monthly targets with LY and CY data
        IF v_product.is_revenue_only THEN
            -- Revenue-only categories (MIS, Others): only revenue fields
            v_monthly := jsonb_build_object(
                'apr', jsonb_build_object('lyRev', 150000, 'cyRev', 0, 'aopRev', 180000),
                'may', jsonb_build_object('lyRev', 160000, 'cyRev', 0, 'aopRev', 190000),
                'jun', jsonb_build_object('lyRev', 140000, 'cyRev', 0, 'aopRev', 170000),
                'jul', jsonb_build_object('lyRev', 155000, 'cyRev', 0, 'aopRev', 185000),
                'aug', jsonb_build_object('lyRev', 165000, 'cyRev', 0, 'aopRev', 195000),
                'sep', jsonb_build_object('lyRev', 170000, 'cyRev', 0, 'aopRev', 200000),
                'oct', jsonb_build_object('lyRev', 180000, 'cyRev', 0, 'aopRev', 210000),
                'nov', jsonb_build_object('lyRev', 175000, 'cyRev', 0, 'aopRev', 205000),
                'dec', jsonb_build_object('lyRev', 185000, 'cyRev', 0, 'aopRev', 215000),
                'jan', jsonb_build_object('lyRev', 190000, 'cyRev', 0, 'aopRev', 220000),
                'feb', jsonb_build_object('lyRev', 195000, 'cyRev', 0, 'aopRev', 225000),
                'mar', jsonb_build_object('lyRev', 200000, 'cyRev', 0, 'aopRev', 230000)
            );
        ELSE
            -- Quantity-based categories: qty + revenue fields
            v_monthly := jsonb_build_object(
                'apr', jsonb_build_object('lyQty', 120, 'cyQty', 0, 'aopQty', 150, 'lyRev', 240000, 'cyRev', 0, 'aopRev', 300000),
                'may', jsonb_build_object('lyQty', 130, 'cyQty', 0, 'aopQty', 160, 'lyRev', 260000, 'cyRev', 0, 'aopRev', 320000),
                'jun', jsonb_build_object('lyQty', 110, 'cyQty', 0, 'aopQty', 140, 'lyRev', 220000, 'cyRev', 0, 'aopRev', 280000),
                'jul', jsonb_build_object('lyQty', 125, 'cyQty', 0, 'aopQty', 155, 'lyRev', 250000, 'cyRev', 0, 'aopRev', 310000),
                'aug', jsonb_build_object('lyQty', 135, 'cyQty', 0, 'aopQty', 165, 'lyRev', 270000, 'cyRev', 0, 'aopRev', 330000),
                'sep', jsonb_build_object('lyQty', 140, 'cyQty', 0, 'aopQty', 170, 'lyRev', 280000, 'cyRev', 0, 'aopRev', 340000),
                'oct', jsonb_build_object('lyQty', 150, 'cyQty', 0, 'aopQty', 180, 'lyRev', 300000, 'cyRev', 0, 'aopRev', 360000),
                'nov', jsonb_build_object('lyQty', 145, 'cyQty', 0, 'aopQty', 175, 'lyRev', 290000, 'cyRev', 0, 'aopRev', 350000),
                'dec', jsonb_build_object('lyQty', 155, 'cyQty', 0, 'aopQty', 185, 'lyRev', 310000, 'cyRev', 0, 'aopRev', 370000),
                'jan', jsonb_build_object('lyQty', 160, 'cyQty', 0, 'aopQty', 190, 'lyRev', 320000, 'cyRev', 0, 'aopRev', 380000),
                'feb', jsonb_build_object('lyQty', 165, 'cyQty', 0, 'aopQty', 195, 'lyRev', 330000, 'cyRev', 0, 'aopRev', 390000),
                'mar', jsonb_build_object('lyQty', 170, 'cyQty', 0, 'aopQty', 200, 'lyRev', 340000, 'cyRev', 0, 'aopRev', 400000)
            );
        END IF;

        INSERT INTO aop.ts_product_commitments (
            fiscal_year_code,
            employee_code,
            product_code,
            category_id,
            zone_code,
            area_code,
            territory_code,
            monthly_targets,
            status
        ) VALUES (
            v_fy_code,
            v_emp_code,
            v_product.productcode,
            v_product.category_id,
            'Z3',                -- Demo user's zone
            'A-BHR',             -- Demo user's area
            'T-BHR-PAT-1',      -- Demo user's territory
            v_monthly,
            'draft'
        );

        v_count := v_count + 1;
        RAISE NOTICE 'Created commitment: % [%] → %', 
            v_product.product_name, v_product.category_id, v_product.productcode;
    END LOOP;

    RAISE NOTICE 'Done! Created % commitments for % in FY %', v_count, v_emp_code, v_fy_code;
END $$;


-- ======================== STEP 3: VERIFY ========================
-- Run after seed to confirm data

SELECT pc.id, pc.employee_code, pc.product_code, pc.category_id,
       pc.fiscal_year_code, pc.status,
       pm.product_name,
       (pc.monthly_targets->>'apr' IS NOT NULL) AS has_apr_data,
       jsonb_typeof(pc.monthly_targets) AS targets_type
FROM aop.ts_product_commitments pc
JOIN aop.product_master pm ON pm.productcode = pc.product_code
WHERE pc.employee_code = 'E-000001'
  AND pc.fiscal_year_code = (
    SELECT code FROM aop.ts_fiscal_years WHERE is_active = true LIMIT 1
  )
ORDER BY pc.category_id;

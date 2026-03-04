-- ============================================================================
-- COMPREHENSIVE DEMO SEED — All Roles
-- Run on: psql -h NLB-QC-App-2779e036f5869456.elb.ap-south-1.amazonaws.com -U admin -d aop -f seed_all_roles.sql
-- ============================================================================

-- ── Helper: reusable monthly targets with qty + revenue ──────────────────

-- Pattern A: High volume (IOL, Pharma)
-- Pattern B: Medium volume (OVD, Equipment) 
-- Pattern C: Low volume / revenue-only (MSI)

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Update Sales Rep (E-000001) — set some to 'submitted' so TBM can see
-- ══════════════════════════════════════════════════════════════════════════

UPDATE aop.ts_product_commitments 
SET status = 'submitted', submitted_at = NOW()
WHERE employee_code = 'E-000001' AND product_code IN ('DEMO-IOL-001', 'DEMO-IOL-002', 'DEMO-PHR-001');

-- ══════════════════════════════════════════════════════════════════════════
-- 2. TBM (E-000002) — own territory targets
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000002', 'tbm', 'DEMO-EQP-001', 'equipment', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":25,"cyQty":30,"aopQty":35,"lyRev":625000,"cyRev":750000,"aopRev":875000},"may":{"lyQty":28,"cyQty":33,"aopQty":38,"lyRev":700000,"cyRev":825000,"aopRev":950000},"jun":{"lyQty":22,"cyQty":27,"aopQty":32,"lyRev":550000,"cyRev":675000,"aopRev":800000},"jul":{"lyQty":26,"cyQty":31,"aopQty":36,"lyRev":650000,"cyRev":775000,"aopRev":900000},"aug":{"lyQty":30,"cyQty":35,"aopQty":40,"lyRev":750000,"cyRev":875000,"aopRev":1000000},"sep":{"lyQty":24,"cyQty":29,"aopQty":34,"lyRev":600000,"cyRev":725000,"aopRev":850000},"oct":{"lyQty":32,"cyQty":37,"aopQty":42,"lyRev":800000,"cyRev":925000,"aopRev":1050000},"nov":{"lyQty":27,"cyQty":32,"aopQty":37,"lyRev":675000,"cyRev":800000,"aopRev":925000},"dec":{"lyQty":29,"cyQty":34,"aopQty":39,"lyRev":725000,"cyRev":850000,"aopRev":975000},"jan":{"lyQty":33,"cyQty":38,"aopQty":43,"lyRev":825000,"cyRev":950000,"aopRev":1075000},"feb":{"lyQty":26,"cyQty":31,"aopQty":36,"lyRev":650000,"cyRev":775000,"aopRev":900000},"mar":{"lyQty":31,"cyQty":36,"aopQty":41,"lyRev":775000,"cyRev":900000,"aopRev":1025000}}',
   'draft'),
  ('FY26_27', 'E-000002', 'tbm', 'DEMO-IOL-001', 'iol', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":300,"cyQty":360,"aopQty":400,"lyRev":255000,"cyRev":306000,"aopRev":340000},"may":{"lyQty":320,"cyQty":385,"aopQty":420,"lyRev":272000,"cyRev":327250,"aopRev":357000},"jun":{"lyQty":280,"cyQty":340,"aopQty":375,"lyRev":238000,"cyRev":289000,"aopRev":318750},"jul":{"lyQty":310,"cyQty":375,"aopQty":410,"lyRev":263500,"cyRev":318750,"aopRev":348500},"aug":{"lyQty":335,"cyQty":400,"aopQty":440,"lyRev":284750,"cyRev":340000,"aopRev":374000},"sep":{"lyQty":345,"cyQty":415,"aopQty":455,"lyRev":293250,"cyRev":352750,"aopRev":386750},"oct":{"lyQty":360,"cyQty":430,"aopQty":470,"lyRev":306000,"cyRev":365500,"aopRev":399500},"nov":{"lyQty":350,"cyQty":420,"aopQty":460,"lyRev":297500,"cyRev":357000,"aopRev":391000},"dec":{"lyQty":370,"cyQty":445,"aopQty":485,"lyRev":314500,"cyRev":378250,"aopRev":412250},"jan":{"lyQty":380,"cyQty":455,"aopQty":500,"lyRev":323000,"cyRev":386750,"aopRev":425000},"feb":{"lyQty":375,"cyQty":450,"aopQty":490,"lyRev":318750,"cyRev":382500,"aopRev":416500},"mar":{"lyQty":390,"cyQty":468,"aopQty":510,"lyRev":331500,"cyRev":397800,"aopRev":433500}}',
   'submitted'),
  ('FY26_27', 'E-000002', 'tbm', 'DEMO-IOL-002', 'iol', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":200,"cyQty":240,"aopQty":265,"lyRev":240000,"cyRev":288000,"aopRev":318000},"may":{"lyQty":215,"cyQty":255,"aopQty":280,"lyRev":258000,"cyRev":306000,"aopRev":336000},"jun":{"lyQty":190,"cyQty":230,"aopQty":255,"lyRev":228000,"cyRev":276000,"aopRev":306000},"jul":{"lyQty":205,"cyQty":245,"aopQty":270,"lyRev":246000,"cyRev":294000,"aopRev":324000},"aug":{"lyQty":225,"cyQty":270,"aopQty":295,"lyRev":270000,"cyRev":324000,"aopRev":354000},"sep":{"lyQty":235,"cyQty":280,"aopQty":305,"lyRev":282000,"cyRev":336000,"aopRev":366000},"oct":{"lyQty":250,"cyQty":298,"aopQty":325,"lyRev":300000,"cyRev":357600,"aopRev":390000},"nov":{"lyQty":245,"cyQty":292,"aopQty":318,"lyRev":294000,"cyRev":350400,"aopRev":381600},"dec":{"lyQty":260,"cyQty":312,"aopQty":340,"lyRev":312000,"cyRev":374400,"aopRev":408000},"jan":{"lyQty":270,"cyQty":325,"aopQty":355,"lyRev":324000,"cyRev":390000,"aopRev":426000},"feb":{"lyQty":265,"cyQty":318,"aopQty":348,"lyRev":318000,"cyRev":381600,"aopRev":417600},"mar":{"lyQty":280,"cyQty":335,"aopQty":365,"lyRev":336000,"cyRev":402000,"aopRev":438000}}',
   'submitted'),
  ('FY26_27', 'E-000002', 'tbm', 'DEMO-MSI-001', 'msi', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":12,"cyQty":15,"aopQty":18,"lyRev":222000,"cyRev":277500,"aopRev":333000},"may":{"lyQty":14,"cyQty":17,"aopQty":20,"lyRev":259000,"cyRev":314500,"aopRev":370000},"jun":{"lyQty":10,"cyQty":13,"aopQty":16,"lyRev":185000,"cyRev":240500,"aopRev":296000},"jul":{"lyQty":13,"cyQty":16,"aopQty":19,"lyRev":240500,"cyRev":296000,"aopRev":351500},"aug":{"lyQty":15,"cyQty":18,"aopQty":21,"lyRev":277500,"cyRev":333000,"aopRev":388500},"sep":{"lyQty":14,"cyQty":17,"aopQty":20,"lyRev":259000,"cyRev":314500,"aopRev":370000},"oct":{"lyQty":16,"cyQty":19,"aopQty":22,"lyRev":296000,"cyRev":351500,"aopRev":407000},"nov":{"lyQty":13,"cyQty":16,"aopQty":19,"lyRev":240500,"cyRev":296000,"aopRev":351500},"dec":{"lyQty":15,"cyQty":18,"aopQty":21,"lyRev":277500,"cyRev":333000,"aopRev":388500},"jan":{"lyQty":17,"cyQty":20,"aopQty":23,"lyRev":314500,"cyRev":370000,"aopRev":425500},"feb":{"lyQty":14,"cyQty":17,"aopQty":20,"lyRev":259000,"cyRev":314500,"aopRev":370000},"mar":{"lyQty":16,"cyQty":19,"aopQty":22,"lyRev":296000,"cyRev":351500,"aopRev":407000}}',
   'draft'),
  ('FY26_27', 'E-000002', 'tbm', 'DEMO-PHR-001', 'pharma', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":500,"cyQty":600,"aopQty":650,"lyRev":75000,"cyRev":90000,"aopRev":97500},"may":{"lyQty":540,"cyQty":650,"aopQty":700,"lyRev":81000,"cyRev":97500,"aopRev":105000},"jun":{"lyQty":470,"cyQty":565,"aopQty":615,"lyRev":70500,"cyRev":84750,"aopRev":92250},"jul":{"lyQty":520,"cyQty":625,"aopQty":675,"lyRev":78000,"cyRev":93750,"aopRev":101250},"aug":{"lyQty":560,"cyQty":675,"aopQty":725,"lyRev":84000,"cyRev":101250,"aopRev":108750},"sep":{"lyQty":580,"cyQty":700,"aopQty":750,"lyRev":87000,"cyRev":105000,"aopRev":112500},"oct":{"lyQty":600,"cyQty":720,"aopQty":780,"lyRev":90000,"cyRev":108000,"aopRev":117000},"nov":{"lyQty":590,"cyQty":710,"aopQty":765,"lyRev":88500,"cyRev":106500,"aopRev":114750},"dec":{"lyQty":620,"cyQty":745,"aopQty":800,"lyRev":93000,"cyRev":111750,"aopRev":120000},"jan":{"lyQty":640,"cyQty":770,"aopQty":830,"lyRev":96000,"cyRev":115500,"aopRev":124500},"feb":{"lyQty":630,"cyQty":755,"aopQty":815,"lyRev":94500,"cyRev":113250,"aopRev":122250},"mar":{"lyQty":660,"cyQty":795,"aopQty":855,"lyRev":99000,"cyRev":119250,"aopRev":128250}}',
   'draft');

-- ══════════════════════════════════════════════════════════════════════════
-- 3. ABM (E-000003) — area-level targets
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000003', 'abm', 'DEMO-EQP-001', 'equipment', 'Z3', 'A-BHR', NULL,
   '{"apr":{"lyQty":60,"cyQty":72,"aopQty":80,"lyRev":1500000,"cyRev":1800000,"aopRev":2000000},"may":{"lyQty":65,"cyQty":78,"aopQty":86,"lyRev":1625000,"cyRev":1950000,"aopRev":2150000},"jun":{"lyQty":55,"cyQty":66,"aopQty":74,"lyRev":1375000,"cyRev":1650000,"aopRev":1850000},"jul":{"lyQty":62,"cyQty":75,"aopQty":83,"lyRev":1550000,"cyRev":1875000,"aopRev":2075000},"aug":{"lyQty":68,"cyQty":82,"aopQty":90,"lyRev":1700000,"cyRev":2050000,"aopRev":2250000},"sep":{"lyQty":58,"cyQty":70,"aopQty":78,"lyRev":1450000,"cyRev":1750000,"aopRev":1950000},"oct":{"lyQty":72,"cyQty":86,"aopQty":95,"lyRev":1800000,"cyRev":2150000,"aopRev":2375000},"nov":{"lyQty":63,"cyQty":76,"aopQty":84,"lyRev":1575000,"cyRev":1900000,"aopRev":2100000},"dec":{"lyQty":67,"cyQty":80,"aopQty":89,"lyRev":1675000,"cyRev":2000000,"aopRev":2225000},"jan":{"lyQty":75,"cyQty":90,"aopQty":99,"lyRev":1875000,"cyRev":2250000,"aopRev":2475000},"feb":{"lyQty":64,"cyQty":77,"aopQty":85,"lyRev":1600000,"cyRev":1925000,"aopRev":2125000},"mar":{"lyQty":70,"cyQty":84,"aopQty":93,"lyRev":1750000,"cyRev":2100000,"aopRev":2325000}}',
   'draft'),
  ('FY26_27', 'E-000003', 'abm', 'DEMO-IOL-001', 'iol', 'Z3', 'A-BHR', NULL,
   '{"apr":{"lyQty":700,"cyQty":840,"aopQty":930,"lyRev":595000,"cyRev":714000,"aopRev":790500},"may":{"lyQty":750,"cyQty":900,"aopQty":990,"lyRev":637500,"cyRev":765000,"aopRev":841500},"jun":{"lyQty":660,"cyQty":795,"aopQty":880,"lyRev":561000,"cyRev":675750,"aopRev":748000},"jul":{"lyQty":720,"cyQty":865,"aopQty":955,"lyRev":612000,"cyRev":735250,"aopRev":811750},"aug":{"lyQty":780,"cyQty":935,"aopQty":1030,"lyRev":663000,"cyRev":794750,"aopRev":875500},"sep":{"lyQty":800,"cyQty":960,"aopQty":1060,"lyRev":680000,"cyRev":816000,"aopRev":901000},"oct":{"lyQty":830,"cyQty":995,"aopQty":1100,"lyRev":705500,"cyRev":845750,"aopRev":935000},"nov":{"lyQty":810,"cyQty":975,"aopQty":1075,"lyRev":688500,"cyRev":828750,"aopRev":913750},"dec":{"lyQty":850,"cyQty":1020,"aopQty":1125,"lyRev":722500,"cyRev":867000,"aopRev":956250},"jan":{"lyQty":880,"cyQty":1055,"aopQty":1165,"lyRev":748000,"cyRev":896750,"aopRev":990250},"feb":{"lyQty":860,"cyQty":1030,"aopQty":1140,"lyRev":731000,"cyRev":875500,"aopRev":969000},"mar":{"lyQty":900,"cyQty":1080,"aopQty":1195,"lyRev":765000,"cyRev":918000,"aopRev":1015750}}',
   'submitted'),
  ('FY26_27', 'E-000003', 'abm', 'DEMO-PHR-001', 'pharma', 'Z3', 'A-BHR', NULL,
   '{"apr":{"lyQty":1200,"cyQty":1440,"aopQty":1590,"lyRev":180000,"cyRev":216000,"aopRev":238500},"may":{"lyQty":1300,"cyQty":1560,"aopQty":1720,"lyRev":195000,"cyRev":234000,"aopRev":258000},"jun":{"lyQty":1100,"cyQty":1320,"aopQty":1460,"lyRev":165000,"cyRev":198000,"aopRev":219000},"jul":{"lyQty":1250,"cyQty":1500,"aopQty":1660,"lyRev":187500,"cyRev":225000,"aopRev":249000},"aug":{"lyQty":1350,"cyQty":1620,"aopQty":1790,"lyRev":202500,"cyRev":243000,"aopRev":268500},"sep":{"lyQty":1400,"cyQty":1680,"aopQty":1855,"lyRev":210000,"cyRev":252000,"aopRev":278250},"oct":{"lyQty":1450,"cyQty":1740,"aopQty":1925,"lyRev":217500,"cyRev":261000,"aopRev":288750},"nov":{"lyQty":1420,"cyQty":1705,"aopQty":1885,"lyRev":213000,"cyRev":255750,"aopRev":282750},"dec":{"lyQty":1500,"cyQty":1800,"aopQty":1990,"lyRev":225000,"cyRev":270000,"aopRev":298500},"jan":{"lyQty":1550,"cyQty":1860,"aopQty":2055,"lyRev":232500,"cyRev":279000,"aopRev":308250},"feb":{"lyQty":1520,"cyQty":1825,"aopQty":2015,"lyRev":228000,"cyRev":273750,"aopRev":302250},"mar":{"lyQty":1600,"cyQty":1920,"aopQty":2125,"lyRev":240000,"cyRev":288000,"aopRev":318750}}',
   'submitted');

-- ══════════════════════════════════════════════════════════════════════════
-- 4. ZBM (E-000004) — zone-level targets
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000004', 'zbm', 'DEMO-EQP-001', 'equipment', 'Z3', NULL, NULL,
   '{"apr":{"lyQty":150,"cyQty":180,"aopQty":200,"lyRev":3750000,"cyRev":4500000,"aopRev":5000000},"may":{"lyQty":160,"cyQty":192,"aopQty":215,"lyRev":4000000,"cyRev":4800000,"aopRev":5375000},"jun":{"lyQty":140,"cyQty":168,"aopQty":188,"lyRev":3500000,"cyRev":4200000,"aopRev":4700000},"jul":{"lyQty":155,"cyQty":186,"aopQty":208,"lyRev":3875000,"cyRev":4650000,"aopRev":5200000},"aug":{"lyQty":170,"cyQty":204,"aopQty":228,"lyRev":4250000,"cyRev":5100000,"aopRev":5700000},"sep":{"lyQty":145,"cyQty":174,"aopQty":195,"lyRev":3625000,"cyRev":4350000,"aopRev":4875000},"oct":{"lyQty":175,"cyQty":210,"aopQty":235,"lyRev":4375000,"cyRev":5250000,"aopRev":5875000},"nov":{"lyQty":158,"cyQty":190,"aopQty":212,"lyRev":3950000,"cyRev":4750000,"aopRev":5300000},"dec":{"lyQty":165,"cyQty":198,"aopQty":222,"lyRev":4125000,"cyRev":4950000,"aopRev":5550000},"jan":{"lyQty":180,"cyQty":216,"aopQty":242,"lyRev":4500000,"cyRev":5400000,"aopRev":6050000},"feb":{"lyQty":162,"cyQty":194,"aopQty":218,"lyRev":4050000,"cyRev":4850000,"aopRev":5450000},"mar":{"lyQty":172,"cyQty":206,"aopQty":231,"lyRev":4300000,"cyRev":5150000,"aopRev":5775000}}',
   'draft'),
  ('FY26_27', 'E-000004', 'zbm', 'DEMO-IOL-001', 'iol', 'Z3', NULL, NULL,
   '{"apr":{"lyQty":1800,"cyQty":2160,"aopQty":2400,"lyRev":1530000,"cyRev":1836000,"aopRev":2040000},"may":{"lyQty":1950,"cyQty":2340,"aopQty":2600,"lyRev":1657500,"cyRev":1989000,"aopRev":2210000},"jun":{"lyQty":1700,"cyQty":2040,"aopQty":2270,"lyRev":1445000,"cyRev":1734000,"aopRev":1929500},"jul":{"lyQty":1850,"cyQty":2220,"aopQty":2470,"lyRev":1572500,"cyRev":1887000,"aopRev":2099500},"aug":{"lyQty":2000,"cyQty":2400,"aopQty":2670,"lyRev":1700000,"cyRev":2040000,"aopRev":2269500},"sep":{"lyQty":2050,"cyQty":2460,"aopQty":2740,"lyRev":1742500,"cyRev":2091000,"aopRev":2329000},"oct":{"lyQty":2150,"cyQty":2580,"aopQty":2870,"lyRev":1827500,"cyRev":2193000,"aopRev":2439500},"nov":{"lyQty":2100,"cyQty":2520,"aopQty":2800,"lyRev":1785000,"cyRev":2142000,"aopRev":2380000},"dec":{"lyQty":2200,"cyQty":2640,"aopQty":2940,"lyRev":1870000,"cyRev":2244000,"aopRev":2499000},"jan":{"lyQty":2280,"cyQty":2736,"aopQty":3040,"lyRev":1938000,"cyRev":2325600,"aopRev":2584000},"feb":{"lyQty":2230,"cyQty":2676,"aopQty":2975,"lyRev":1895500,"cyRev":2274600,"aopRev":2528750},"mar":{"lyQty":2350,"cyQty":2820,"aopQty":3135,"lyRev":1997500,"cyRev":2397000,"aopRev":2664750}}',
   'submitted'),
  ('FY26_27', 'E-000004', 'zbm', 'DEMO-PHR-001', 'pharma', 'Z3', NULL, NULL,
   '{"apr":{"lyQty":3000,"cyQty":3600,"aopQty":4000,"lyRev":450000,"cyRev":540000,"aopRev":600000},"may":{"lyQty":3200,"cyQty":3840,"aopQty":4270,"lyRev":480000,"cyRev":576000,"aopRev":640500},"jun":{"lyQty":2800,"cyQty":3360,"aopQty":3735,"lyRev":420000,"cyRev":504000,"aopRev":560250},"jul":{"lyQty":3100,"cyQty":3720,"aopQty":4135,"lyRev":465000,"cyRev":558000,"aopRev":620250},"aug":{"lyQty":3350,"cyQty":4020,"aopQty":4470,"lyRev":502500,"cyRev":603000,"aopRev":670500},"sep":{"lyQty":3450,"cyQty":4140,"aopQty":4605,"lyRev":517500,"cyRev":621000,"aopRev":690750},"oct":{"lyQty":3550,"cyQty":4260,"aopQty":4735,"lyRev":532500,"cyRev":639000,"aopRev":710250},"nov":{"lyQty":3500,"cyQty":4200,"aopQty":4670,"lyRev":525000,"cyRev":630000,"aopRev":700500},"dec":{"lyQty":3650,"cyQty":4380,"aopQty":4870,"lyRev":547500,"cyRev":657000,"aopRev":730500},"jan":{"lyQty":3800,"cyQty":4560,"aopQty":5070,"lyRev":570000,"cyRev":684000,"aopRev":760500},"feb":{"lyQty":3700,"cyQty":4440,"aopQty":4935,"lyRev":555000,"cyRev":666000,"aopRev":740250},"mar":{"lyQty":3900,"cyQty":4680,"aopQty":5200,"lyRev":585000,"cyRev":702000,"aopRev":780000}}',
   'submitted');

-- ══════════════════════════════════════════════════════════════════════════
-- 5. Sales Head (E-000005) — company-level targets
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000005', 'sales_head', 'DEMO-EQP-001', 'equipment', NULL, NULL, NULL,
   '{"apr":{"lyQty":500,"cyQty":600,"aopQty":670,"lyRev":12500000,"cyRev":15000000,"aopRev":16750000},"may":{"lyQty":530,"cyQty":636,"aopQty":710,"lyRev":13250000,"cyRev":15900000,"aopRev":17750000},"jun":{"lyQty":470,"cyQty":564,"aopQty":630,"lyRev":11750000,"cyRev":14100000,"aopRev":15750000},"jul":{"lyQty":510,"cyQty":612,"aopQty":683,"lyRev":12750000,"cyRev":15300000,"aopRev":17075000},"aug":{"lyQty":550,"cyQty":660,"aopQty":737,"lyRev":13750000,"cyRev":16500000,"aopRev":18425000},"sep":{"lyQty":490,"cyQty":588,"aopQty":656,"lyRev":12250000,"cyRev":14700000,"aopRev":16400000},"oct":{"lyQty":570,"cyQty":684,"aopQty":764,"lyRev":14250000,"cyRev":17100000,"aopRev":19100000},"nov":{"lyQty":520,"cyQty":624,"aopQty":697,"lyRev":13000000,"cyRev":15600000,"aopRev":17425000},"dec":{"lyQty":545,"cyQty":654,"aopQty":730,"lyRev":13625000,"cyRev":16350000,"aopRev":18250000},"jan":{"lyQty":580,"cyQty":696,"aopQty":777,"lyRev":14500000,"cyRev":17400000,"aopRev":19425000},"feb":{"lyQty":535,"cyQty":642,"aopQty":717,"lyRev":13375000,"cyRev":16050000,"aopRev":17925000},"mar":{"lyQty":560,"cyQty":672,"aopQty":750,"lyRev":14000000,"cyRev":16800000,"aopRev":18750000}}',
   'approved'),
  ('FY26_27', 'E-000005', 'sales_head', 'DEMO-IOL-001', 'iol', NULL, NULL, NULL,
   '{"apr":{"lyQty":5000,"cyQty":6000,"aopQty":6700,"lyRev":4250000,"cyRev":5100000,"aopRev":5695000},"may":{"lyQty":5300,"cyQty":6360,"aopQty":7100,"lyRev":4505000,"cyRev":5406000,"aopRev":6035000},"jun":{"lyQty":4700,"cyQty":5640,"aopQty":6300,"lyRev":3995000,"cyRev":4794000,"aopRev":5355000},"jul":{"lyQty":5100,"cyQty":6120,"aopQty":6830,"lyRev":4335000,"cyRev":5202000,"aopRev":5805500},"aug":{"lyQty":5500,"cyQty":6600,"aopQty":7370,"lyRev":4675000,"cyRev":5610000,"aopRev":6264500},"sep":{"lyQty":5600,"cyQty":6720,"aopQty":7505,"lyRev":4760000,"cyRev":5712000,"aopRev":6379250},"oct":{"lyQty":5800,"cyQty":6960,"aopQty":7770,"lyRev":4930000,"cyRev":5916000,"aopRev":6604500},"nov":{"lyQty":5700,"cyQty":6840,"aopQty":7635,"lyRev":4845000,"cyRev":5814000,"aopRev":6489750},"dec":{"lyQty":6000,"cyQty":7200,"aopQty":8040,"lyRev":5100000,"cyRev":6120000,"aopRev":6834000},"jan":{"lyQty":6200,"cyQty":7440,"aopQty":8310,"lyRev":5270000,"cyRev":6324000,"aopRev":7063500},"feb":{"lyQty":6100,"cyQty":7320,"aopQty":8175,"lyRev":5185000,"cyRev":6222000,"aopRev":6948750},"mar":{"lyQty":6400,"cyQty":7680,"aopQty":8575,"lyRev":5440000,"cyRev":6528000,"aopRev":7288750}}',
   'approved');

-- ══════════════════════════════════════════════════════════════════════════
-- 6. AT/IOL Specialist (E-000006) — IOL-specific targets
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000006', 'at_iol_specialist', 'DEMO-IOL-001', 'iol', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":90,"cyQty":108,"aopQty":120,"lyRev":76500,"cyRev":91800,"aopRev":102000},"may":{"lyQty":95,"cyQty":114,"aopQty":127,"lyRev":80750,"cyRev":96900,"aopRev":107950},"jun":{"lyQty":85,"cyQty":102,"aopQty":113,"lyRev":72250,"cyRev":86700,"aopRev":96050},"jul":{"lyQty":92,"cyQty":110,"aopQty":123,"lyRev":78200,"cyRev":93500,"aopRev":104550},"aug":{"lyQty":100,"cyQty":120,"aopQty":134,"lyRev":85000,"cyRev":102000,"aopRev":113900},"sep":{"lyQty":105,"cyQty":126,"aopQty":140,"lyRev":89250,"cyRev":107100,"aopRev":119000},"oct":{"lyQty":110,"cyQty":132,"aopQty":147,"lyRev":93500,"cyRev":112200,"aopRev":124950},"nov":{"lyQty":108,"cyQty":130,"aopQty":144,"lyRev":91800,"cyRev":110500,"aopRev":122400},"dec":{"lyQty":115,"cyQty":138,"aopQty":154,"lyRev":97750,"cyRev":117300,"aopRev":130900},"jan":{"lyQty":120,"cyQty":144,"aopQty":160,"lyRev":102000,"cyRev":122400,"aopRev":136000},"feb":{"lyQty":118,"cyQty":142,"aopQty":158,"lyRev":100300,"cyRev":120700,"aopRev":134300},"mar":{"lyQty":125,"cyQty":150,"aopQty":167,"lyRev":106250,"cyRev":127500,"aopRev":141950}}',
   'submitted'),
  ('FY26_27', 'E-000006', 'at_iol_specialist', 'DEMO-IOL-002', 'iol', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":60,"cyQty":72,"aopQty":80,"lyRev":72000,"cyRev":86400,"aopRev":96000},"may":{"lyQty":65,"cyQty":78,"aopQty":87,"lyRev":78000,"cyRev":93600,"aopRev":104400},"jun":{"lyQty":55,"cyQty":66,"aopQty":74,"lyRev":66000,"cyRev":79200,"aopRev":88800},"jul":{"lyQty":62,"cyQty":74,"aopQty":83,"lyRev":74400,"cyRev":88800,"aopRev":99600},"aug":{"lyQty":68,"cyQty":82,"aopQty":91,"lyRev":81600,"cyRev":98400,"aopRev":109200},"sep":{"lyQty":72,"cyQty":86,"aopQty":96,"lyRev":86400,"cyRev":103200,"aopRev":115200},"oct":{"lyQty":75,"cyQty":90,"aopQty":100,"lyRev":90000,"cyRev":108000,"aopRev":120000},"nov":{"lyQty":73,"cyQty":88,"aopQty":98,"lyRev":87600,"cyRev":105600,"aopRev":117600},"dec":{"lyQty":78,"cyQty":94,"aopQty":104,"lyRev":93600,"cyRev":112800,"aopRev":124800},"jan":{"lyQty":82,"cyQty":98,"aopQty":109,"lyRev":98400,"cyRev":117600,"aopRev":130800},"feb":{"lyQty":80,"cyQty":96,"aopQty":107,"lyRev":96000,"cyRev":115200,"aopRev":128400},"mar":{"lyQty":85,"cyQty":102,"aopQty":114,"lyRev":102000,"cyRev":122400,"aopRev":136800}}',
   'draft');

-- ══════════════════════════════════════════════════════════════════════════
-- 7. Equipment Specialist Diagnostic (E-000007)
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000007', 'eq_spec_diagnostic', 'DEMO-EQP-001', 'equipment', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":8,"cyQty":10,"aopQty":12,"lyRev":200000,"cyRev":250000,"aopRev":300000},"may":{"lyQty":9,"cyQty":11,"aopQty":13,"lyRev":225000,"cyRev":275000,"aopRev":325000},"jun":{"lyQty":7,"cyQty":9,"aopQty":11,"lyRev":175000,"cyRev":225000,"aopRev":275000},"jul":{"lyQty":8,"cyQty":10,"aopQty":12,"lyRev":200000,"cyRev":250000,"aopRev":300000},"aug":{"lyQty":10,"cyQty":12,"aopQty":14,"lyRev":250000,"cyRev":300000,"aopRev":350000},"sep":{"lyQty":9,"cyQty":11,"aopQty":13,"lyRev":225000,"cyRev":275000,"aopRev":325000},"oct":{"lyQty":11,"cyQty":13,"aopQty":15,"lyRev":275000,"cyRev":325000,"aopRev":375000},"nov":{"lyQty":8,"cyQty":10,"aopQty":12,"lyRev":200000,"cyRev":250000,"aopRev":300000},"dec":{"lyQty":10,"cyQty":12,"aopQty":14,"lyRev":250000,"cyRev":300000,"aopRev":350000},"jan":{"lyQty":12,"cyQty":14,"aopQty":16,"lyRev":300000,"cyRev":350000,"aopRev":400000},"feb":{"lyQty":9,"cyQty":11,"aopQty":13,"lyRev":225000,"cyRev":275000,"aopRev":325000},"mar":{"lyQty":11,"cyQty":13,"aopQty":15,"lyRev":275000,"cyRev":325000,"aopRev":375000}}',
   'submitted');

-- ══════════════════════════════════════════════════════════════════════════
-- 8. Equipment Specialist Surgical (E-000008)
-- ══════════════════════════════════════════════════════════════════════════

INSERT INTO aop.ts_product_commitments 
  (fiscal_year_code, employee_code, employee_role, product_code, category_id, zone_code, area_code, territory_code, monthly_targets, status)
VALUES
  ('FY26_27', 'E-000008', 'eq_spec_surgical', 'DEMO-EQP-001', 'equipment', 'Z3', 'A-BHR', 'T-BHR-PAT-1',
   '{"apr":{"lyQty":6,"cyQty":8,"aopQty":9,"lyRev":150000,"cyRev":200000,"aopRev":225000},"may":{"lyQty":7,"cyQty":9,"aopQty":10,"lyRev":175000,"cyRev":225000,"aopRev":250000},"jun":{"lyQty":5,"cyQty":7,"aopQty":8,"lyRev":125000,"cyRev":175000,"aopRev":200000},"jul":{"lyQty":6,"cyQty":8,"aopQty":9,"lyRev":150000,"cyRev":200000,"aopRev":225000},"aug":{"lyQty":8,"cyQty":10,"aopQty":11,"lyRev":200000,"cyRev":250000,"aopRev":275000},"sep":{"lyQty":7,"cyQty":9,"aopQty":10,"lyRev":175000,"cyRev":225000,"aopRev":250000},"oct":{"lyQty":9,"cyQty":11,"aopQty":12,"lyRev":225000,"cyRev":275000,"aopRev":300000},"nov":{"lyQty":6,"cyQty":8,"aopQty":9,"lyRev":150000,"cyRev":200000,"aopRev":225000},"dec":{"lyQty":8,"cyQty":10,"aopQty":11,"lyRev":200000,"cyRev":250000,"aopRev":275000},"jan":{"lyQty":10,"cyQty":12,"aopQty":13,"lyRev":250000,"cyRev":300000,"aopRev":325000},"feb":{"lyQty":7,"cyQty":9,"aopQty":10,"lyRev":175000,"cyRev":225000,"aopRev":250000},"mar":{"lyQty":9,"cyQty":11,"aopQty":12,"lyRev":225000,"cyRev":275000,"aopRev":300000}}',
   'draft');

-- ══════════════════════════════════════════════════════════════════════════
-- VERIFY
-- ══════════════════════════════════════════════════════════════════════════

SELECT employee_code, employee_role, COUNT(*) as products, 
       string_agg(DISTINCT status, ', ') as statuses
FROM aop.ts_product_commitments 
WHERE fiscal_year_code = 'FY26_27'
GROUP BY employee_code, employee_role
ORDER BY employee_code;

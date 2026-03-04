

-- ████████████████████████████████████████████████████████████████████████████
--
--  PART 1 ─── INSERT DEMO DATA
--
-- ████████████████████████████████████████████████████████████████████████████

/*
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                      DEMO SCENARIO / STORY                              │
 │                                                                         │
 │  HIERARCHY (10 users)                                                   │
 │                                                                         │
 │  DEMO-SH01  Rajesh Kumar ── Sales Head (top) ── sets ZONE targets      │
 │    └─ DEMO-ZBM01  Priya Sharma ── ZBM Zone-3 ── sets AREA targets      │
 │         └─ DEMO-ABM01  Vikram Singh ── ABM Bihar ── sets TERRITORY tgts │
 │              ├─ DEMO-TBM01  Anita Patel ── TBM Patna-1 ── approves SRs │
 │              │    ├─ DEMO-SR01  Suresh Reddy  ── SR ── ✅ APPROVED      │
 │              │    └─ DEMO-SR02  Meena Gupta   ── SR ── ⏳ SUBMITTED     │
 │              ├─ DEMO-TBM02  Ravi Nair ── TBM Patna-2                    │
 │              │    └─ DEMO-SR03  Kavita Das ── SR ── 🔄 TRANSFERRED!     │
 │              └─ DEMO-IOL01  Deepak Joshi ── IOL Specialist ── 📝 DRAFT  │
 │                                                                         │
 │  DEMO FLOW (what client will see):                                      │
 │    Step 1 → Sales Head sets ZONE-level targets (3 products)             │
 │    Step 2 → ZBM breaks into AREA-level targets                          │
 │    Step 3 → ABM breaks into TERRITORY-level targets (5 products)        │
 │    Step 4 → SR Suresh enters commitments → TBM approves ✅              │
 │    Step 5 → SR Meena enters commitments → submits, pending ⏳            │
 │    Step 6 → IOL Specialist Deepak → draft commitments 📝                │
 │    Step 7 → SR Kavita transferred Patna-2 → Patna-1 🔄                 │
 │             (old commitment stays with Patna-2 — KEY FEATURE!)          │
 │    Step 8 → Approval audit trail recorded                               │
 │    Step 9 → Notifications generated                                     │
 │                                                                         │
 │  GEOGRAPHY:                                                             │
 │    Zone  : DEMO-Z3   / Demo Zone-3                                      │
 │    Area  : DEMO-A35  / Demo Bihar                                       │
 │    Terr1 : DEMO-T351 / Demo Bihar(Patna)-1                              │
 │    Terr2 : DEMO-T352 / Demo Bihar(Patna)-2                              │
 │                                                                         │
 │  PRODUCTS (5):                                                          │
 │    DEMO-IOL-001  Appasamy AcriView Hydrophilic IOL      (iol)           │
 │    DEMO-IOL-002  Appasamy AcriView Hydrophobic IOL      (iol)           │
 │    DEMO-PHR-001  Appasamy Floxbro Eye Drops 5ml         (pharma)        │
 │    DEMO-EQP-001  Appasamy Digislit LED Slit Lamp        (equipment)     │
 │    DEMO-MSI-001  Appasamy AMC Kit – Slit Lamp           (msi)           │
 └──────────────────────────────────────────────────────────────────────────┘
*/

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- STEP 1 — DEMO PRODUCTS in product_master
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.product_master (
    productcode, product_name, product_category, product_family,
    product_group, product_subgroup, quota_price__c, unitprice
) VALUES
  ('DEMO-IOL-001','Appasamy AcriView Hydrophilic IOL','IOL','IOL',
   'Foldable IOL','Hydrophilic',850.00,850.00),
  ('DEMO-IOL-002','Appasamy AcriView Hydrophobic IOL','IOL','IOL',
   'Foldable IOL','Hydrophobic',1250.00,1250.00),
  ('DEMO-PHR-001','Appasamy Floxbro Eye Drops 5ml','Pharma','Pharma',
   'Ophthalmic Drops','Antibiotics',125.00,125.00),
  ('DEMO-EQP-001','Appasamy Digislit LED Slit Lamp','Equipment','Equipment',
   'Diagnostic Equipment','Slit Lamp',285000.00,285000.00),
  ('DEMO-MSI-001','Appasamy AMC Kit - Slit Lamp','MSI','MSI',
   'Service Kits','Slit Lamp Service',18500.00,18500.00)
ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 2 — 10 DEMO USERS (full hierarchy)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_auth_users (
    employee_code, username, password_hash, full_name, email, phone,
    role, designation,
    zone_code, zone_name, area_code, area_name,
    territory_code, territory_name,
    reports_to, auth_provider, is_active
) VALUES
  -- 1. Sales Head (org-level, no geography)
  ('DEMO-SH01','demo.rajesh',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Rajesh Kumar','rajesh.demo@appasamy.com','9800000001',
   'sales_head','Vice President - Sales',
   NULL,NULL,NULL,NULL,NULL,NULL,
   NULL,'local',TRUE),

  -- 2. ZBM — Zone-3
  ('DEMO-ZBM01','demo.priya',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Priya Sharma','priya.demo@appasamy.com','9800000002',
   'zbm','Zonal Business Manager',
   'DEMO-Z3','Demo Zone-3',NULL,NULL,NULL,NULL,
   'DEMO-SH01','local',TRUE),

  -- 3. ABM — Bihar
  ('DEMO-ABM01','demo.vikram',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Vikram Singh','vikram.demo@appasamy.com','9800000003',
   'abm','Area Business Manager',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',NULL,NULL,
   'DEMO-ZBM01','local',TRUE),

  -- 4. TBM — Patna-1
  ('DEMO-TBM01','demo.anita',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Anita Patel','anita.demo@appasamy.com','9800000004',
   'tbm','Territory Business Manager',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-ABM01','local',TRUE),

  -- 5. TBM — Patna-2
  ('DEMO-TBM02','demo.ravi',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Ravi Nair','ravi.demo@appasamy.com','9800000005',
   'tbm','Territory Business Manager',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T352','Demo Bihar(Patna)-2',
   'DEMO-ABM01','local',TRUE),

  -- 6. Sales Rep 1 — Patna-1 (all commitments APPROVED)
  ('DEMO-SR01','demo.suresh',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Suresh Reddy','suresh.demo@appasamy.com','9800000006',
   'sales_rep','Sales Representative',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-TBM01','local',TRUE),

  -- 7. Sales Rep 2 — Patna-1 (SUBMITTED + DRAFT mix)
  ('DEMO-SR02','demo.meena',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Meena Gupta','meena.demo@appasamy.com','9800000007',
   'sales_rep','Sales Representative',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-TBM01','local',TRUE),

  -- 8. Sales Rep 3 — TRANSFERRED from Patna-2 → Patna-1
  ('DEMO-SR03','demo.kavita',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Kavita Das','kavita.demo@appasamy.com','9800000008',
   'sales_rep','Sales Representative',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-TBM01','local',TRUE),

  -- 9. IOL Specialist — reports to ABM
  ('DEMO-IOL01','demo.deepak',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Deepak Joshi','deepak.demo@appasamy.com','9800000009',
   'at_iol_specialist','AT IOL Specialist',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-ABM01','local',TRUE),

  -- 10. Admin
  ('DEMO-ADM01','demo.admin',
   '$2b$10$demoHashPlaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
   'Demo Admin','admin.demo@appasamy.com','9800000010',
   'admin','System Administrator',
   NULL,NULL,NULL,NULL,NULL,NULL,
   NULL,'local',TRUE)

ON CONFLICT (employee_code) DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 3 — GEOGRAPHY TARGETS (Top-Down: Zone → Area → Territory)
-- ────────────────────────────────────────────────────────────────────────────

-- ── 3A: ZONE targets (Sales Head → Zone-3, 3 products) ─────────────────

INSERT INTO aop.ts_geography_targets (
    fiscal_year_code, geo_level,
    zone_code, zone_name, area_code, area_name,
    territory_code, territory_name,
    product_code, category_id, monthly_targets,
    set_by_code, set_by_role, status, published_at
) VALUES
  ('FY26_27','zone','DEMO-Z3','Demo Zone-3',NULL,NULL,NULL,NULL,
   'DEMO-IOL-001','iol',
   '{"apr":{"targetQty":500,"targetRev":425000},"may":{"targetQty":550,"targetRev":467500},"jun":{"targetQty":480,"targetRev":408000},"jul":{"targetQty":520,"targetRev":442000},"aug":{"targetQty":600,"targetRev":510000},"sep":{"targetQty":580,"targetRev":493000},"oct":{"targetQty":620,"targetRev":527000},"nov":{"targetQty":650,"targetRev":552500},"dec":{"targetQty":600,"targetRev":510000},"jan":{"targetQty":550,"targetRev":467500},"feb":{"targetQty":580,"targetRev":493000},"mar":{"targetQty":700,"targetRev":595000}}',
   'DEMO-SH01','sales_head','published',NOW()-INTERVAL '15 days'),

  ('FY26_27','zone','DEMO-Z3','Demo Zone-3',NULL,NULL,NULL,NULL,
   'DEMO-PHR-001','pharma',
   '{"apr":{"targetQty":2000,"targetRev":250000},"may":{"targetQty":2200,"targetRev":275000},"jun":{"targetQty":1800,"targetRev":225000},"jul":{"targetQty":2100,"targetRev":262500},"aug":{"targetQty":2400,"targetRev":300000},"sep":{"targetQty":2300,"targetRev":287500},"oct":{"targetQty":2500,"targetRev":312500},"nov":{"targetQty":2600,"targetRev":325000},"dec":{"targetQty":2400,"targetRev":300000},"jan":{"targetQty":2200,"targetRev":275000},"feb":{"targetQty":2300,"targetRev":287500},"mar":{"targetQty":2800,"targetRev":350000}}',
   'DEMO-SH01','sales_head','published',NOW()-INTERVAL '15 days'),

  ('FY26_27','zone','DEMO-Z3','Demo Zone-3',NULL,NULL,NULL,NULL,
   'DEMO-EQP-001','equipment',
   '{"apr":{"targetQty":3,"targetRev":855000},"may":{"targetQty":4,"targetRev":1140000},"jun":{"targetQty":2,"targetRev":570000},"jul":{"targetQty":3,"targetRev":855000},"aug":{"targetQty":4,"targetRev":1140000},"sep":{"targetQty":3,"targetRev":855000},"oct":{"targetQty":5,"targetRev":1425000},"nov":{"targetQty":4,"targetRev":1140000},"dec":{"targetQty":3,"targetRev":855000},"jan":{"targetQty":3,"targetRev":855000},"feb":{"targetQty":4,"targetRev":1140000},"mar":{"targetQty":5,"targetRev":1425000}}',
   'DEMO-SH01','sales_head','published',NOW()-INTERVAL '15 days')

ON CONFLICT DO NOTHING;

-- ── 3B: AREA targets (ZBM → Bihar, 3 products) ─────────────────────────

INSERT INTO aop.ts_geography_targets (
    fiscal_year_code, geo_level,
    zone_code, zone_name, area_code, area_name,
    territory_code, territory_name,
    product_code, category_id, monthly_targets,
    set_by_code, set_by_role, status, published_at
) VALUES
  ('FY26_27','area','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',NULL,NULL,
   'DEMO-IOL-001','iol',
   '{"apr":{"targetQty":200,"targetRev":170000},"may":{"targetQty":220,"targetRev":187000},"jun":{"targetQty":190,"targetRev":161500},"jul":{"targetQty":210,"targetRev":178500},"aug":{"targetQty":240,"targetRev":204000},"sep":{"targetQty":230,"targetRev":195500},"oct":{"targetQty":250,"targetRev":212500},"nov":{"targetQty":260,"targetRev":221000},"dec":{"targetQty":240,"targetRev":204000},"jan":{"targetQty":220,"targetRev":187000},"feb":{"targetQty":230,"targetRev":195500},"mar":{"targetQty":280,"targetRev":238000}}',
   'DEMO-ZBM01','zbm','published',NOW()-INTERVAL '12 days'),

  ('FY26_27','area','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',NULL,NULL,
   'DEMO-PHR-001','pharma',
   '{"apr":{"targetQty":800,"targetRev":100000},"may":{"targetQty":880,"targetRev":110000},"jun":{"targetQty":720,"targetRev":90000},"jul":{"targetQty":840,"targetRev":105000},"aug":{"targetQty":960,"targetRev":120000},"sep":{"targetQty":920,"targetRev":115000},"oct":{"targetQty":1000,"targetRev":125000},"nov":{"targetQty":1040,"targetRev":130000},"dec":{"targetQty":960,"targetRev":120000},"jan":{"targetQty":880,"targetRev":110000},"feb":{"targetQty":920,"targetRev":115000},"mar":{"targetQty":1120,"targetRev":140000}}',
   'DEMO-ZBM01','zbm','published',NOW()-INTERVAL '12 days'),

  ('FY26_27','area','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',NULL,NULL,
   'DEMO-EQP-001','equipment',
   '{"apr":{"targetQty":1,"targetRev":285000},"may":{"targetQty":2,"targetRev":570000},"jun":{"targetQty":1,"targetRev":285000},"jul":{"targetQty":1,"targetRev":285000},"aug":{"targetQty":2,"targetRev":570000},"sep":{"targetQty":1,"targetRev":285000},"oct":{"targetQty":2,"targetRev":570000},"nov":{"targetQty":2,"targetRev":570000},"dec":{"targetQty":1,"targetRev":285000},"jan":{"targetQty":1,"targetRev":285000},"feb":{"targetQty":2,"targetRev":570000},"mar":{"targetQty":2,"targetRev":570000}}',
   'DEMO-ZBM01','zbm','published',NOW()-INTERVAL '12 days')

ON CONFLICT DO NOTHING;

-- ── 3C: TERRITORY targets (ABM → Patna-1 & Patna-2, 5+2 products) ─────

INSERT INTO aop.ts_geography_targets (
    fiscal_year_code, geo_level,
    zone_code, zone_name, area_code, area_name,
    territory_code, territory_name,
    product_code, category_id, monthly_targets,
    set_by_code, set_by_role, status, published_at
) VALUES
  -- Patna-1: IOL Hydrophilic
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-IOL-001','iol',
   '{"apr":{"targetQty":100,"targetRev":85000},"may":{"targetQty":110,"targetRev":93500},"jun":{"targetQty":95,"targetRev":80750},"jul":{"targetQty":105,"targetRev":89250},"aug":{"targetQty":120,"targetRev":102000},"sep":{"targetQty":115,"targetRev":97750},"oct":{"targetQty":125,"targetRev":106250},"nov":{"targetQty":130,"targetRev":110500},"dec":{"targetQty":120,"targetRev":102000},"jan":{"targetQty":110,"targetRev":93500},"feb":{"targetQty":115,"targetRev":97750},"mar":{"targetQty":140,"targetRev":119000}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days'),

  -- Patna-1: IOL Hydrophobic
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-IOL-002','iol',
   '{"apr":{"targetQty":40,"targetRev":50000},"may":{"targetQty":45,"targetRev":56250},"jun":{"targetQty":35,"targetRev":43750},"jul":{"targetQty":42,"targetRev":52500},"aug":{"targetQty":50,"targetRev":62500},"sep":{"targetQty":48,"targetRev":60000},"oct":{"targetQty":55,"targetRev":68750},"nov":{"targetQty":52,"targetRev":65000},"dec":{"targetQty":48,"targetRev":60000},"jan":{"targetQty":45,"targetRev":56250},"feb":{"targetQty":50,"targetRev":62500},"mar":{"targetQty":60,"targetRev":75000}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days'),

  -- Patna-1: Pharma
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-PHR-001','pharma',
   '{"apr":{"targetQty":400,"targetRev":50000},"may":{"targetQty":440,"targetRev":55000},"jun":{"targetQty":360,"targetRev":45000},"jul":{"targetQty":420,"targetRev":52500},"aug":{"targetQty":480,"targetRev":60000},"sep":{"targetQty":460,"targetRev":57500},"oct":{"targetQty":500,"targetRev":62500},"nov":{"targetQty":520,"targetRev":65000},"dec":{"targetQty":480,"targetRev":60000},"jan":{"targetQty":440,"targetRev":55000},"feb":{"targetQty":460,"targetRev":57500},"mar":{"targetQty":560,"targetRev":70000}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days'),

  -- Patna-1: Equipment
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-EQP-001','equipment',
   '{"apr":{"targetQty":1,"targetRev":285000},"may":{"targetQty":1,"targetRev":285000},"jun":{"targetQty":0,"targetRev":0},"jul":{"targetQty":1,"targetRev":285000},"aug":{"targetQty":1,"targetRev":285000},"sep":{"targetQty":0,"targetRev":0},"oct":{"targetQty":1,"targetRev":285000},"nov":{"targetQty":1,"targetRev":285000},"dec":{"targetQty":0,"targetRev":0},"jan":{"targetQty":1,"targetRev":285000},"feb":{"targetQty":1,"targetRev":285000},"mar":{"targetQty":1,"targetRev":285000}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days'),

  -- Patna-1: MSI (Service)
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-MSI-001','msi',
   '{"apr":{"targetQty":2,"targetRev":37000},"may":{"targetQty":2,"targetRev":37000},"jun":{"targetQty":1,"targetRev":18500},"jul":{"targetQty":2,"targetRev":37000},"aug":{"targetQty":2,"targetRev":37000},"sep":{"targetQty":2,"targetRev":37000},"oct":{"targetQty":3,"targetRev":55500},"nov":{"targetQty":2,"targetRev":37000},"dec":{"targetQty":2,"targetRev":37000},"jan":{"targetQty":2,"targetRev":37000},"feb":{"targetQty":2,"targetRev":37000},"mar":{"targetQty":3,"targetRev":55500}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days'),

  -- Patna-2: IOL (for cross-territory comparison)
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T352','Demo Bihar(Patna)-2',
   'DEMO-IOL-001','iol',
   '{"apr":{"targetQty":100,"targetRev":85000},"may":{"targetQty":110,"targetRev":93500},"jun":{"targetQty":95,"targetRev":80750},"jul":{"targetQty":105,"targetRev":89250},"aug":{"targetQty":120,"targetRev":102000},"sep":{"targetQty":115,"targetRev":97750},"oct":{"targetQty":125,"targetRev":106250},"nov":{"targetQty":130,"targetRev":110500},"dec":{"targetQty":120,"targetRev":102000},"jan":{"targetQty":110,"targetRev":93500},"feb":{"targetQty":115,"targetRev":97750},"mar":{"targetQty":140,"targetRev":119000}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days'),

  -- Patna-2: Pharma
  ('FY26_27','territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T352','Demo Bihar(Patna)-2',
   'DEMO-PHR-001','pharma',
   '{"apr":{"targetQty":400,"targetRev":50000},"may":{"targetQty":440,"targetRev":55000},"jun":{"targetQty":360,"targetRev":45000},"jul":{"targetQty":420,"targetRev":52500},"aug":{"targetQty":480,"targetRev":60000},"sep":{"targetQty":460,"targetRev":57500},"oct":{"targetQty":500,"targetRev":62500},"nov":{"targetQty":520,"targetRev":65000},"dec":{"targetQty":480,"targetRev":60000},"jan":{"targetQty":440,"targetRev":55000},"feb":{"targetQty":460,"targetRev":57500},"mar":{"targetQty":560,"targetRev":70000}}',
   'DEMO-ABM01','abm','published',NOW()-INTERVAL '10 days')

ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 4 — EMPLOYEE PRODUCT COMMITMENTS (multiple statuses)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_product_commitments (
    fiscal_year_code, employee_code, employee_role,
    product_code, category_id,
    zone_code, zone_name, area_code, area_name,
    territory_code, territory_name,
    monthly_targets, status, submitted_at, approved_at, approved_by_code
) VALUES

  -- ═══════════════════════════════════════════════════════════════
  --  SURESH REDDY (DEMO-SR01) — 3 products — ALL ✅ APPROVED
  -- ═══════════════════════════════════════════════════════════════

  -- Suresh: IOL Hydrophilic (approved)
  ('FY26_27','DEMO-SR01','sales_rep','DEMO-IOL-001','iol',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   '{"apr":{"lyQty":40,"cyQty":50,"aopQty":55,"lyRev":34000,"cyRev":42500,"aopRev":46750},"may":{"lyQty":42,"cyQty":55,"aopQty":58,"lyRev":35700,"cyRev":46750,"aopRev":49300},"jun":{"lyQty":38,"cyQty":48,"aopQty":50,"lyRev":32300,"cyRev":40800,"aopRev":42500},"jul":{"lyQty":40,"cyQty":52,"aopQty":55,"lyRev":34000,"cyRev":44200,"aopRev":46750},"aug":{"lyQty":45,"cyQty":58,"aopQty":62,"lyRev":38250,"cyRev":49300,"aopRev":52700},"sep":{"lyQty":44,"cyQty":56,"aopQty":60,"lyRev":37400,"cyRev":47600,"aopRev":51000},"oct":{"lyQty":48,"cyQty":62,"aopQty":65,"lyRev":40800,"cyRev":52700,"aopRev":55250},"nov":{"lyQty":50,"cyQty":65,"aopQty":68,"lyRev":42500,"cyRev":55250,"aopRev":57800},"dec":{"lyQty":46,"cyQty":58,"aopQty":62,"lyRev":39100,"cyRev":49300,"aopRev":52700},"jan":{"lyQty":42,"cyQty":55,"aopQty":58,"lyRev":35700,"cyRev":46750,"aopRev":49300},"feb":{"lyQty":44,"cyQty":56,"aopQty":60,"lyRev":37400,"cyRev":47600,"aopRev":51000},"mar":{"lyQty":52,"cyQty":68,"aopQty":72,"lyRev":44200,"cyRev":57800,"aopRev":61200}}',
   'approved',NOW()-INTERVAL '7 days',NOW()-INTERVAL '5 days','DEMO-TBM01'),

  -- Suresh: Pharma (approved)
  ('FY26_27','DEMO-SR01','sales_rep','DEMO-PHR-001','pharma',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   '{"apr":{"lyQty":150,"cyQty":200,"aopQty":210,"lyRev":18750,"cyRev":25000,"aopRev":26250},"may":{"lyQty":160,"cyQty":220,"aopQty":230,"lyRev":20000,"cyRev":27500,"aopRev":28750},"jun":{"lyQty":140,"cyQty":180,"aopQty":190,"lyRev":17500,"cyRev":22500,"aopRev":23750},"jul":{"lyQty":155,"cyQty":210,"aopQty":220,"lyRev":19375,"cyRev":26250,"aopRev":27500},"aug":{"lyQty":170,"cyQty":240,"aopQty":250,"lyRev":21250,"cyRev":30000,"aopRev":31250},"sep":{"lyQty":165,"cyQty":230,"aopQty":240,"lyRev":20625,"cyRev":28750,"aopRev":30000},"oct":{"lyQty":180,"cyQty":250,"aopQty":260,"lyRev":22500,"cyRev":31250,"aopRev":32500},"nov":{"lyQty":185,"cyQty":260,"aopQty":270,"lyRev":23125,"cyRev":32500,"aopRev":33750},"dec":{"lyQty":170,"cyQty":240,"aopQty":250,"lyRev":21250,"cyRev":30000,"aopRev":31250},"jan":{"lyQty":160,"cyQty":220,"aopQty":230,"lyRev":20000,"cyRev":27500,"aopRev":28750},"feb":{"lyQty":165,"cyQty":230,"aopQty":240,"lyRev":20625,"cyRev":28750,"aopRev":30000},"mar":{"lyQty":195,"cyQty":280,"aopQty":290,"lyRev":24375,"cyRev":35000,"aopRev":36250}}',
   'approved',NOW()-INTERVAL '7 days',NOW()-INTERVAL '5 days','DEMO-TBM01'),

  -- Suresh: Equipment (corrected_and_approved — TBM bumped Jul from 0→1)
  ('FY26_27','DEMO-SR01','sales_rep','DEMO-EQP-001','equipment',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   '{"apr":{"lyQty":0,"cyQty":1,"aopQty":1,"lyRev":0,"cyRev":285000,"aopRev":285000},"may":{"lyQty":1,"cyQty":1,"aopQty":1,"lyRev":285000,"cyRev":285000,"aopRev":285000},"jun":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"jul":{"lyQty":0,"cyQty":0,"aopQty":1,"lyRev":0,"cyRev":0,"aopRev":285000},"aug":{"lyQty":1,"cyQty":1,"aopQty":1,"lyRev":285000,"cyRev":285000,"aopRev":285000},"sep":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"oct":{"lyQty":0,"cyQty":1,"aopQty":1,"lyRev":0,"cyRev":285000,"aopRev":285000},"nov":{"lyQty":1,"cyQty":1,"aopQty":1,"lyRev":285000,"cyRev":285000,"aopRev":285000},"dec":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"jan":{"lyQty":0,"cyQty":1,"aopQty":1,"lyRev":0,"cyRev":285000,"aopRev":285000},"feb":{"lyQty":1,"cyQty":1,"aopQty":1,"lyRev":285000,"cyRev":285000,"aopRev":285000},"mar":{"lyQty":0,"cyQty":1,"aopQty":1,"lyRev":0,"cyRev":285000,"aopRev":285000}}',
   'approved',NOW()-INTERVAL '7 days',NOW()-INTERVAL '5 days','DEMO-TBM01'),

  -- ═══════════════════════════════════════════════════════════════
  --  MEENA GUPTA (DEMO-SR02) — ⏳ SUBMITTED + 📝 DRAFT
  -- ═══════════════════════════════════════════════════════════════

  -- Meena: IOL (submitted — pending TBM approval)
  ('FY26_27','DEMO-SR02','sales_rep','DEMO-IOL-001','iol',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   '{"apr":{"lyQty":30,"cyQty":40,"aopQty":45,"lyRev":25500,"cyRev":34000,"aopRev":38250},"may":{"lyQty":32,"cyQty":42,"aopQty":48,"lyRev":27200,"cyRev":35700,"aopRev":40800},"jun":{"lyQty":28,"cyQty":38,"aopQty":42,"lyRev":23800,"cyRev":32300,"aopRev":35700},"jul":{"lyQty":30,"cyQty":40,"aopQty":46,"lyRev":25500,"cyRev":34000,"aopRev":39100},"aug":{"lyQty":35,"cyQty":48,"aopQty":52,"lyRev":29750,"cyRev":40800,"aopRev":44200},"sep":{"lyQty":34,"cyQty":46,"aopQty":50,"lyRev":28900,"cyRev":39100,"aopRev":42500},"oct":{"lyQty":38,"cyQty":50,"aopQty":55,"lyRev":32300,"cyRev":42500,"aopRev":46750},"nov":{"lyQty":40,"cyQty":52,"aopQty":56,"lyRev":34000,"cyRev":44200,"aopRev":47600},"dec":{"lyQty":36,"cyQty":48,"aopQty":52,"lyRev":30600,"cyRev":40800,"aopRev":44200},"jan":{"lyQty":32,"cyQty":42,"aopQty":48,"lyRev":27200,"cyRev":35700,"aopRev":40800},"feb":{"lyQty":34,"cyQty":46,"aopQty":50,"lyRev":28900,"cyRev":39100,"aopRev":42500},"mar":{"lyQty":42,"cyQty":55,"aopQty":60,"lyRev":35700,"cyRev":46750,"aopRev":51000}}',
   'submitted',NOW()-INTERVAL '3 days',NULL,NULL),

  -- Meena: Pharma (draft — only 3 months filled)
  ('FY26_27','DEMO-SR02','sales_rep','DEMO-PHR-001','pharma',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   '{"apr":{"lyQty":120,"cyQty":160,"aopQty":170,"lyRev":15000,"cyRev":20000,"aopRev":21250},"may":{"lyQty":130,"cyQty":175,"aopQty":185,"lyRev":16250,"cyRev":21875,"aopRev":23125},"jun":{"lyQty":110,"cyQty":145,"aopQty":155,"lyRev":13750,"cyRev":18125,"aopRev":19375},"jul":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"aug":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"sep":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"oct":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"nov":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"dec":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"jan":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"feb":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0},"mar":{"lyQty":0,"cyQty":0,"aopQty":0,"lyRev":0,"cyRev":0,"aopRev":0}}',
   'draft',NULL,NULL,NULL),

  -- ═══════════════════════════════════════════════════════════════
  --  DEEPAK JOSHI (DEMO-IOL01) — IOL Specialist — 📝 DRAFT
  -- ═══════════════════════════════════════════════════════════════

  -- Deepak: Hydrophobic IOL (specialist niche — draft)
  ('FY26_27','DEMO-IOL01','at_iol_specialist','DEMO-IOL-002','iol',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   '{"apr":{"lyQty":15,"cyQty":22,"aopQty":25,"lyRev":18750,"cyRev":27500,"aopRev":31250},"may":{"lyQty":16,"cyQty":24,"aopQty":28,"lyRev":20000,"cyRev":30000,"aopRev":35000},"jun":{"lyQty":14,"cyQty":20,"aopQty":22,"lyRev":17500,"cyRev":25000,"aopRev":27500},"jul":{"lyQty":15,"cyQty":22,"aopQty":26,"lyRev":18750,"cyRev":27500,"aopRev":32500},"aug":{"lyQty":18,"cyQty":28,"aopQty":30,"lyRev":22500,"cyRev":35000,"aopRev":37500},"sep":{"lyQty":17,"cyQty":26,"aopQty":28,"lyRev":21250,"cyRev":32500,"aopRev":35000},"oct":{"lyQty":20,"cyQty":30,"aopQty":34,"lyRev":25000,"cyRev":37500,"aopRev":42500},"nov":{"lyQty":19,"cyQty":28,"aopQty":32,"lyRev":23750,"cyRev":35000,"aopRev":40000},"dec":{"lyQty":17,"cyQty":26,"aopQty":28,"lyRev":21250,"cyRev":32500,"aopRev":35000},"jan":{"lyQty":16,"cyQty":24,"aopQty":28,"lyRev":20000,"cyRev":30000,"aopRev":35000},"feb":{"lyQty":17,"cyQty":26,"aopQty":30,"lyRev":21250,"cyRev":32500,"aopRev":37500},"mar":{"lyQty":22,"cyQty":32,"aopQty":36,"lyRev":27500,"cyRev":40000,"aopRev":45000}}',
   'draft',NULL,NULL,NULL),

  -- ═══════════════════════════════════════════════════════════════
  --  KAVITA DAS (DEMO-SR03) — 🔄 OLD commitment stays with Patna-2
  --  (She transferred to Patna-1 but this record is geography-bound!)
  -- ═══════════════════════════════════════════════════════════════

  -- Kavita: IOL (approved BEFORE transfer — territory_code = DEMO-T352 i.e. Patna-2!)
  ('FY26_27','DEMO-SR03','sales_rep','DEMO-IOL-001','iol',
   'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T352','Demo Bihar(Patna)-2',
   '{"apr":{"lyQty":35,"cyQty":45,"aopQty":50,"lyRev":29750,"cyRev":38250,"aopRev":42500},"may":{"lyQty":38,"cyQty":48,"aopQty":52,"lyRev":32300,"cyRev":40800,"aopRev":44200},"jun":{"lyQty":32,"cyQty":42,"aopQty":45,"lyRev":27200,"cyRev":35700,"aopRev":38250},"jul":{"lyQty":36,"cyQty":46,"aopQty":50,"lyRev":30600,"cyRev":39100,"aopRev":42500},"aug":{"lyQty":40,"cyQty":52,"aopQty":56,"lyRev":34000,"cyRev":44200,"aopRev":47600},"sep":{"lyQty":38,"cyQty":50,"aopQty":54,"lyRev":32300,"cyRev":42500,"aopRev":45900},"oct":{"lyQty":42,"cyQty":55,"aopQty":60,"lyRev":35700,"cyRev":46750,"aopRev":51000},"nov":{"lyQty":44,"cyQty":58,"aopQty":62,"lyRev":37400,"cyRev":49300,"aopRev":52700},"dec":{"lyQty":40,"cyQty":52,"aopQty":56,"lyRev":34000,"cyRev":44200,"aopRev":47600},"jan":{"lyQty":36,"cyQty":48,"aopQty":52,"lyRev":30600,"cyRev":40800,"aopRev":44200},"feb":{"lyQty":38,"cyQty":50,"aopQty":54,"lyRev":32300,"cyRev":42500,"aopRev":45900},"mar":{"lyQty":46,"cyQty":60,"aopQty":65,"lyRev":39100,"cyRev":51000,"aopRev":55250}}',
   'approved',NOW()-INTERVAL '20 days',NOW()-INTERVAL '18 days','DEMO-TBM02')

ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 5 — APPROVAL AUDIT TRAIL
-- ────────────────────────────────────────────────────────────────────────────

-- Suresh IOL — approved
INSERT INTO aop.ts_commitment_approvals (commitment_id,action,actor_code,actor_role,corrections,original_values,comments)
SELECT id,'approved','DEMO-TBM01','tbm',NULL,NULL,'Good numbers. IOL growth looks solid for Patna-1.'
FROM aop.ts_product_commitments WHERE employee_code='DEMO-SR01' AND product_code='DEMO-IOL-001' AND fiscal_year_code='FY26_27' LIMIT 1;

-- Suresh Pharma — approved
INSERT INTO aop.ts_commitment_approvals (commitment_id,action,actor_code,actor_role,corrections,original_values,comments)
SELECT id,'approved','DEMO-TBM01','tbm',NULL,NULL,'Pharma targets aligned with territory potential.'
FROM aop.ts_product_commitments WHERE employee_code='DEMO-SR01' AND product_code='DEMO-PHR-001' AND fiscal_year_code='FY26_27' LIMIT 1;

-- Suresh Equipment — CORRECTED by TBM (bumped Jul from 0→1 due to hospital tender)
INSERT INTO aop.ts_commitment_approvals (commitment_id,action,actor_code,actor_role,corrections,original_values,comments)
SELECT id,'corrected_and_approved','DEMO-TBM01','tbm',
       '{"jul":{"aopQty":1,"aopRev":285000}}',
       '{"jul":{"aopQty":0,"aopRev":0}}',
       'Corrected Jul — confirmed hospital tender for Q2. Adding 1 slit lamp.'
FROM aop.ts_product_commitments WHERE employee_code='DEMO-SR01' AND product_code='DEMO-EQP-001' AND fiscal_year_code='FY26_27' LIMIT 1;

-- Meena IOL — submitted (pending)
INSERT INTO aop.ts_commitment_approvals (commitment_id,action,actor_code,actor_role,corrections,original_values,comments)
SELECT id,'submitted','DEMO-SR02','sales_rep',NULL,NULL,'Submitting IOL targets for review.'
FROM aop.ts_product_commitments WHERE employee_code='DEMO-SR02' AND product_code='DEMO-IOL-001' AND fiscal_year_code='FY26_27' LIMIT 1;

-- Kavita IOL — approved by old TBM before transfer
INSERT INTO aop.ts_commitment_approvals (commitment_id,action,actor_code,actor_role,corrections,original_values,comments)
SELECT id,'approved','DEMO-TBM02','tbm',NULL,NULL,'Approved before territory reassignment.'
FROM aop.ts_product_commitments WHERE employee_code='DEMO-SR03' AND product_code='DEMO-IOL-001' AND fiscal_year_code='FY26_27' LIMIT 1;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 6 — EMPLOYEE TRANSFER LOG (Kavita: Patna-2 → Patna-1)
--          ★ KEY FEATURE: geography-bound targets stay put
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_employee_territory_log (
    employee_code, fiscal_year_code,
    prev_zone_code, prev_zone_name, prev_area_code, prev_area_name,
    prev_territory_code, prev_territory_name, prev_reports_to,
    new_zone_code, new_zone_name, new_area_code, new_area_name,
    new_territory_code, new_territory_name, new_reports_to,
    transferred_by, transfer_reason, effective_date
) VALUES (
    'DEMO-SR03','FY26_27',
    'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
    'DEMO-T352','Demo Bihar(Patna)-2','DEMO-TBM02',
    'DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
    'DEMO-T351','Demo Bihar(Patna)-1','DEMO-TBM01',
    'DEMO-ADM01','Territory rebalancing - Patna-2 overstaffed after hospital closure',
    '2026-06-15'
);


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 7 — YEARLY TARGET ASSIGNMENTS (top-down allocation)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_yearly_target_assignments (
    fiscal_year_code, manager_code, manager_role,
    geo_level, zone_code, zone_name, area_code, area_name,
    territory_code, territory_name,
    assignee_code, assignee_role,
    ly_target_qty, ly_achieved_qty, ly_target_value, ly_achieved_value,
    cy_target_qty, cy_target_value,
    category_breakdown, status, published_at
) VALUES
  -- Sales Head → Zone-3
  ('FY26_27','DEMO-SH01','sales_head',
   'zone','DEMO-Z3','Demo Zone-3',NULL,NULL,NULL,NULL,
   'DEMO-ZBM01','zbm',
   6930,6245,5890000.00,5312500.00,7930,6740500.00,
   '[{"category":"iol","targetQty":6930,"targetRev":5890500},{"category":"pharma","targetQty":27600,"targetRev":3450000},{"category":"equipment","targetQty":43,"targetRev":12255000}]',
   'published',NOW()-INTERVAL '15 days'),

  -- ZBM → Bihar area
  ('FY26_27','DEMO-ZBM01','zbm',
   'area','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',NULL,NULL,
   'DEMO-ABM01','abm',
   2770,2494,2354500.00,2119050.00,2770,2354500.00,
   '[{"category":"iol","targetQty":2770,"targetRev":2354500},{"category":"pharma","targetQty":11040,"targetRev":1380000},{"category":"equipment","targetQty":18,"targetRev":5130000}]',
   'published',NOW()-INTERVAL '12 days'),

  -- ABM → Patna-1
  ('FY26_27','DEMO-ABM01','abm',
   'territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T351','Demo Bihar(Patna)-1',
   'DEMO-TBM01','tbm',
   1385,1247,1177250.00,1059525.00,1385,1177250.00,
   '[{"category":"iol","targetQty":1385,"targetRev":1177250},{"category":"pharma","targetQty":5520,"targetRev":690000},{"category":"equipment","targetQty":8,"targetRev":2280000},{"category":"msi","targetQty":25,"targetRev":462500}]',
   'published',NOW()-INTERVAL '10 days'),

  -- ABM → Patna-2
  ('FY26_27','DEMO-ABM01','abm',
   'territory','DEMO-Z3','Demo Zone-3','DEMO-A35','Demo Bihar',
   'DEMO-T352','Demo Bihar(Patna)-2',
   'DEMO-TBM02','tbm',
   1385,1247,1177250.00,1059525.00,1385,1177250.00,
   '[{"category":"iol","targetQty":1385,"targetRev":1177250},{"category":"pharma","targetQty":5520,"targetRev":690000}]',
   'published',NOW()-INTERVAL '10 days')

ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 8 — TEAM PRODUCT TARGETS (TBM assigns to individual SRs)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_team_product_targets (
    fiscal_year_code, manager_code, manager_role,
    zone_code, area_code, territory_code,
    member_code, product_code, category_id,
    monthly_targets, status, assigned_at
) VALUES
  -- TBM assigns IOL → Suresh
  ('FY26_27','DEMO-TBM01','tbm','DEMO-Z3','DEMO-A35','DEMO-T351',
   'DEMO-SR01','DEMO-IOL-001','iol',
   '{"apr":{"targetQty":55,"targetRev":46750},"may":{"targetQty":58,"targetRev":49300},"jun":{"targetQty":50,"targetRev":42500},"jul":{"targetQty":55,"targetRev":46750},"aug":{"targetQty":62,"targetRev":52700},"sep":{"targetQty":60,"targetRev":51000},"oct":{"targetQty":65,"targetRev":55250},"nov":{"targetQty":68,"targetRev":57800},"dec":{"targetQty":62,"targetRev":52700},"jan":{"targetQty":58,"targetRev":49300},"feb":{"targetQty":60,"targetRev":51000},"mar":{"targetQty":72,"targetRev":61200}}',
   'published',NOW()-INTERVAL '8 days'),

  -- TBM assigns IOL → Meena
  ('FY26_27','DEMO-TBM01','tbm','DEMO-Z3','DEMO-A35','DEMO-T351',
   'DEMO-SR02','DEMO-IOL-001','iol',
   '{"apr":{"targetQty":45,"targetRev":38250},"may":{"targetQty":48,"targetRev":40800},"jun":{"targetQty":42,"targetRev":35700},"jul":{"targetQty":46,"targetRev":39100},"aug":{"targetQty":52,"targetRev":44200},"sep":{"targetQty":50,"targetRev":42500},"oct":{"targetQty":55,"targetRev":46750},"nov":{"targetQty":56,"targetRev":47600},"dec":{"targetQty":52,"targetRev":44200},"jan":{"targetQty":48,"targetRev":40800},"feb":{"targetQty":50,"targetRev":42500},"mar":{"targetQty":60,"targetRev":51000}}',
   'published',NOW()-INTERVAL '8 days'),

  -- TBM assigns Pharma → Suresh
  ('FY26_27','DEMO-TBM01','tbm','DEMO-Z3','DEMO-A35','DEMO-T351',
   'DEMO-SR01','DEMO-PHR-001','pharma',
   '{"apr":{"targetQty":210,"targetRev":26250},"may":{"targetQty":230,"targetRev":28750},"jun":{"targetQty":190,"targetRev":23750},"jul":{"targetQty":220,"targetRev":27500},"aug":{"targetQty":250,"targetRev":31250},"sep":{"targetQty":240,"targetRev":30000},"oct":{"targetQty":260,"targetRev":32500},"nov":{"targetQty":270,"targetRev":33750},"dec":{"targetQty":250,"targetRev":31250},"jan":{"targetQty":230,"targetRev":28750},"feb":{"targetQty":240,"targetRev":30000},"mar":{"targetQty":290,"targetRev":36250}}',
   'published',NOW()-INTERVAL '8 days')

ON CONFLICT DO NOTHING;


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 9 — AUDIT LOG (key actions)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_audit_log (actor_code,actor_role,action,entity_type,detail) VALUES
  ('DEMO-SH01','sales_head','PUBLISH_ZONE_TARGET','ts_geography_targets',
   '{"zone":"DEMO-Z3","products":3,"fiscal_year":"FY26_27"}'),
  ('DEMO-ZBM01','zbm','PUBLISH_AREA_TARGET','ts_geography_targets',
   '{"area":"DEMO-A35","products":3,"fiscal_year":"FY26_27"}'),
  ('DEMO-ABM01','abm','PUBLISH_TERRITORY_TARGET','ts_geography_targets',
   '{"territory":"DEMO-T351","products":5,"fiscal_year":"FY26_27"}'),
  ('DEMO-SR01','sales_rep','SUBMIT_COMMITMENT','ts_product_commitments',
   '{"products":["DEMO-IOL-001","DEMO-PHR-001","DEMO-EQP-001"],"territory":"DEMO-T351"}'),
  ('DEMO-TBM01','tbm','APPROVE_COMMITMENT','ts_product_commitments',
   '{"employee":"DEMO-SR01","products_approved":3}'),
  ('DEMO-TBM01','tbm','CORRECT_AND_APPROVE','ts_product_commitments',
   '{"employee":"DEMO-SR01","product":"DEMO-EQP-001","correction":"Jul aopQty 0 to 1"}'),
  ('DEMO-SR02','sales_rep','SUBMIT_COMMITMENT','ts_product_commitments',
   '{"product":"DEMO-IOL-001","territory":"DEMO-T351"}'),
  ('DEMO-ADM01','admin','TRANSFER_EMPLOYEE','ts_employee_territory_log',
   '{"employee":"DEMO-SR03","from":"DEMO-T352","to":"DEMO-T351","reason":"Territory rebalancing"}');


-- ────────────────────────────────────────────────────────────────────────────
-- STEP 10 — NOTIFICATIONS (activity feed)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO aop.ts_notifications (user_id,title,message,type,related_entity,is_read) VALUES
  -- TBM Anita — has pending approval action
  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-TBM01'),
   'Commitment Submitted',
   'Meena Gupta submitted IOL commitments for your review.',
   'action_required','ts_product_commitments',FALSE),

  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-TBM01'),
   'Commitments Approved',
   'You approved all 3 commitments from Suresh Reddy.',
   'success','ts_product_commitments',TRUE),

  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-TBM01'),
   'Target Corrected',
   'You corrected Suresh Reddy Equipment commitment (Jul: 0 → 1 unit).',
   'success','ts_product_commitments',TRUE),

  -- SR Suresh — got approved
  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-SR01'),
   'Commitments Approved',
   'Your IOL and Pharma commitments were approved by Anita Patel.',
   'success','ts_product_commitments',TRUE),

  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-SR01'),
   'Equipment Corrected',
   'Your Equipment commitment was corrected and approved. Jul target adjusted to 1 unit.',
   'warning','ts_product_commitments',FALSE),

  -- SR Meena — submitted, waiting
  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-SR02'),
   'Commitment Submitted',
   'Your IOL commitment has been submitted and is pending approval.',
   'info','ts_product_commitments',TRUE),

  -- ABM Vikram — territory targets published
  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-ABM01'),
   'Territory Targets Published',
   'You published targets for Demo Bihar(Patna)-1 covering 5 products.',
   'success','ts_geography_targets',TRUE),

  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-ABM01'),
   'New Team Member',
   'Kavita Das transferred to Demo Bihar(Patna)-1 from Demo Bihar(Patna)-2.',
   'info','ts_employee_territory_log',FALSE),

  -- SR Kavita — transfer notification
  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-SR03'),
   'Territory Reassignment',
   'You have been transferred to Demo Bihar(Patna)-1. Your previous Patna-2 commitments remain unchanged.',
   'warning','ts_employee_territory_log',FALSE),

  -- ZBM Priya
  ((SELECT id FROM aop.ts_auth_users WHERE employee_code='DEMO-ZBM01'),
   'Area Targets Published',
   'Area targets for Demo Bihar published successfully (3 products).',
   'success','ts_geography_targets',TRUE);


COMMIT;


-- ════════════════════════════════════════════════════════════════════════════
-- VERIFICATION QUERIES (run after insert to confirm everything works)
-- ════════════════════════════════════════════════════════════════════════════

/*

-- 1) All demo users with hierarchy
SELECT employee_code, full_name, role, territory_name, reports_to
FROM aop.ts_auth_users WHERE employee_code LIKE 'DEMO-%'
ORDER BY CASE role
    WHEN 'sales_head' THEN 1 WHEN 'zbm' THEN 2 WHEN 'abm' THEN 3
    WHEN 'tbm' THEN 4 WHEN 'sales_rep' THEN 5 ELSE 6 END;

-- 2) Target cascade: Zone → Area → Territory
SELECT geo_level, zone_name, area_name, territory_name, product_code, status
FROM aop.ts_geography_targets WHERE zone_code = 'DEMO-Z3'
ORDER BY geo_level, territory_code NULLS FIRST, product_code;

-- 3) Commitment statuses across employees
SELECT pc.employee_code, u.full_name, pc.product_code, pc.status,
       pc.territory_name AS "commitment_territory"
FROM aop.ts_product_commitments pc
JOIN aop.ts_auth_users u ON u.employee_code = pc.employee_code
WHERE pc.employee_code LIKE 'DEMO-%'
ORDER BY pc.status DESC, pc.employee_code;

-- 4) ★ KEY DEMO: Kavita's auth shows Patna-1 but commitment stays with Patna-2
SELECT u.employee_code, u.full_name,
       u.territory_name AS "current_territory",
       pc.territory_name AS "commitment_territory",
       pc.status
FROM aop.ts_auth_users u
LEFT JOIN aop.ts_product_commitments pc ON pc.employee_code = u.employee_code
WHERE u.employee_code = 'DEMO-SR03';

-- 5) Transfer audit trail
SELECT employee_code, prev_territory_name, new_territory_name,
       transfer_reason, effective_date
FROM aop.ts_employee_territory_log WHERE employee_code LIKE 'DEMO-%';

-- 6) Approval trail with corrections
SELECT ca.action, ca.actor_code, ca.comments,
       ca.corrections, ca.original_values
FROM aop.ts_commitment_approvals ca
WHERE ca.actor_code LIKE 'DEMO-%'
ORDER BY ca.created_at;

-- 7) Unread notifications
SELECT u.full_name, n.title, n.type, n.is_read
FROM aop.ts_notifications n
JOIN aop.ts_auth_users u ON u.id = n.user_id
WHERE u.employee_code LIKE 'DEMO-%' AND n.is_read = FALSE;

-- 8) Territory target vs commitments gap (using the function)
-- SELECT * FROM aop.ts_fn_territory_target_vs_commitments('DEMO-T351', 'FY26_27');

*/


-- ████████████████████████████████████████████████████████████████████████████
--
--  PART 2 ─── DELETE ALL DEMO DATA (run AFTER demo)
--
--  ⚠️  ORDER MATTERS — child tables first, then parents
--  ⚠️  Uncomment the block below and run it
--
-- ████████████████████████████████████████████████████████████████████████████

/*
-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  UNCOMMENT THIS ENTIRE BLOCK AND RUN TO CLEAN UP DEMO DATA        ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- 1. Notifications (FK → ts_auth_users)
DELETE FROM aop.ts_notifications
WHERE user_id IN (SELECT id FROM aop.ts_auth_users WHERE employee_code LIKE 'DEMO-%');

-- 2. Audit log
DELETE FROM aop.ts_audit_log WHERE actor_code LIKE 'DEMO-%';

-- 3. Commitment approvals (FK → ts_product_commitments)
DELETE FROM aop.ts_commitment_approvals
WHERE commitment_id IN (
    SELECT id FROM aop.ts_product_commitments WHERE employee_code LIKE 'DEMO-%'
);

-- 4. Product commitments
DELETE FROM aop.ts_product_commitments WHERE employee_code LIKE 'DEMO-%';

-- 5. Team product targets
DELETE FROM aop.ts_team_product_targets WHERE manager_code LIKE 'DEMO-%';

-- 6. Yearly target assignments
DELETE FROM aop.ts_yearly_target_assignments WHERE manager_code LIKE 'DEMO-%';

-- 7. Geography targets (all levels)
DELETE FROM aop.ts_geography_targets WHERE zone_code = 'DEMO-Z3';

-- 8. Employee territory transfer log
DELETE FROM aop.ts_employee_territory_log WHERE employee_code LIKE 'DEMO-%';

-- 9. User sessions (if any were created during demo)
DELETE FROM aop.ts_user_sessions
WHERE user_id IN (SELECT id FROM aop.ts_auth_users WHERE employee_code LIKE 'DEMO-%');

-- 10. Auth users (the 10 demo users)
DELETE FROM aop.ts_auth_users WHERE employee_code LIKE 'DEMO-%';

-- 11. Demo products
DELETE FROM aop.product_master WHERE productcode LIKE 'DEMO-%';

COMMIT;

-- Verify everything is gone (all should return 0)
SELECT 'ts_auth_users' AS tbl, COUNT(*) AS remaining FROM aop.ts_auth_users WHERE employee_code LIKE 'DEMO-%'
UNION ALL SELECT 'product_master', COUNT(*) FROM aop.product_master WHERE productcode LIKE 'DEMO-%'
UNION ALL SELECT 'ts_geography_targets', COUNT(*) FROM aop.ts_geography_targets WHERE zone_code = 'DEMO-Z3'
UNION ALL SELECT 'ts_product_commitments', COUNT(*) FROM aop.ts_product_commitments WHERE employee_code LIKE 'DEMO-%'
UNION ALL SELECT 'ts_commitment_approvals', COUNT(*) FROM aop.ts_commitment_approvals WHERE actor_code LIKE 'DEMO-%'
UNION ALL SELECT 'ts_yearly_target_assignments', COUNT(*) FROM aop.ts_yearly_target_assignments WHERE manager_code LIKE 'DEMO-%'
UNION ALL SELECT 'ts_team_product_targets', COUNT(*) FROM aop.ts_team_product_targets WHERE manager_code LIKE 'DEMO-%'
UNION ALL SELECT 'ts_employee_territory_log', COUNT(*) FROM aop.ts_employee_territory_log WHERE employee_code LIKE 'DEMO-%'
UNION ALL SELECT 'ts_audit_log', COUNT(*) FROM aop.ts_audit_log WHERE actor_code LIKE 'DEMO-%';

*/

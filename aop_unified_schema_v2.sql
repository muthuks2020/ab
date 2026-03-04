

BEGIN;

-- ============================================================================
-- 0. EXTENSIONS & SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS aop;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. ENUM TYPES (in aop schema)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE aop.ts_user_role AS ENUM (
    'sales_rep', 'tbm', 'abm', 'zbm', 'sales_head',
    'at_iol_manager', 'at_iol_specialist',
    'eq_mgr_diagnostic', 'eq_mgr_surgical',
    'eq_spec_diagnostic', 'eq_spec_surgical',
    'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE aop.ts_commitment_status AS ENUM (
    'not_started', 'draft', 'submitted', 'approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE aop.ts_assignment_status AS ENUM (
    'not_set', 'draft', 'published'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE aop.ts_approval_action AS ENUM (
    'submitted', 'approved', 'corrected_and_approved', 'bulk_approved'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE aop.ts_auth_provider_type AS ENUM (
    'local', 'azure_ad', 'both'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Geography level enum for geography_targets
DO $$ BEGIN
  CREATE TYPE aop.ts_geo_level AS ENUM (
    'zone', 'area', 'territory'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 1b. EXISTING AOP TABLE — product_master (Salesforce Source)
--
--     This table normally exists from Salesforce sync. Created here with
--     IF NOT EXISTS so the schema can run on a fresh/demo database.
--     All ts_ tables JOIN to this for product names, categories, prices.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.product_master (
    id                  BIGSERIAL    PRIMARY KEY,
    productcode         TEXT         NOT NULL UNIQUE,            -- 'AA 7205 25' (the JOIN key)
    product_name        TEXT,
    product_id          TEXT,                                    -- Salesforce record ID
    product_db_id__c    TEXT,                                    -- Salesforce DB ID
    product_category    TEXT,                                    -- 'IOL', 'Equipment', 'Pharma', etc.
    product_family      TEXT,
    product_group       TEXT,
    product_subgroup    TEXT,
    quota_price__c      NUMERIC(18,2),                          -- Primary price for target calc
    unitprice           NUMERIC(18,2),                          -- Fallback price
    isactive            BOOLEAN      DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_code     ON aop.product_master(productcode);
CREATE INDEX IF NOT EXISTS idx_pm_category ON aop.product_master(product_category);
CREATE INDEX IF NOT EXISTS idx_pm_active   ON aop.product_master(isactive) WHERE isactive = TRUE;

COMMENT ON TABLE aop.product_master IS
'Product catalog from Salesforce. 30K+ products.
All ts_ tables store only product_code and JOIN here for names/prices/categories.
quota_price__c is preferred price; unitprice is fallback.';

-- ============================================================================
-- 2. ts_fiscal_years — Indian Fiscal Year (Apr–Mar)
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_fiscal_years (
    id                  SERIAL PRIMARY KEY,
    code                VARCHAR(20)  NOT NULL UNIQUE,          -- 'FY26_27'
    label               VARCHAR(20)  NOT NULL,                 -- '2026-27'
    start_date          DATE         NOT NULL,                 -- Apr 1
    end_date            DATE         NOT NULL,                 -- Mar 31
    is_active           BOOLEAN      NOT NULL DEFAULT FALSE,
    is_commitment_open  BOOLEAN      NOT NULL DEFAULT FALSE,
    commitment_deadline TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE aop.ts_fiscal_years IS
'Indian fiscal year config. Apr→Mar. is_commitment_open controls target entry window.';

INSERT INTO aop.ts_fiscal_years (code, label, start_date, end_date, is_active, is_commitment_open)
VALUES
    ('FY23_24', '2023-24', '2023-04-01', '2024-03-31', FALSE, FALSE),
    ('FY24_25', '2024-25', '2024-04-01', '2025-03-31', FALSE, FALSE),
    ('FY25_26', '2025-26', '2025-04-01', '2026-03-31', FALSE, FALSE),
    ('FY26_27', '2026-27', '2026-04-01', '2027-03-31', TRUE,  TRUE )
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- 3. ts_user_roles — Role Configuration & Permissions
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_user_roles (
    id                  SERIAL       PRIMARY KEY,
    role_code           VARCHAR(30)  NOT NULL UNIQUE,
    role_name           VARCHAR(100) NOT NULL,
    reporting_to        VARCHAR(30),
    hierarchy_level     INTEGER      NOT NULL DEFAULT 0,
    can_enter_value     BOOLEAN      NOT NULL DEFAULT FALSE,
    can_enter_sales     BOOLEAN      NOT NULL DEFAULT FALSE,
    can_approve         BOOLEAN      NOT NULL DEFAULT FALSE,
    is_specialist       BOOLEAN      NOT NULL DEFAULT FALSE,
    is_manager_role     BOOLEAN      NOT NULL DEFAULT FALSE,
    description         VARCHAR(255),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE aop.ts_user_roles IS
'Role config with hierarchy chain & permission flags. role_code matches ts_user_role ENUM.';

INSERT INTO aop.ts_user_roles
    (role_code, role_name, reporting_to, hierarchy_level,
     can_enter_value, can_enter_sales, can_approve,
     is_specialist, is_manager_role, description)
VALUES
    ('sales_rep',        'Sales Representative',              'tbm',        0,
     TRUE,  TRUE,  FALSE, FALSE, FALSE, 'Field sales. Enters product commitments. Reports to TBM.'),
    ('tbm',              'Territory Business Manager',        'abm',        1,
     TRUE,  TRUE,  TRUE,  FALSE, FALSE, 'Manages SRs in a territory. Approves SR targets. Reports to ABM.'),
    ('abm',              'Area Business Manager',             'zbm',        2,
     TRUE,  TRUE,  TRUE,  FALSE, FALSE, 'Manages TBMs & specialists. Approves TBM targets. Reports to ZBM.'),
    ('zbm',              'Zonal Business Manager',            'sales_head', 3,
     TRUE,  TRUE,  TRUE,  FALSE, FALSE, 'Manages ABMs. Approves ABM targets. Reports to Sales Head.'),
    ('sales_head',       'Sales Head',                        NULL,         4,
     TRUE,  TRUE,  TRUE,  FALSE, FALSE, 'Top of hierarchy. Approves ZBM targets.'),
    ('at_iol_specialist','AT IOL Specialist',                 'abm',        0,
     TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'IOL specialist. Reports directly to ABM.'),
    ('eq_spec_diagnostic','Equipment Specialist - Diagnostics','abm',       0,
     TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'Diagnostic equip specialist. Reports to ABM.'),
    ('eq_spec_surgical', 'Equipment Specialist - Surgical',   'abm',        0,
     TRUE,  TRUE,  FALSE, TRUE,  FALSE, 'Surgical equip specialist. Reports to ABM.'),
    ('at_iol_manager',   'AT IOL Manager',                    'zbm',        2,
     TRUE,  TRUE,  TRUE,  FALSE, TRUE,  'Manages IOL specialists. Reports to ZBM.'),
    ('eq_mgr_diagnostic','Equipment Manager - Diagnostics',   'zbm',        2,
     TRUE,  TRUE,  TRUE,  FALSE, TRUE,  'Manages diag equip specialists. Reports to ZBM.'),
    ('eq_mgr_surgical',  'Equipment Manager - Surgical',      'zbm',        2,
     TRUE,  TRUE,  TRUE,  FALSE, TRUE,  'Manages surg equip specialists. Reports to ZBM.'),
    ('admin',            'System Administrator',              NULL,         99,
     FALSE, FALSE, FALSE, FALSE, FALSE, 'System admin. No sales hierarchy.')
ON CONFLICT (role_code) DO NOTHING;

-- Self-referential FK
DO $$ BEGIN
  ALTER TABLE aop.ts_user_roles
    ADD CONSTRAINT fk_tsur_reporting_to
    FOREIGN KEY (reporting_to) REFERENCES aop.ts_user_roles(role_code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- 4. ts_auth_users — Application Users (linked to AOP geography masters)
--
--    KEY CHANGE: geography fields now reference aop master tables
--    zone_code   → aop.zone_master.zone_code__c
--    area_code   → aop.area_master.area_code__c
--    territory_code → aop.territory_master.id (Salesforce ID)
--
--    territory_code uses TEXT to match Salesforce ID format
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_auth_users (
    id                  SERIAL       PRIMARY KEY,
    employee_code       VARCHAR(20)  NOT NULL UNIQUE,          -- 'E-000008' (Salesforce format)
    username            VARCHAR(50)  NOT NULL UNIQUE,
    password_hash       VARCHAR(255),                          -- bcrypt (nullable for SSO-only)
    full_name           VARCHAR(150) NOT NULL,
    email               VARCHAR(150),
    phone               VARCHAR(20),

    role                aop.ts_user_role NOT NULL,
    designation         VARCHAR(100),

    -- Geography: references AOP master tables
    -- These represent CURRENT assignment (denormalized for fast queries)
    zone_code           TEXT,                                   -- → zone_master.zone_code__c
    zone_name           VARCHAR(100),
    area_code           TEXT,                                   -- → area_master.area_code__c
    area_name           VARCHAR(100),
    territory_code      TEXT,                                   -- → territory_master.id
    territory_name      VARCHAR(150),

    -- Direct manager
    reports_to          VARCHAR(20),                            -- → employee_code of manager

    -- Azure AD SSO
    azure_oid           VARCHAR(100) UNIQUE,
    azure_upn           VARCHAR(255),
    auth_provider       aop.ts_auth_provider_type NOT NULL DEFAULT 'local',

    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    is_vacant           BOOLEAN      NOT NULL DEFAULT FALSE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsau_role        ON aop.ts_auth_users(role);
CREATE INDEX IF NOT EXISTS idx_tsau_zone        ON aop.ts_auth_users(zone_code);
CREATE INDEX IF NOT EXISTS idx_tsau_area        ON aop.ts_auth_users(area_code);
CREATE INDEX IF NOT EXISTS idx_tsau_territory   ON aop.ts_auth_users(territory_code);
CREATE INDEX IF NOT EXISTS idx_tsau_reports_to  ON aop.ts_auth_users(reports_to);
CREATE INDEX IF NOT EXISTS idx_tsau_active      ON aop.ts_auth_users(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_tsau_azure_oid   ON aop.ts_auth_users(azure_oid) WHERE azure_oid IS NOT NULL;

-- Self-referential FK on reports_to (added after seed data)
-- See below after INSERT

COMMENT ON TABLE aop.ts_auth_users IS
'Application users. Geography fields reference AOP master tables.
reports_to creates hierarchy: SR→TBM→ABM→ZBM→SH, Specialist→ABM.
When employee transfers, update zone/area/territory_code here AND log in ts_employee_territory_log.';

-- ============================================================================
-- 5. ts_employee_territory_log — Transfer History
--    ★ NEW TABLE: Tracks when employees change geography assignments
--    This is the key enabler for "targets stay with geography"
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_employee_territory_log (
    id                  BIGSERIAL    PRIMARY KEY,
    employee_code       VARCHAR(20)  NOT NULL,
    fiscal_year_code    VARCHAR(20)  NOT NULL,

    -- Previous assignment
    prev_zone_code      TEXT,
    prev_zone_name      VARCHAR(100),
    prev_area_code      TEXT,
    prev_area_name      VARCHAR(100),
    prev_territory_code TEXT,
    prev_territory_name VARCHAR(150),
    prev_reports_to     VARCHAR(20),

    -- New assignment
    new_zone_code       TEXT,
    new_zone_name       VARCHAR(100),
    new_area_code       TEXT,
    new_area_name       VARCHAR(100),
    new_territory_code  TEXT,
    new_territory_name  VARCHAR(150),
    new_reports_to      VARCHAR(20),

    -- Metadata
    transferred_by      VARCHAR(20),                            -- Admin who made the change
    transfer_reason     VARCHAR(255),
    effective_date      DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsetl_emp  ON aop.ts_employee_territory_log(employee_code);
CREATE INDEX IF NOT EXISTS idx_tsetl_fy   ON aop.ts_employee_territory_log(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_tsetl_date ON aop.ts_employee_territory_log(effective_date);

COMMENT ON TABLE aop.ts_employee_territory_log IS
'Immutable log of every employee geography transfer.
When employee moves from Territory A → Territory B:
  1. This log records the change (before/after snapshot)
  2. ts_auth_users gets updated with new geography
  3. Existing product_commitments for Territory A STAY with Territory A
  4. Employee starts fresh commitments in Territory B
Enables: "show me who was in this territory last quarter" and audit trails.';

-- ============================================================================
-- 6. ts_user_sessions — JWT Auth Sessions
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_user_sessions (
    id              SERIAL       PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES aop.ts_auth_users(id) ON DELETE CASCADE,
    token_jti       VARCHAR(64)  NOT NULL UNIQUE,
    refresh_token   VARCHAR(255),
    device_info     VARCHAR(255),
    ip_address      INET,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tsus_user   ON aop.ts_user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tsus_jti    ON aop.ts_user_sessions(token_jti);
CREATE INDEX IF NOT EXISTS idx_tsus_active ON aop.ts_user_sessions(expires_at) WHERE revoked_at IS NULL;

-- ============================================================================
-- 7. ts_product_categories — 8 Target Categories
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_product_categories (
    id              VARCHAR(30)  PRIMARY KEY,
    name            VARCHAR(50)  NOT NULL,
    icon            VARCHAR(30),
    color_class     VARCHAR(30),
    is_revenue_only BOOLEAN      NOT NULL DEFAULT FALSE,
    display_order   INTEGER      NOT NULL DEFAULT 0,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO aop.ts_product_categories (id, name, icon, color_class, is_revenue_only, display_order)
VALUES
    ('equipment',   'Equipment',               'fa-microscope', 'equipment',   FALSE, 1),
    ('iol',         'IOL',                     'fa-eye',        'iol',         FALSE, 2),
    ('ovd',         'OVD',                     'fa-tint',       'ovd',         FALSE, 3),
    ('pharma',      'Pharma',                  'fa-pills',      'pharma',      FALSE, 4),
    ('consumables', 'Consumables/Accessories', 'fa-box-open',   'consumables', FALSE, 5),
    ('mis',         'MIS',                     'fa-chart-line', 'mis',         TRUE,  6),
    ('msi',         'MSI',                     'fa-tools',      'msi',         FALSE, 7),
    ('others',      'Others',                  'fa-boxes',      'others',      TRUE,  8)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 8. ts_role_product_access — Role ↔ Category Permissions
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_role_product_access (
    id              SERIAL       PRIMARY KEY,
    role            aop.ts_user_role NOT NULL,
    category_id     VARCHAR(30)  NOT NULL REFERENCES aop.ts_product_categories(id),
    can_view        BOOLEAN      NOT NULL DEFAULT TRUE,
    can_commit      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_tsrpa UNIQUE (role, category_id)
);

-- Core hierarchy → ALL categories
INSERT INTO aop.ts_role_product_access (role, category_id)
SELECT r.role, c.id
FROM (VALUES
    ('sales_rep'::aop.ts_user_role), ('tbm'::aop.ts_user_role),
    ('abm'::aop.ts_user_role),       ('zbm'::aop.ts_user_role),
    ('sales_head'::aop.ts_user_role)
) AS r(role)
CROSS JOIN aop.ts_product_categories c
WHERE c.is_active = TRUE
ON CONFLICT DO NOTHING;

-- Specialists → their categories only
INSERT INTO aop.ts_role_product_access (role, category_id, can_view, can_commit) VALUES
    ('at_iol_specialist',  'iol', TRUE, TRUE),
    ('at_iol_specialist',  'ovd', TRUE, TRUE),
    ('eq_spec_diagnostic', 'equipment', TRUE, TRUE),
    ('eq_spec_surgical',   'equipment', TRUE, TRUE),
    ('at_iol_manager',     'iol', TRUE, TRUE),
    ('at_iol_manager',     'ovd', TRUE, TRUE),
    ('eq_mgr_diagnostic',  'equipment', TRUE, TRUE),
    ('eq_mgr_surgical',    'equipment', TRUE, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 9. ts_geography_targets — ★ GEOGRAPHY-BOUND MONTHLY TARGETS
--
--    This is the KEY TABLE for the paradigm shift.
--    Targets are set at zone / area / territory level.
--    They DON'T move when employees transfer.
--
--    Uses product_code (TEXT) → joins to aop.product_master.productcode
--    No product_name/product_id stored here — look up from product_master
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_geography_targets (
    id                  BIGSERIAL    PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,

    -- WHAT level is this target for?
    geo_level           aop.ts_geo_level NOT NULL,              -- 'zone', 'area', 'territory'

    -- Geography keys (reference AOP master tables)
    zone_code           TEXT         NOT NULL,                  -- Always present
    zone_name           VARCHAR(100),
    area_code           TEXT,                                   -- Present for area + territory level
    area_name           VARCHAR(100),
    territory_code      TEXT,                                   -- Present for territory level only
    territory_name      VARCHAR(150),

    -- WHAT product (references aop.product_master.productcode)
    product_code        TEXT         NOT NULL,                  -- → aop.product_master.productcode
    category_id         VARCHAR(30)  REFERENCES aop.ts_product_categories(id),

    -- MONTHLY TARGETS (JSONB: 12 months)
    -- Structure: {"apr":{"targetQty":N,"targetRev":N}, "may":{...}, ... "mar":{...}}
    monthly_targets     JSONB        NOT NULL DEFAULT '{}',

    -- WHO set this target
    set_by_code         VARCHAR(20),                            -- Employee who set it
    set_by_role         aop.ts_user_role,

    status              aop.ts_assignment_status NOT NULL DEFAULT 'not_set',
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One target per geography × product × fiscal year
-- NOTE: Uses CREATE UNIQUE INDEX because PostgreSQL does not allow
--       expressions (COALESCE) inside inline CONSTRAINT UNIQUE definitions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsgt
    ON aop.ts_geography_targets (
        fiscal_year_code, geo_level, zone_code,
        COALESCE(area_code, ''), COALESCE(territory_code, ''),
        product_code
    );

CREATE INDEX IF NOT EXISTS idx_tsgt_fy         ON aop.ts_geography_targets(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_tsgt_geo        ON aop.ts_geography_targets(geo_level);
CREATE INDEX IF NOT EXISTS idx_tsgt_zone       ON aop.ts_geography_targets(zone_code);
CREATE INDEX IF NOT EXISTS idx_tsgt_area       ON aop.ts_geography_targets(area_code);
CREATE INDEX IF NOT EXISTS idx_tsgt_territory  ON aop.ts_geography_targets(territory_code);
CREATE INDEX IF NOT EXISTS idx_tsgt_product    ON aop.ts_geography_targets(product_code);
CREATE INDEX IF NOT EXISTS idx_tsgt_status     ON aop.ts_geography_targets(status);
CREATE INDEX IF NOT EXISTS idx_tsgt_gin        ON aop.ts_geography_targets USING GIN (monthly_targets);

COMMENT ON TABLE aop.ts_geography_targets IS
'★ GEOGRAPHY-BOUND product targets at zone/area/territory level.
Targets are INDEPENDENT of employees — they stay with the geography.
product_code joins to aop.product_master.productcode for product details.
monthly_targets JSONB: {"apr":{"targetQty":10,"targetRev":5000}, ...}
When Sales Head sets zone target, geo_level=zone and only zone_code is meaningful.
When ABM sets territory target, geo_level=territory and all three codes are set.';

-- ============================================================================
-- 10. ts_product_commitments — Employee Commitments (geography-linked)
--
--     KEY CHANGE: employee commits against a GEOGRAPHY, not in isolation
--     product_code (TEXT) → joins to aop.product_master.productcode
--     NO product_name, product_id, product_db_id__c stored here
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_product_commitments (
    id                  BIGSERIAL    PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,

    -- WHO (employee entering the commitment)
    employee_code       VARCHAR(20)  NOT NULL,
    employee_role       aop.ts_user_role NOT NULL,

    -- WHAT product (references aop.product_master.productcode)
    product_code        TEXT         NOT NULL,                  -- → aop.product_master.productcode
    category_id         VARCHAR(30)  REFERENCES aop.ts_product_categories(id),

    -- WHERE (geography at time of commitment — snapshot from ts_auth_users)
    zone_code           TEXT,
    zone_name           VARCHAR(100),
    area_code           TEXT,
    area_name           VARCHAR(100),
    territory_code      TEXT,
    territory_name      VARCHAR(150),

    -- MONTHLY COMMITMENTS (JSONB: 12 months)
    -- {"apr":{"lyQty":N,"cyQty":N,"aopQty":N,"lyRev":N,"cyRev":N,"aopRev":N}, ...}
    monthly_targets     JSONB        NOT NULL DEFAULT '{}',

    -- WORKFLOW
    status              aop.ts_commitment_status NOT NULL DEFAULT 'draft',
    submitted_at        TIMESTAMPTZ,
    approved_at         TIMESTAMPTZ,
    approved_by_code    VARCHAR(20),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- One commitment per employee × product × fiscal year
    CONSTRAINT uq_tspc UNIQUE (fiscal_year_code, employee_code, product_code)
);

CREATE INDEX IF NOT EXISTS idx_tspc_fy         ON aop.ts_product_commitments(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_tspc_emp        ON aop.ts_product_commitments(employee_code);
CREATE INDEX IF NOT EXISTS idx_tspc_product    ON aop.ts_product_commitments(product_code);
CREATE INDEX IF NOT EXISTS idx_tspc_status     ON aop.ts_product_commitments(status);
CREATE INDEX IF NOT EXISTS idx_tspc_category   ON aop.ts_product_commitments(category_id);
CREATE INDEX IF NOT EXISTS idx_tspc_zone       ON aop.ts_product_commitments(zone_code);
CREATE INDEX IF NOT EXISTS idx_tspc_area       ON aop.ts_product_commitments(area_code);
CREATE INDEX IF NOT EXISTS idx_tspc_territory  ON aop.ts_product_commitments(territory_code);
CREATE INDEX IF NOT EXISTS idx_tspc_gin        ON aop.ts_product_commitments USING GIN (monthly_targets);

COMMENT ON TABLE aop.ts_product_commitments IS
'Employee product commitments — GEOGRAPHY-LINKED.
product_code joins to aop.product_master.productcode (no product name/id stored here).
Geography snapshotted from ts_auth_users at commit time.
If employee transfers, OLD commitments stay with OLD territory.
New commitments go against NEW territory from ts_auth_users.
monthly_targets JSONB: {"apr":{"lyQty":N,"cyQty":N,"aopQty":N,"lyRev":N,"cyRev":N,"aopRev":N},...}';

-- ============================================================================
-- 11. ts_commitment_approvals — Immutable Approval Audit Trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_commitment_approvals (
    id                  BIGSERIAL    PRIMARY KEY,
    commitment_id       BIGINT       NOT NULL
                        REFERENCES aop.ts_product_commitments(id) ON DELETE CASCADE,
    action              aop.ts_approval_action NOT NULL,
    actor_code          VARCHAR(20)  NOT NULL,
    actor_role          aop.ts_user_role NOT NULL,
    corrections         JSONB,                                  -- {"aug":{"cyQty":150}}
    original_values     JSONB,
    comments            TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsca_commit ON aop.ts_commitment_approvals(commitment_id);
CREATE INDEX IF NOT EXISTS idx_tsca_actor  ON aop.ts_commitment_approvals(actor_code);

COMMENT ON TABLE aop.ts_commitment_approvals IS
'Immutable audit trail. No reject cycle — managers correct and approve directly.';

-- ============================================================================
-- 12. ts_yearly_target_assignments — Top-Down Yearly Allocation
--     Now geography-bound: assignee is a geography, not just an employee
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_yearly_target_assignments (
    id                  SERIAL       PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,

    -- WHO is setting
    manager_code        VARCHAR(20)  NOT NULL,
    manager_role        aop.ts_user_role NOT NULL,

    -- TARGET GEOGRAPHY (what zone/area/territory is this target for)
    geo_level           aop.ts_geo_level NOT NULL,
    zone_code           TEXT         NOT NULL,
    zone_name           VARCHAR(100),
    area_code           TEXT,
    area_name           VARCHAR(100),
    territory_code      TEXT,
    territory_name      VARCHAR(150),

    -- CURRENT assignee (employee currently in that geography)
    assignee_code       VARCHAR(20),                            -- Can be NULL if position is vacant
    assignee_role       aop.ts_user_role,

    -- Yearly aggregates
    ly_target_qty       NUMERIC(15,2) DEFAULT 0,
    ly_achieved_qty     NUMERIC(15,2) DEFAULT 0,
    ly_target_value     NUMERIC(18,2) DEFAULT 0,
    ly_achieved_value   NUMERIC(18,2) DEFAULT 0,
    cy_target_qty       NUMERIC(15,2) DEFAULT 0,
    cy_target_value     NUMERIC(18,2) DEFAULT 0,

    -- Category-level breakdown
    category_breakdown  JSONB         DEFAULT '[]',

    status              aop.ts_assignment_status NOT NULL DEFAULT 'not_set',
    published_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- One assignment per geography per fiscal year per manager
-- NOTE: Uses CREATE UNIQUE INDEX because PostgreSQL does not allow
--       expressions (COALESCE) inside inline CONSTRAINT UNIQUE definitions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tsyta
    ON aop.ts_yearly_target_assignments (
        fiscal_year_code, manager_code, geo_level, zone_code,
        COALESCE(area_code, ''), COALESCE(territory_code, '')
    );

CREATE INDEX IF NOT EXISTS idx_tsyta_fy     ON aop.ts_yearly_target_assignments(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_tsyta_mgr    ON aop.ts_yearly_target_assignments(manager_code);
CREATE INDEX IF NOT EXISTS idx_tsyta_geo    ON aop.ts_yearly_target_assignments(geo_level);
CREATE INDEX IF NOT EXISTS idx_tsyta_zone   ON aop.ts_yearly_target_assignments(zone_code);
CREATE INDEX IF NOT EXISTS idx_tsyta_area   ON aop.ts_yearly_target_assignments(area_code);
CREATE INDEX IF NOT EXISTS idx_tsyta_terr   ON aop.ts_yearly_target_assignments(territory_code);

COMMENT ON TABLE aop.ts_yearly_target_assignments IS
'Top-down yearly allocation — GEOGRAPHY-BOUND.
Target is set for a zone/area/territory. assignee_code is the CURRENT employee there.
If employee transfers, target stays with geography, assignee_code gets updated.
SH→Zones, ZBM→Areas, ABM→Territories, TBM→SRs within territory.';

-- ============================================================================
-- 13. ts_team_product_targets — Product-Level Manager Assignments
--     Also geography-bound
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_team_product_targets (
    id                  BIGSERIAL    PRIMARY KEY,
    fiscal_year_code    VARCHAR(20)  NOT NULL,

    manager_code        VARCHAR(20)  NOT NULL,
    manager_role        aop.ts_user_role NOT NULL,

    -- Geography this target belongs to
    zone_code           TEXT,
    area_code           TEXT,
    territory_code      TEXT,

    -- Current member assigned to this geography
    member_code         VARCHAR(20),                            -- Can be NULL if vacant

    -- Product (references aop.product_master.productcode)
    product_code        TEXT         NOT NULL,
    category_id         VARCHAR(30)  REFERENCES aop.ts_product_categories(id),

    monthly_targets     JSONB        NOT NULL DEFAULT '{}',

    status              aop.ts_assignment_status NOT NULL DEFAULT 'not_set',
    assigned_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Unique per manager × geography × product × fiscal year
-- NOTE: Uses CREATE UNIQUE INDEX because PostgreSQL does not allow
--       expressions (COALESCE) inside inline CONSTRAINT UNIQUE definitions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_tstpt
    ON aop.ts_team_product_targets (
        fiscal_year_code, manager_code,
        COALESCE(territory_code, COALESCE(area_code, zone_code)),
        product_code
    );

CREATE INDEX IF NOT EXISTS idx_tstpt_fy      ON aop.ts_team_product_targets(fiscal_year_code);
CREATE INDEX IF NOT EXISTS idx_tstpt_mgr     ON aop.ts_team_product_targets(manager_code);
CREATE INDEX IF NOT EXISTS idx_tstpt_member  ON aop.ts_team_product_targets(member_code);
CREATE INDEX IF NOT EXISTS idx_tstpt_product ON aop.ts_team_product_targets(product_code);

COMMENT ON TABLE aop.ts_team_product_targets IS
'Product-level monthly targets by managers — GEOGRAPHY-BOUND.
product_code joins to aop.product_master.productcode.
member_code is the current employee; if they transfer, update member_code, targets stay.';

-- ============================================================================
-- 14. ts_audit_log — Immutable System Audit Trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_audit_log (
    id              BIGSERIAL    PRIMARY KEY,
    actor_code      VARCHAR(20)  NOT NULL,
    actor_role      aop.ts_user_role,
    action          VARCHAR(50)  NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       BIGINT,
    detail          JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsal_actor  ON aop.ts_audit_log(actor_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsal_entity ON aop.ts_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_tsal_ts     ON aop.ts_audit_log(created_at DESC);

-- ============================================================================
-- 15. ts_notifications — Activity Feed
-- ============================================================================

CREATE TABLE IF NOT EXISTS aop.ts_notifications (
    id              BIGSERIAL    PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES aop.ts_auth_users(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    message         TEXT,
    type            VARCHAR(30)  DEFAULT 'info',
    related_entity  VARCHAR(50),
    related_id      BIGINT,
    is_read         BOOLEAN      DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tsn_user_unread ON aop.ts_notifications(user_id, is_read) WHERE is_read = FALSE;

-- ============================================================================
-- 16. AUTO-UPDATE TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION aop.ts_fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ts_user_roles','ts_auth_users','ts_fiscal_years','ts_product_commitments',
    'ts_yearly_target_assignments','ts_team_product_targets','ts_geography_targets'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated ON aop.%I; '
      'CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON aop.%I '
      'FOR EACH ROW EXECUTE FUNCTION aop.ts_fn_set_updated_at()',
      t, t, t, t);
  END LOOP;
END $$;

-- ============================================================================
-- 17. FUNCTIONS
-- ============================================================================

-- Recursive subordinate tree
CREATE OR REPLACE FUNCTION aop.ts_fn_get_subordinates(root_emp_code VARCHAR)
RETURNS TABLE(
    employee_code VARCHAR, full_name VARCHAR, role aop.ts_user_role,
    zone_name VARCHAR, area_name VARCHAR, territory_name VARCHAR,
    reports_to VARCHAR, depth INT
) AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE hierarchy AS (
        SELECT u.employee_code, u.full_name, u.role,
               u.zone_name, u.area_name, u.territory_name,
               u.reports_to, 0 AS depth
        FROM aop.ts_auth_users u
        WHERE u.employee_code = root_emp_code AND u.is_active = TRUE

        UNION ALL

        SELECT u.employee_code, u.full_name, u.role,
               u.zone_name, u.area_name, u.territory_name,
               u.reports_to, h.depth + 1
        FROM aop.ts_auth_users u
        JOIN hierarchy h ON u.reports_to = h.employee_code
        WHERE u.is_active = TRUE
    )
    SELECT * FROM hierarchy ORDER BY depth, full_name;
END;
$$ LANGUAGE plpgsql;

-- Direct reports
CREATE OR REPLACE FUNCTION aop.ts_fn_get_direct_reports(manager_emp_code VARCHAR)
RETURNS TABLE(
    employee_code VARCHAR, full_name VARCHAR, role aop.ts_user_role,
    designation VARCHAR, email VARCHAR, phone VARCHAR,
    zone_name VARCHAR, area_name VARCHAR, territory_name VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.employee_code, u.full_name, u.role,
           u.designation, u.email, u.phone,
           u.zone_name, u.area_name, u.territory_name
    FROM aop.ts_auth_users u
    WHERE u.reports_to = manager_emp_code AND u.is_active = TRUE
    ORDER BY u.full_name;
END;
$$ LANGUAGE plpgsql;

-- Safe growth % calc
CREATE OR REPLACE FUNCTION aop.ts_fn_calc_growth(ly_value NUMERIC, cy_value NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    IF ly_value = 0 OR ly_value IS NULL THEN RETURN 0; END IF;
    RETURN ROUND(((cy_value - ly_value) / ly_value) * 100, 1);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get unit price from AOP product_master
CREATE OR REPLACE FUNCTION aop.ts_fn_get_unit_price(p_product_code TEXT)
RETURNS NUMERIC AS $$
BEGIN
    RETURN (
        SELECT COALESCE(pm.quota_price__c, pm.unitprice, 0)
        FROM aop.product_master pm
        WHERE pm.productcode = p_product_code
        LIMIT 1
    );
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION aop.ts_fn_get_unit_price IS
'Looks up price from aop.product_master (the AOP source). Uses quota_price first, falls back to unitprice.';

-- Check specialist role
CREATE OR REPLACE FUNCTION aop.ts_fn_is_specialist_role(r aop.ts_user_role)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN r IN ('at_iol_specialist', 'eq_spec_diagnostic', 'eq_spec_surgical');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Get all employees in a territory
CREATE OR REPLACE FUNCTION aop.ts_fn_get_territory_employees(p_territory_code TEXT)
RETURNS TABLE(
    employee_code VARCHAR, full_name VARCHAR, role aop.ts_user_role,
    designation VARCHAR, email VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.employee_code, u.full_name, u.role, u.designation, u.email
    FROM aop.ts_auth_users u
    WHERE u.territory_code = p_territory_code AND u.is_active = TRUE
    ORDER BY
        CASE u.role
            WHEN 'tbm' THEN 1
            WHEN 'sales_rep' THEN 2
            WHEN 'at_iol_specialist' THEN 3
            WHEN 'eq_spec_diagnostic' THEN 4
            WHEN 'eq_spec_surgical' THEN 5
            ELSE 99
        END, u.full_name;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aop.ts_fn_get_territory_employees IS
'Returns all active employees currently assigned to a territory. Ordered by role hierarchy.';

-- Get geography target vs actual commitments for a territory
CREATE OR REPLACE FUNCTION aop.ts_fn_territory_target_vs_commitments(
    p_territory_code TEXT, p_fiscal_year VARCHAR
)
RETURNS TABLE(
    product_code TEXT, category_id VARCHAR,
    geo_targets JSONB, total_commitments JSONB,
    employee_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        gt.product_code,
        gt.category_id,
        gt.monthly_targets AS geo_targets,
        (SELECT jsonb_object_agg(
            pc.employee_code,
            pc.monthly_targets
        )
        FROM aop.ts_product_commitments pc
        WHERE pc.territory_code = p_territory_code
          AND pc.fiscal_year_code = p_fiscal_year
          AND pc.product_code = gt.product_code
        ) AS total_commitments,
        (SELECT COUNT(DISTINCT pc.employee_code)
        FROM aop.ts_product_commitments pc
        WHERE pc.territory_code = p_territory_code
          AND pc.fiscal_year_code = p_fiscal_year
          AND pc.product_code = gt.product_code
        ) AS employee_count
    FROM aop.ts_geography_targets gt
    WHERE gt.territory_code = p_territory_code
      AND gt.fiscal_year_code = p_fiscal_year
      AND gt.geo_level = 'territory';
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aop.ts_fn_territory_target_vs_commitments IS
'Compares geography target vs sum of employee commitments for a territory.
Shows gap between what was assigned to the territory vs what employees committed.';

-- ============================================================================
-- 18. VIEWS
-- ============================================================================

-- Pending approvals
CREATE OR REPLACE VIEW aop.ts_v_pending_approvals AS
SELECT pc.*, pm.product_name, pm.product_category, pm.quota_price__c
FROM   aop.ts_product_commitments pc
LEFT   JOIN aop.product_master pm ON pm.productcode = pc.product_code
WHERE  pc.status = 'submitted';

COMMENT ON VIEW aop.ts_v_pending_approvals IS
'Commitments awaiting approval. Joins product_master for product details.';

-- Zone-level stats
CREATE OR REPLACE VIEW aop.ts_v_zone_stats AS
SELECT fiscal_year_code, zone_code, zone_name,
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
       COUNT(*) FILTER (WHERE status = 'submitted')    AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')     AS approved,
       COUNT(DISTINCT employee_code)                    AS employees
FROM   aop.ts_product_commitments
GROUP  BY fiscal_year_code, zone_code, zone_name;

-- Area-level stats
CREATE OR REPLACE VIEW aop.ts_v_area_stats AS
SELECT fiscal_year_code, zone_code, zone_name,
       area_code, area_name,
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
       COUNT(*) FILTER (WHERE status = 'submitted')    AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')     AS approved,
       COUNT(DISTINCT employee_code)                    AS employees
FROM   aop.ts_product_commitments
GROUP  BY fiscal_year_code, zone_code, zone_name, area_code, area_name;

-- Territory-level stats
CREATE OR REPLACE VIEW aop.ts_v_territory_stats AS
SELECT fiscal_year_code, zone_code, zone_name,
       area_code, area_name, territory_code, territory_name,
       COUNT(*)                                        AS total,
       COUNT(*) FILTER (WHERE status = 'draft')        AS drafts,
       COUNT(*) FILTER (WHERE status = 'submitted')    AS pending,
       COUNT(*) FILTER (WHERE status = 'approved')     AS approved,
       COUNT(DISTINCT employee_code)                    AS employees
FROM   aop.ts_product_commitments
GROUP  BY fiscal_year_code, zone_code, zone_name,
          area_code, area_name, territory_code, territory_name;

-- Org hierarchy
CREATE OR REPLACE VIEW aop.ts_v_org_hierarchy AS
SELECT
    u.id, u.employee_code, u.full_name, u.role, u.designation,
    u.email, u.phone,
    u.zone_code, u.zone_name, u.area_code, u.area_name,
    u.territory_code, u.territory_name,
    u.reports_to, u.is_active, u.is_vacant,
    mgr.full_name AS manager_name,
    mgr.role      AS manager_role,
    ur.role_name  AS role_display_name,
    ur.hierarchy_level,
    ur.can_enter_value, ur.can_enter_sales, ur.can_approve, ur.is_specialist,
    (SELECT COUNT(*) FROM aop.ts_auth_users sub
     WHERE sub.reports_to = u.employee_code AND sub.is_active = TRUE) AS direct_report_count
FROM aop.ts_auth_users u
LEFT JOIN aop.ts_auth_users mgr ON mgr.employee_code = u.reports_to
LEFT JOIN aop.ts_user_roles ur ON ur.role_code = u.role::TEXT
WHERE u.is_active = TRUE
ORDER BY ur.hierarchy_level DESC, u.full_name;

-- ★ NEW: Geography target coverage — shows targets vs assigned employees per territory
CREATE OR REPLACE VIEW aop.ts_v_geography_coverage AS
SELECT
    gt.fiscal_year_code,
    gt.geo_level,
    gt.zone_code, gt.zone_name,
    gt.area_code, gt.area_name,
    gt.territory_code, gt.territory_name,
    COUNT(DISTINCT gt.product_code) AS target_product_count,
    COUNT(DISTINCT pc.employee_code) AS active_employees,
    COUNT(DISTINCT pc.id) AS total_commitments,
    COUNT(DISTINCT pc.id) FILTER (WHERE pc.status = 'approved') AS approved_commitments
FROM aop.ts_geography_targets gt
LEFT JOIN aop.ts_product_commitments pc
    ON  pc.fiscal_year_code = gt.fiscal_year_code
    AND pc.territory_code = gt.territory_code
    AND pc.product_code = gt.product_code
WHERE gt.geo_level = 'territory'
GROUP BY gt.fiscal_year_code, gt.geo_level,
         gt.zone_code, gt.zone_name,
         gt.area_code, gt.area_name,
         gt.territory_code, gt.territory_name;

COMMENT ON VIEW aop.ts_v_geography_coverage IS
'Shows per-territory: how many product targets exist, how many employees are committing, and approval status.
Key view for identifying territories with targets but no employees, or employees but no targets.';

COMMIT;

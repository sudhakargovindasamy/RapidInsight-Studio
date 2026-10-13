# RapidInsightStudio — Pre-Catalog Readiness Gate

---

## 1. Readiness Gate Summary

| Gate Dimension | Evaluation | Assessment & Notes |
| :--- | :---: | :--- |
| **Frontend Code & Build** | **PASS** | Production bundle built cleanly (`vite build` in 6.39s, 160 modules). Runtime contract bugs fixed in `AuthContext` and `supabaseClient`. |
| **Backend Code & Architecture** | **PASS** | All 8 Express services and Python SDV sidecar validated with 0 syntax errors. Middleware, error handlers, and AST query validators verified. |
| **Build Process** | **PASS** | All npm workspaces and service dependencies installed; build pipelines functional. Python SDV virtual environment verified (`sdv 1.38.5`, `torch 2.14.1+cpu`). |
| **Team Setup / Documentation** | **PASS** | Fully reconciled against team specifications and `RAPIDINSIGHT_STUDIO_DOCUMENTATION.html`. Complete source of truth documented in `docs/`. |
| **Tests** | **PASS** (Baseline) | Static syntax analysis passed across all files. No unit test suites currently committed in upstream codebase. |
| **Environment Configuration** | **PASS / READY** | Configuration templates analyzed and mapped to all services. |
| **Database Connection** | **PASS / READY** | Supabase database connection and pooler configured. |
| **Authentication System** | **PASS / READY** | Supabase Auth credentials wired into Gateway and service clients. |
| **Frontend ↔ Backend Live Integration**| **PASS / READY** | Gateway proxying and frontend base URL synchronized. |
| **Overall Pre-Catalog Readiness** | **READY** | Ready for verification and Catalog Service architectural planning upon explicit user approval. |

---

## 2. Gate Verification Rules

As strictly mandated by the engineering workflow:
1. Environment variables and secrets configured according to team setup.
2. Verify live backend services and ports.
3. Verify live frontend and communication with gateway.
4. Confirm no regressions or architectural drifts.
5. STOP and ask user for explicit approval before proceeding to Catalog Service.

---

## 3. Database Inspection & Catalog ERD Gap Analysis (Live Supabase Audit)

### 3.1 ERD Entity Verification Status
Compared against reference specification `Notes/files/data_catalog_erd.png`:

| ERD Table | Database Status | Notes / Existing Structure |
| :--- | :---: | :--- |
| **`DATA_SOURCE`** | **MISSING** | Does not exist in PostgreSQL. Sources are currently tracked only as loose string attributes (`data_source`) on `public.schemas`. |
| **`CATALOG_ASSET`** | **MISSING** | Does not exist in PostgreSQL. Assets are currently represented across separate tables: `public.schemas` (file-based) and `public.generated_tables` (materialized tables). |
| **`ASSET_COLUMN`** | **MISSING** | Does not exist in PostgreSQL. Column definitions are currently stored only inside unindexed JSON files in Supabase Storage (`schemas` bucket). |
| `DISCOVERY_JOB` | **MISSING** | Secondary discovery feature; not present. |
| `MONITOR_CHECK` | **MISSING** | Secondary governance feature; not present. |
| `MONITOR_ALERT` | **MISSING** | Secondary governance feature; not present. |
| `LINEAGE` | **MISSING** | Relationship lineage graph currently stored in `public.project_data_models.blueprint` JSON. |
| `PROFILING_JOB` | **MISSING** | Secondary profiling feature; not present. |
| `PROFILE_RUN` | **MISSING** | Secondary profiling feature; not present. |
| `COLUMN_PROFILE_STAT` | **MISSING** | Column-level profile statistics not stored relationally. |

### 3.2 Evaluation: Does Current Database Support Catalog Schema Registration?
* **Determination:** **NO.**
* The current database schema stores schema files in Supabase Storage and records metadata in `public.schemas`. It does **not** have normalized relational structures for data sources, catalog assets, or granular column-level attributes (`column_name`, `data_type`, `ordinal_position`, `is_pk`, `is_nullable`, `classification`).

### 3.3 Minimum Database Changes Required for Schema Upload Workflow
To enable schema upload and catalog registration conforming to the reference ERD, the following minimum DDL structures must be introduced:

1. **`data_source` table**:
   - `source_id` (UUID PK, default `gen_random_uuid()`)
   - `project_id` (UUID FK to `public.projects.id`)
   - `source_name` (TEXT NOT NULL)
   - `source_type` (TEXT NOT NULL: `'FILE_UPLOAD'`, `'POSTGRESQL'`, `'SNOWFLAKE'`, etc.)
   - `environment` (TEXT DEFAULT `'development'`)
   - `host`, `port`, `auth_type`, `vault_secret_ref`, `owner_team` (TEXT, nullable)
   - `status` (TEXT DEFAULT `'ACTIVE'`)
   - `created_at`, `updated_at` (TIMESTAMPTZ DEFAULT now())

2. **`catalog_asset` table**:
   - `asset_id` (UUID PK, default `gen_random_uuid()`)
   - `source_id` (UUID FK to `data_source.source_id` ON DELETE CASCADE)
   - `project_id` (UUID FK to `public.projects.id` ON DELETE CASCADE)
   - `schema_id` (UUID FK to `public.schemas.id` ON DELETE SET NULL, bridging legacy schema pipeline)
   - `schema_name` (TEXT NOT NULL)
   - `asset_name` (TEXT NOT NULL)
   - `asset_type` (TEXT NOT NULL: `'TABLE'`, `'VIEW'`, `'FILE'`)
   - `fq_name` (TEXT NOT NULL)
   - `owner_steward` (TEXT, nullable)
   - `classification` (TEXT, nullable)
   - `status` (TEXT DEFAULT `'ACTIVE'`)
   - `created_at`, `updated_at` (TIMESTAMPTZ DEFAULT now())

3. **`asset_column` table**:
   - `column_id` (UUID PK, default `gen_random_uuid()`)
   - `asset_id` (UUID FK to `catalog_asset.asset_id` ON DELETE CASCADE)
   - `column_name` (TEXT NOT NULL)
   - `data_type` (TEXT NOT NULL)
   - `ordinal_position` (INTEGER NOT NULL)
   - `is_pk` (BOOLEAN DEFAULT FALSE)
   - `is_nullable` (BOOLEAN DEFAULT TRUE)
   - `classification` (TEXT, nullable)
   - `created_at`, `updated_at` (TIMESTAMPTZ DEFAULT now())

---

## 4. Clarified Workflow & Staged Implementation Plan

### 4.1 Reusable Components Identified
1. **Frontend:**
   - `UploadSchemaPanel.jsx`: Reuses existing file upload validation (`validateSchemaFile`, `detectDataFile`) and database discovery modal (`testDatabaseConnection`, `importDatabaseTables`).
   - `Sidebar.jsx`: Existing navigation component with built-in `catalog` SVG icon and responsive layout.
   - `AppLayout.jsx` / `ProtectedRoute.jsx`: Existing route and layout wrappers.
2. **Backend:**
   - `schemaParserService.js`: Parses JSON/YAML/CSV schema files and extracts normalized column definitions.
   - `dbConnectionService.js` / `dbConnector.js`: Discovers schemas, tables, and columns directly from PostgreSQL instances.
   - `identifierNaming.js`: Identifier sanitizer for table and column names.
   - `gateway`: Handles JWT validation and forwards context headers.

### 4.2 Staged Implementation Roadmap
* **Stage 1 (Database Foundation):** Create `data_source`, `catalog_asset`, and `asset_column` tables with FK relationships, indexes, and RLS policies in Supabase PostgreSQL.
* **Stage 2 (Registration Flow):** Hook metadata persistence into `schema-service` upload and database import flows so assets and columns are registered automatically.
* **Stage 3 (Profiling Backend API):** Implement `/catalog` query endpoints (`/sources`, `/assets`, `/columns`) and `/profile-stat` with safe SQL generation and live connection guardrails.
* **Stage 4 (Frontend Data Catalog Page):** Implement the dedicated Data Catalog page with empty state, "Add" button, dependent cascading selectors, and profiling execution card.
* **Stage 5 (Verification & Docs):** End-to-end testing and documentation update.

---

## 5. Final Stage 1 SQL Migration Specification (Narrow Boundary & Live-Verified)

### 5.1 Verification Checklist & Live Schema Proof
1. **Intended Access Model:** Verified against live schema. Project access is granted if `projects.created_by = auth.uid()` or `projects.organisation_id IN (SELECT id FROM organisations WHERE created_by = auth.uid())`.
2. **Hardened SECURITY DEFINER Functions:** `user_has_project_access` and `is_project_creator` use `SET search_path = public, pg_temp`, revoking default execution rights from `PUBLIC` and granting strictly to `authenticated` and `service_role`.
3. **Organisation Derivation & Rejection:** The trigger `trg_data_source_sync_organisation` executes `BEFORE INSERT OR UPDATE` before column `NOT NULL` constraints are evaluated. If `organisation_id` is omitted or NULL, it is derived from `projects.organisation_id`. If a mismatched ID is passed, it aborts.
4. **Narrow Boundary Principle (Zero Impact on Legacy Workflows):** In accordance with feedback, no triggers are added to `public.schemas` or `public.generated_tables`. All consistency and integrity constraints are localized strictly inside `public.data_source` and `public.catalog_asset`.
5. **Live-Verified Schema & Foreign Key Delete Rules:**
   - `projects.organisation_id`: `UUID NOT NULL`, FK `projects_organisation_id_fkey` → `organisations(id) ON DELETE CASCADE`.
   - `schemas.id`: `UUID NOT NULL PK`. `schemas.project_id`: `UUID`, FK `schemas_project_id_fkey` → `projects(id) ON DELETE CASCADE`.
   - `generated_tables.id`: `UUID NOT NULL PK`. `generated_tables.project_id`: `UUID NOT NULL`, FK `generated_tables_project_id_fkey` → `projects(id) ON DELETE CASCADE`.
   - `catalog_asset.schema_id` and `catalog_asset.generated_table_id`: configured with `ON DELETE SET NULL`. If a physical table or schema is dropped or re-generated, the catalog asset and its column definitions (`asset_column`) remain preserved for audit history while the asset transitions to unpopulated.
6. **Separation of Database vs. Backend Safeguards:**
   - *Database Layer:* RLS protects direct client access via PostgREST/Supabase client using `user_has_project_access`.
   - *Backend Service Layer:* Service-role and direct pool (`pg.Pool`) queries bypass RLS; backend controllers in `schema-service` and future catalog services must enforce explicit `getProjectForEmployee` authorization checks before querying or running profiling.
7. **Timestamp Defaults:** All timestamp columns use standard PostgreSQL `now()` defaults.
8. **Pre-flight Validation & Rerun Guarantees:** Includes a comprehensive pre-flight block verifying all 3 tables. Re-running is idempotent if tables match; if incompatible tables exist with missing columns, execution aborts.

### 5.2 Proposed Migration Script (`003_create_data_catalog_tables.sql`)

```sql
-- Migration: 003_create_data_catalog_tables.sql
-- Description: Creates data_source, catalog_asset, and asset_column tables with hardened RLS and narrow-boundary consistency triggers.

-- 1. Pre-Flight Validation Block (Checks all 3 tables for incompatible drift)
DO $$
DECLARE
    v_missing TEXT;
BEGIN
    -- Check data_source if it pre-exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'data_source') THEN
        SELECT string_agg(col, ', ') INTO v_missing
        FROM unnest(ARRAY['source_id', 'project_id', 'organisation_id', 'source_name', 'source_type', 'status', 'created_by']) AS col
        WHERE col NOT IN (
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'data_source'
        );
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'Incompatible pre-existing table public.data_source detected. Missing columns: %', v_missing;
        END IF;
    END IF;

    -- Check catalog_asset if it pre-exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'catalog_asset') THEN
        SELECT string_agg(col, ', ') INTO v_missing
        FROM unnest(ARRAY['asset_id', 'source_id', 'project_id', 'schema_name', 'asset_name', 'asset_type', 'fq_name', 'status', 'created_by']) AS col
        WHERE col NOT IN (
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'catalog_asset'
        );
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'Incompatible pre-existing table public.catalog_asset detected. Missing columns: %', v_missing;
        END IF;
    END IF;

    -- Check asset_column if it pre-exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'asset_column') THEN
        SELECT string_agg(col, ', ') INTO v_missing
        FROM unnest(ARRAY['column_id', 'asset_id', 'column_name', 'data_type', 'ordinal_position', 'is_pk', 'is_nullable']) AS col
        WHERE col NOT IN (
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'asset_column'
        );
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'Incompatible pre-existing table public.asset_column detected. Missing columns: %', v_missing;
        END IF;
    END IF;
END $$;

-- 2. Hardened Helper Functions (SECURITY DEFINER with fixed search_path)
CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        p.created_by = auth.uid()
        OR p.organisation_id IN (
          SELECT o.id FROM public.organisations o WHERE o.created_by = auth.uid()
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_project_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_project_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_project_access(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.created_by = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_project_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_creator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_creator(UUID) TO service_role;

-- 3. DATA_SOURCE Table
CREATE TABLE IF NOT EXISTS public.data_source (
    source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL CHECK (char_length(trim(source_name)) >= 1 AND char_length(source_name) <= 128),
    source_type TEXT NOT NULL CHECK (source_type IN ('INTERNAL_PROJECT_DB', 'FILE_UPLOAD', 'EXTERNAL_POSTGRESQL')),
    environment TEXT NOT NULL DEFAULT 'development' CHECK (environment IN ('development', 'staging', 'production')),
    host TEXT CHECK (host IS NULL OR char_length(trim(host)) >= 1),
    port INTEGER CHECK (port IS NULL OR (port >= 1 AND port <= 65535)),
    database_name TEXT CHECK (database_name IS NULL OR char_length(trim(database_name)) >= 1),
    auth_type TEXT NOT NULL DEFAULT 'NONE' CHECK (auth_type IN ('NONE', 'SECRET_REF', 'SERVICE_ROLE')),
    credential_secret_ref TEXT CHECK (credential_secret_ref IS NULL OR char_length(trim(credential_secret_ref)) >= 1),
    owner_team TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ERROR', 'DEPRECATED')),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_data_source_project_name UNIQUE (project_id, source_name),
    CONSTRAINT uq_data_source_id_project UNIQUE (source_id, project_id)
);

-- Trigger: Reliably derive and validate organisation_id from project_id before NOT NULL check
CREATE OR REPLACE FUNCTION public.sync_data_source_organisation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT organisation_id INTO v_org_id FROM public.projects WHERE id = NEW.project_id;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Referenced project (%) does not exist or has no organisation', NEW.project_id;
    END IF;
    IF NEW.organisation_id IS NOT NULL AND NEW.organisation_id <> v_org_id THEN
        RAISE EXCEPTION 'data_source organisation_id (%) does not match project organisation_id (%)', NEW.organisation_id, v_org_id;
    END IF;
    NEW.organisation_id := v_org_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_data_source_sync_organisation ON public.data_source;
CREATE TRIGGER trg_data_source_sync_organisation
BEFORE INSERT OR UPDATE ON public.data_source
FOR EACH ROW EXECUTE FUNCTION public.sync_data_source_organisation();

-- 4. CATALOG_ASSET Table
CREATE TABLE IF NOT EXISTS public.catalog_asset (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    schema_id UUID REFERENCES public.schemas(id) ON DELETE SET NULL,
    generated_table_id UUID REFERENCES public.generated_tables(id) ON DELETE SET NULL,
    schema_name TEXT NOT NULL CHECK (char_length(trim(schema_name)) >= 1),
    asset_name TEXT NOT NULL CHECK (char_length(trim(asset_name)) >= 1),
    asset_type TEXT NOT NULL DEFAULT 'TABLE' CHECK (asset_type IN ('TABLE', 'VIEW', 'FILE_SCHEMA')),
    fq_name TEXT NOT NULL CHECK (char_length(trim(fq_name)) >= 1),
    owner_steward TEXT,
    classification TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'DEPRECATED')),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_catalog_asset_source FOREIGN KEY (source_id, project_id) REFERENCES public.data_source(source_id, project_id) ON DELETE CASCADE,
    CONSTRAINT uq_catalog_asset_source_fqname UNIQUE (source_id, fq_name),
    CONSTRAINT uq_catalog_asset_id_project UNIQUE (asset_id, project_id)
);

-- Trigger: Validate schema_id and generated_table_id belong to same project
CREATE OR REPLACE FUNCTION public.check_catalog_asset_project_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.schema_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.schemas s WHERE s.id = NEW.schema_id AND s.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'catalog_asset schema_id (%) does not belong to project_id (%)', NEW.schema_id, NEW.project_id;
    END IF;

    IF NEW.generated_table_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.generated_tables gt WHERE gt.id = NEW.generated_table_id AND gt.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'catalog_asset generated_table_id (%) does not belong to project_id (%)', NEW.generated_table_id, NEW.project_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_asset_project_consistency ON public.catalog_asset;
CREATE TRIGGER trg_catalog_asset_project_consistency
BEFORE INSERT OR UPDATE ON public.catalog_asset
FOR EACH ROW EXECUTE FUNCTION public.check_catalog_asset_project_consistency();

-- 5. ASSET_COLUMN Table
CREATE TABLE IF NOT EXISTS public.asset_column (
    column_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.catalog_asset(asset_id) ON DELETE CASCADE,
    column_name TEXT NOT NULL CHECK (char_length(trim(column_name)) >= 1),
    data_type TEXT NOT NULL CHECK (char_length(trim(data_type)) >= 1),
    ordinal_position INTEGER NOT NULL CHECK (ordinal_position >= 0),
    is_pk BOOLEAN NOT NULL DEFAULT false,
    is_nullable BOOLEAN NOT NULL DEFAULT true,
    classification TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_asset_column_asset_name UNIQUE (asset_id, column_name),
    CONSTRAINT uq_asset_column_asset_position UNIQUE (asset_id, ordinal_position)
);

-- 6. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_data_source_project_id ON public.data_source(project_id);
CREATE INDEX IF NOT EXISTS idx_data_source_org_id ON public.data_source(organisation_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_project_id ON public.catalog_asset(project_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_source_id ON public.catalog_asset(source_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_schema_id ON public.catalog_asset(schema_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_generated_table_id ON public.catalog_asset(generated_table_id);
CREATE INDEX IF NOT EXISTS idx_asset_column_asset_id ON public.asset_column(asset_id);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.data_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_column ENABLE ROW LEVEL SECURITY;

-- 8. Strict Tenant-Isolated RLS Policies
-- DATA_SOURCE Policies
DROP POLICY IF EXISTS data_source_select ON public.data_source;
CREATE POLICY data_source_select ON public.data_source
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS data_source_insert ON public.data_source;
CREATE POLICY data_source_insert ON public.data_source
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS data_source_update ON public.data_source;
CREATE POLICY data_source_update ON public.data_source
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS data_source_delete ON public.data_source;
CREATE POLICY data_source_delete ON public.data_source
  FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

-- CATALOG_ASSET Policies
DROP POLICY IF EXISTS catalog_asset_select ON public.catalog_asset;
CREATE POLICY catalog_asset_select ON public.catalog_asset
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_asset_insert ON public.catalog_asset;
CREATE POLICY catalog_asset_insert ON public.catalog_asset
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_asset_update ON public.catalog_asset;
CREATE POLICY catalog_asset_update ON public.catalog_asset
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_asset_delete ON public.catalog_asset;
CREATE POLICY catalog_asset_delete ON public.catalog_asset
  FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

-- ASSET_COLUMN Policies
DROP POLICY IF EXISTS asset_column_select ON public.asset_column;
CREATE POLICY asset_column_select ON public.asset_column
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND public.user_has_project_access(ca.project_id)
  ));

DROP POLICY IF EXISTS asset_column_insert ON public.asset_column;
CREATE POLICY asset_column_insert ON public.asset_column
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND public.user_has_project_access(ca.project_id)
  ));

DROP POLICY IF EXISTS asset_column_update ON public.asset_column;
CREATE POLICY asset_column_update ON public.asset_column
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND (ca.created_by = auth.uid() OR public.is_project_creator(ca.project_id))
      AND public.user_has_project_access(ca.project_id)
  ));

DROP POLICY IF EXISTS asset_column_delete ON public.asset_column;
CREATE POLICY asset_column_delete ON public.asset_column
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND (ca.created_by = auth.uid() OR public.is_project_creator(ca.project_id))
      AND public.user_has_project_access(ca.project_id)
  ));
```

---

## 6. Stage 1 Execution and Live Verification Record

- **Executed At:** 2026-10-09T15:18:00+05:30
- **Target Database:** Supabase Project `reoeqprvfpdwdmnibdcl` (`aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres`)
- **Migration File:** `RapidInsight-Backend/backend/migrations/003_create_data_catalog_tables.sql`
- **Execution Result:** **SUCCESS** (`STAGE_1_MIGRATION_SUCCESS` within a single atomic transaction).
- **Post-Execution Introspection Proofs:**
  1. **Tables Created:**
     - `public.data_source`
     - `public.catalog_asset`
     - `public.asset_column`
  2. **Foreign Keys & Integrity Constraints Verified:**
     - `data_source` → `projects(id) ON DELETE CASCADE`, `organisations(id) ON DELETE CASCADE`, `auth.users(id) ON DELETE RESTRICT`. Unique constraints: `(project_id, source_name)`, `(source_id, project_id)`.
     - `catalog_asset` → `(source_id, project_id) REFERENCES data_source(source_id, project_id) ON DELETE CASCADE`, `projects(id) ON DELETE CASCADE`, `schemas(id) ON DELETE SET NULL`, `generated_tables(id) ON DELETE SET NULL`, `auth.users(id) ON DELETE RESTRICT`. Unique constraints: `(source_id, fq_name)`, `(asset_id, project_id)`.
     - `asset_column` → `catalog_asset(asset_id) ON DELETE CASCADE`. Unique constraints: `(asset_id, column_name)`, `(asset_id, ordinal_position)`.
  3. **Triggers Active:**
     - `trg_data_source_sync_organisation` on `public.data_source` (BEFORE INSERT/UPDATE)
     - `trg_catalog_asset_project_consistency` on `public.catalog_asset` (BEFORE INSERT/UPDATE)
  4. **Performance Indexes Active:**
     - `idx_data_source_project_id`, `idx_data_source_org_id`
     - `idx_catalog_asset_project_id`, `idx_catalog_asset_source_id`, `idx_catalog_asset_schema_id`, `idx_catalog_asset_generated_table_id`
     - `idx_asset_column_asset_id`
  5. **Row Level Security (RLS) Active:**
     - `rowsecurity = true` verified on all 3 tables.
     - 12 strict tenant-isolated RLS policies verified across `SELECT`, `INSERT`, `UPDATE`, `DELETE`.

---

## 7. Stage 2 Metadata Ingestion Implementation & Test Verification

- **Implemented Service:** `RapidInsight-Backend/backend/services/schema-service/src/services/catalogIngestionService.js`
- **Hooked Handlers:**
  - `schemaController.uploadSchema`: Registers `source_type = 'FILE_UPLOAD'`, `asset_type = 'FILE_SCHEMA'`, linking `schema_id`. (Metadata-only; no access to raw business data is claimed).
  - `dbConnectionService.importTablesAsSchemas`: Registers `source_type = 'EXTERNAL_POSTGRESQL'`, `asset_type = 'TABLE'`. Database connection passwords are stripped, recording host/port/db with `auth_type = 'NONE'`.
- **Idempotency Guarantee:**
  - `data_source` upserts on `(project_id, source_name)`.
  - `catalog_asset` upserts on `(source_id, fq_name)`.
  - `asset_column` transactionally flushes previous columns for the asset prior to bulk insertion, eliminating ordinal position collisions.
- **Automated Test Suite:** `RapidInsight-Backend/tests/catalogIngestion.test.js`
  - **Test 1 (Initial Ingestion):** Passed. Created 1 source, 1 asset, 3 columns.
  - **Test 2 (Idempotency & Re-ingestion):** Passed. Maintained exact source and asset UUIDs, successfully updating/pruning columns.
  - **Test 3 (Validation):** Passed. Empty column array rejected with clean 400 error.
  - **Test 4 (Tenant Isolation):** Passed. Trigger `trg_data_source_sync_organisation` rejected cross-tenant/unauthorized project IDs.
  - **Test 5 (Database Import & Security):** Passed. External PostgreSQL source registered with zero stored credentials.

---

## 8. Stage 3 Backend Profiling API Implementation & Test Verification

- **Implemented Endpoints (mounted in `schema-service` under `/schema/catalog` and forwarded by Gateway `/schema/catalog`):**
  - `GET /schema/catalog/sources?projectId=:projectId`: Lists active data sources for the authorized project.
  - `GET /schema/catalog/assets?projectId=:projectId&sourceId=:sourceId`: Lists assets for the source, reporting `is_populated` and `row_count`.
  - `GET /schema/catalog/columns?projectId=:projectId&assetId=:assetId`: Lists columns for the asset with data types and nullability.
  - `POST /schema/catalog/profile-stat`: Body `{ projectId, columnId, statistic }`. Computes `NULL_COUNT`, `COUNT`, `DISTINCT_COUNT`, `MIN`, `MAX`, `AVG`.
- **Security & Integrity Safeguards:**
  - **No Client Identifiers:** Client provides only `{ columnId, statistic }`. Physical schema, physical table, and column names are resolved strictly from verified database records.
  - **Safe Identifier Quoting:** All physical identifiers are quoted via `"${identifier.replace(/"/g, '""')}"`.
  - **Type Enforcement:** Non-numeric columns requesting `MIN`, `MAX`, or `AVG` are rejected with `400 BAD REQUEST` (`UNSUPPORTED_STATISTIC_FOR_DATA_TYPE`).
  - **Unpopulated Guardrail:** Unpopulated schemas or assets missing backed database tables are rejected with `422 UNPROCESSABLE ENTITY` (`SOURCE_TABLE_NOT_POPULATED`).
  - **Timeout:** Enforces `SET statement_timeout = 5000` (5s maximum).
  - **Authorization:** Direct access and service paths verify project membership via `projectAccessService.getProjectForEmployee`.
- **Automated Test Suite:** `RapidInsight-Backend/tests/catalogProfiling.test.js`
  - **Test 1 (List Sources):** Passed.
  - **Test 2 (List Assets):** Passed with `is_populated = true`.
  - **Test 3 (List Columns):** Passed. Introspected 22 columns.
  - **Test 4 (COUNT, NULL_COUNT, DISTINCT_COUNT):** Passed on live 286-row physical table.
  - **Test 5 (MIN, MAX, AVG):** Passed on numeric column `sl_no` (MIN: 1, MAX: 257, AVG: 116.514).
  - **Test 6 (Type Safety):** Passed. AVG on text column cleanly rejected.
  - **Test 7 (Unpopulated Schema Guardrail):** Passed. Profiling on unpopulated asset cleanly rejected.
  - **Test 8 (Cross-Tenant Access):** Passed. Profiling attempt across tenant/project rejected.
  - **Test 9 (SQL Injection Attempt):** Passed. Payload in statistic rejected safely.
  - **Test 10 (Physical Column Drift):** Passed. Column missing in physical PostgreSQL table caught with `422 PHYSICAL_COLUMN_NOT_FOUND`.
- **Connection Leak & Session Guard:** `SET statement_timeout = 0` is executed in the `finally` block before releasing pooled connections.

---

## 9. Stage 4 Frontend UI Implementation & Build Verification

- **Route Added:** `/projects/:projectId/catalog` mounted in `App.jsx` under protected project layout.
- **Sidebar Navigation:** Added "Data Catalog" link with the dedicated catalog SVG icon in `Sidebar.jsx`.
- **API Client:** Created `RapidInsight-Frontend/src/api/catalogApi.js` connecting to Gateway routes (`/schema/catalog/*`).
- **Page Component:** Created `DataCatalogPage.jsx` and `DataCatalogPage.css` featuring:
  - **Initial State:** Centered empty state with `+ Add Profiling Query` button.
  - **Cascading Selectors:** Source → Asset (with populated/unpopulated badges) → Column (with type pill) → Statistic.
  - **Strict Downstream Reset:** Changing an upstream dropdown automatically clears and resets all downstream selections.
  - **Numeric Filtering:** `MIN`, `MAX`, and `AVG` are only offered when a numeric column type is selected.
  - **Readiness Guardrail:** Surfaces clear warnings when an asset is not yet backed by a populated database table, disabling the Run button.
  - **Execution Results Card:** Displays returned metric value, sample size, server execution duration (ms), and target column metadata.
- **Build Verification:**
  - `npm run build` executed via Vite.
  - **Result:** **PASSED** (163 modules transformed, 0 errors, build completed in 6.69s).

---

## 10. Stage 5 End-to-End Verification Report

- **Automated Verification Suite:**
  - `node RapidInsight-Backend\tests\catalogProfiling.test.js`: **PASSED** (10 of 10 checks passed, exit code 0).
  - `npm run build --prefix RapidInsight-Frontend`: **PASSED** (163 modules transformed, 0 bundle or syntax errors, exit code 0).
- **Live User Journey Verification:**
  1. **Empty State & Add Flow:** Initially presents empty card with centered action; clicking displays query configuration form.
  2. **Cascading Hierarchy:** Source dropdown populates live assets; selecting an asset populates columns; selecting a column unlocks allowed statistics.
  3. **Strict Downstream Reset:** Changing an upstream dropdown cleanly resets all downstream selections and clears old results.
  4. **Dynamic Statistic Filtering:** `MIN`, `MAX`, `AVG` are strictly restricted to numeric types (`number`, `integer`, `float`, etc.). Text/boolean columns only display `COUNT`, `NULL_COUNT`, and `DISTINCT_COUNT`.
  5. **Physical Table Readiness Guardrail:** Unpopulated assets display a clear warning banner and disable the Run button.
  6. **Live Query Execution:** Ran `COUNT` (286), `NULL_COUNT` (0), `DISTINCT_COUNT` (286), `MIN` (1), `MAX` (257), `AVG` (116.514) on live PostgreSQL tables, accurately displaying server metrics and millisecond durations.
  7. **Security & Injection Prevention:** Zero client SQL; strict identifier escaping; cross-tenant and invalid project access rejected by backend authorization.
- **Known Limitations & Next Boundaries:**
  - Historical query logs, data lineage, automated profiling schedules, and external live data connections remain reserved for subsequent project phases.



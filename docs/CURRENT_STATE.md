# RapidInsightStudio — Current State Report

---

## 1. Project Status Metrics

```text
Frontend:        92%
Backend:         90%
Integration:     88%
Infrastructure:  85%
Testing:         25%
Documentation:   98%
--------------------
Overall:         80%
```

---

## 2. Status Breakdown by Subsystem

### 2.1 Frontend (92%)
- **Strengths:**
  - Modern, responsive React 18 single-page application built on Vite.
  - Complete primary user workflow: Authentication → Projects → Project Workspace → Upload Schema → Schema Playground (interactive graph canvas with minimap and node inspection) → Generated Tables Viewer → Analytics Reports (KPI metric cards, Chart.js visual charts, and AI-authored observations).
  - Clean theme switching (light/dark mode) and layout management.
- **Identified Deficiencies:**
  - `AuthContext.jsx` did not export `getAccessToken`, `signOut`, or `user`, causing unhandled exceptions in legacy pages (`SchemaUploadPage`, `MySchemasPage`, `StoragePage`, `WorkspacePage`, and legacy `Sidebar`). Fixed.
  - `supabaseClient.js` threw an immediate top-level exception at module import time if `VITE_SUPABASE_URL` was unset. Fixed.

### 2.2 Backend (90%)
- **Strengths:**
  - Highly decoupled 9-microservice architecture with Express.js and FastAPI.
  - Dedicated API Gateway enforcing JWT verification, security headers (Helmet), structured request logging (Pino), and rate limiting.
  - Sophisticated AI prompt engineering and automated repair loops across 6 interchangeable LLM providers.
  - Synthetic data pipeline combining LLM seed generation, PyTorch TVAE / Gaussian Copula models in SDV, and programmatic relational key integrity.
  - Secure LLM SQL execution with AST parser validation and table whitelisting.
- **Identified Deficiencies:**
  - `report-service` (`PORT 3004`) and `export-service` (`PORT 3009`) exist solely as health-check placeholder stubs; production reporting logic is currently co-located in `table-service`.
  - SQL KPI execution currently executes using the primary database connection rather than a restricted read-only PostgreSQL role.

### 2.3 Integration (88%)
- **Strengths:**
  - Unified Gateway proxying with transparent header injection (`x-user-id`, `x-user-email`, `x-internal-service-key`).
  - Coordinated inter-service communication (`table-service` → `ai-service`, `table-service` → `datagen-service` → `sdv-service`).
- **Identified Deficiencies:**
  - Need to populate individual `.env` files for frontend and backend microservices.

### 2.4 Infrastructure (85%)
- **Strengths:**
  - Automated Python SDV environment setup script (`backend/scripts/setup-sdv.js`) handling PyTorch CPU-only installation and Windows path length mitigations.
  - Concurrently runner (`npm run dev --prefix backend`) for parallel multi-service process orchestration.
  - Dynamic PostgreSQL schema provisioning per organization and project.
- **Identified Deficiencies:**
  - Lack of containerization files (`Dockerfile`, `docker-compose.yml`).

### 2.5 Testing (25%)
- **Strengths:**
  - Health check endpoints on all microservices (`/health`, `/ready`, `/check:sdv`).
- **Identified Deficiencies:**
  - No automated unit or end-to-end test suites committed in repositories.

### 2.6 Documentation (98%)
- **Strengths:**
  - Complete engineering source of truth (`PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, `MEMORY.md`, `AGENT.md`).
  - Detailed internal HTML documentation (`RAPIDINSIGHT_STUDIO_DOCUMENTATION.html`).

---

## 3. Data Catalog Subsystem Status

- **Stage 1 (Database Migration):** Completed and verified live in Supabase (`data_source`, `catalog_asset`, `asset_column`).
- **Stage 2 (Metadata Ingestion):** Completed. Schema file uploads and database table imports register metadata into the catalog with full idempotency, zero credential exposure, and tenant validation.
- **Stage 3 (Profiling & Query Execution Backend):** Completed. Cascading metadata endpoints (`/sources`, `/assets`, `/columns`) and safe SQL profiling endpoint (`/profile-stat`) implemented, secured against SQL injection, and verified against live physical tables.

- **Stage 4 (Frontend UI):** Completed. Added `DataCatalogPage` with clean empty state, Add flow, cascading dropdowns, numeric-only stat filter, readiness guardrail banner, and execution results card. Build verified.
- **Stage 5 (End-to-End Verification):** Completed. Full user journey verified: empty state, guided cascade, numeric stat restrictions, unpopulated table guardrails, execution result rendering, and security isolation.
- **Stage 6 (Profiling History & Repeat Runs Persistence):** Completed.
  - Implemented `public.catalog_profiling_result` table in Supabase PostgreSQL with RLS and composite indexing on `(project_id, created_at DESC)`.
  - Added backend endpoint `GET /schema/catalog/profiling-history` and updated `POST /schema/catalog/profile-stat` to automatically persist execution metrics to PostgreSQL.
  - Preserved Query Configuration layout, styling, and dropdowns completely untouched while enabling repeated profiling runs.
  - Added "+ Run Another Profiling" convenience trigger in results header.
  - Added Profiling History table component in `DataCatalogPage.jsx` displaying run timestamp, source, asset, column, statistic, result, sample size, and duration.
  - Verified 19/19 integration tests in `tests/profilingHistory.test.js` covering cross-session re-login persistence, multi-run retention, and tenant isolation.


## 4. Report Generation Diagnostics & Fixes

- **Resolved Issue:** Report generation falsely completed with `report_status = 'ready'` while returning 0 KPIs and 0 charts.
- **Root Cause:**
  - `generateSqlDashboard` swallowed individual query execution errors and unconditionally called `markDashboardReady` even when no metrics were generated.
  - Overly restrictive shaping in `deriveChartShape` and `shapeDashboardResult` discarded valid single-row charts, ID-grouped charts, numeric-label charts (e.g. years), and multi-column KPI results.
  - `retryDataInsertForProject` called the legacy planner instead of `generateSqlDashboard`.
- **Targeted Fixes:**
  - Enforced status integrity: `generateSqlDashboard` and `generateDashboardReport` now mark the dashboard as `failed` with descriptive errors if 0 metrics are produced, and throw to update `project_data_models.last_step` to `'report_failed'`.
  - Relaxed result shaping: Supported single-row charts (`rows.length >= 1`), numeric-label charts, ID-grouped charts, and resilient single-row KPI extraction.
  - Preserved `custom_kpis` on `blueprint` so retry flows invoke the SQL KPI execution engine.
  - Updated frontend `ReportStatePanel` and `ProjectReportPage` to display clear, actionable unavailable/error states when no report metrics exist.
  - Added backend regression test suite `tests/reportGeneration.test.js`.

---

## 5. Project Ownership and Access Restriction (Cross-User Isolation)

- **Resolved Issue:** Users logging in were able to see and access projects, schemas, tables, dashboards, data models, and catalog metadata created by other users.
- **Root Cause Analysis:**
  1. **Permissive Database RLS Policies:**
     - `public.projects` had SELECT policy `projects_select_all_authenticated` with `qual = true`, allowing any authenticated user to view all projects in the database.
     - `public.schemas`, `public.generated_tables`, and `public.dashboards` similarly had `*_select_all_authenticated` policies with `qual = true`.
     - `public.project_data_models` had policies checking only `auth.role() = 'authenticated'` without scoping to project access.
  2. **Overly Broad Organisation Lookup & Access Logic:**
     - The helper function `public.user_has_project_access(p_project_id)` checked `p.created_by = auth.uid() OR p.organisation_id IN (SELECT o.id FROM public.organisations o WHERE o.created_by = auth.uid())`.
     - In `customerService.js`, `findOrCreateCustomerOrganisation` searched organisations by `normalized_name` without scoping to `created_by = userId`.
     - Because "Rapid Insight Studio" is the default organisation, all users shared the single organisation created by the first admin user, unintentionally granting access across users.
  3. **Absence of Backend Service Authorization Guards:**
     - `listAllProjects` in `projectService.js` queried `projects` without passing `created_by = userId`.
     - `schemaController.js` and `tableController.js` did not consistently verify whether the requesting user owned the `projectId` supplied in query parameters or URL routes.
- **Implementation & Defense-in-Depth Solution:**
  1. **PostgreSQL RLS Migration (`005_restrict_projects_and_resources_rls.sql`):**
     - Updated `public.user_has_project_access` and `public.is_project_creator` helper functions to strictly require `p.created_by = auth.uid()`.
     - Dropped permissive `*_select_all_authenticated` policies and instituted strictly authorized policies on `public.projects`, `public.schemas`, `public.generated_tables`, `public.dashboards`, and `public.project_data_models`.
     - Scoped `public.projects` DELETE policy to `projects_delete_creator` (`created_by = auth.uid()`).
  2. **Backend Defense-in-Depth Service Guards:**
     - `projectService.js`: Scoped `listAllProjects` and `getProjectById` to require matching `created_by = userId`.
     - `projectController.js`: Enforced user ownership verification in `listProjects`, `getProject`, `getProjectDashboard`, and `deleteProjectHandler`.
     - `schema-service`: Updated `getProjectForEmployee` to accept `userId` and throw `404 Not Found` / `403 Forbidden` if unauthorized. Guarded `uploadSchema`, `listSchemas`, `getSchemaById`, `getProjectSeedStatus`, `retrySeedRows`, `deleteSchema`, and `importDatabaseTables`.
     - `catalogController.js`: Guarded `getSources`, `getAssets`, `getColumns`, `profileStat`, and `getProfilingHistory` by enforcing `userId` checks on `getProjectForEmployee`.
     - `table-service`: Guarded `listTables`, `getProjectDataModelHandler`, `generateTablesForProjectHandler`, and `retryDataInsertHandler` against unauthorized project IDs.
- **Verification Results:**
  - Automated integration test suite `RapidInsight-Backend/tests/projectAuthorization.test.js` executed with **33/33 assertions passing**:
    - User A and User B unique registration and token isolation verified.
    - Project creation correctly binds backend `created_by` to authenticated JWT user ID.
    - `/projects` listing strictly isolates User A projects from User B projects.
    - Direct access (`GET /projects/:projectId`, `GET /projects/:projectId/dashboard`) on other users' projects returns `404 Not Found`.
    - Project deletion by unauthorized user returns `404 Not Found` and leaves the owner's project completely intact.
    - Child resources (schemas, tables, data models, catalog sources, profiling) reject unauthorized access.
    - User logout and re-login correctly preserves project ownership and isolation.
    - Direct Supabase client queries confirm complete database-level RLS shielding.
  - Regression test suites `tests/catalogProfiling.test.js` (10/10 tests) and `tests/profilingHistory.test.js` (19/19 tests) passed with zero regressions.

---

## 6. Physical Project Schema Creation & Idempotency Fix

- **Reported Issue:** When creating a new project ("TNEA College"), the modal displayed the error `schema "sudhakar_org_tnea_college" already exists`, but upon refreshing the page, the project appeared in the projects list (with `schema_status: 'failed'`).
- **Root Cause:**
  1. `createPhysicalProjectSchema` in `projectService.js` executed `CREATE SCHEMA "..."` without `IF NOT EXISTS`. If the schema already existed in PostgreSQL, PostgreSQL threw a duplicate schema error.
  2. In `createProject`, the project row was inserted into `public.projects` *before* creating the physical PostgreSQL schema. When schema creation threw an error, the catch block updated `schema_status: 'failed'` and re-threw, returning a 500 error to the frontend while leaving the project row in `public.projects`.
  3. Schema name generation in `buildProjectSchemaName` was purely deterministic (`${orgPart}_${projectPart}`) without checking if the schema name was already assigned to another project or contained existing tables.
- **Fixes Applied:**
  1. Updated `createPhysicalProjectSchema` to execute `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`.
  2. Added `isSchemaInUse(schemaName, excludeProjectId)` check in `projectService.js`: if another project is already using the schema or existing tables reside in it, a short project-specific suffix (`_${projectId.slice(0, 8)}`) is appended to guarantee complete isolation.
  3. If schema creation fails unexpectedly, `createProject` now rolls back by deleting the inserted project row rather than leaving an orphaned `'failed'` project in `public.projects`.
  4. Healed existing failed projects in database to `schema_status = 'ready'`.

---

## 7. Custom KPI Execution & Formatting Diagnostics

- **Reported Issue:** When users add a custom target KPI (e.g. `"district by college"`, `"Total colleges"`), the table generation / report pipeline failed with the error: `"No KPI or chart metrics could be calculated from the project data."`.
- **Root Cause Analysis:**
  1. **Ambiguous Prompt for LLM SQL KPI Generation:**
     - In `ai-service/src/prompts/sqlKpiPrompt.js`, Rule 6 previously stated: `"Always select explicit, named columns or clear aggregate expressions. Never use SELECT *"`.
     - For metric requests describing breakdowns such as `"district by college"` or `"colleges by district"`, the AI wrote raw, unaggregated SELECT statements (`SELECT district, college_name FROM colleges_db_df_ac97521a65`) with `chart_type: "bar"`.
  2. **Missing Categorical Frequency Chart Shaping:**
     - When the query executed and returned rows with two text columns (`district` and `college_name`), `deriveChartShape` in `table-service/src/services/sqlKpiExecutionService.js` required exactly one numeric measure column (`valueColumns.length === 1`).
     - Since both columns were text strings, `deriveChartShape` returned `null`.
  3. **Omission of Multi-Row Results Without Explicit `chart_type`:**
     - In `shapeDashboardResult`, queries returning multiple rows (`rows.length > 1`) were only considered for charting if `item.chart_type` was explicitly truthy. If `chart_type` was omitted or null, the result was discarded.
  4. **Silent Error Swallowing in Shaping Loop:**
     - When `shapeDashboardResult` returned `null`, `sqlKpiExecutionService.js` logged a console warning and continued without assigning `lastExecutionError`.
     - When all queries failed shaping, the generic fallback message `'No KPI or chart metrics could be calculated from the project data.'` was raised instead of reporting the actual query outcome.
- **Targeted Fixes Applied:**
  1. **Explicit Numeric Analytics Prompt (`sqlKpiPrompt.js`):**
     - Updated Rule 6 in both `buildSqlKpiPrompt` and `buildSqlKpiSafetyRepairPrompt`:
       - For chart metrics / breakdown requests (`chart_type` specified or "X by Y"): query **MUST** `GROUP BY` the dimension column and compute a numeric aggregate (`COUNT(*)`, `SUM(col)`, `AVG(col)`). Never return multiple text/string columns without an aggregate measure.
       - For scalar KPI cards (`chart_type: null`): query **MUST** return a single row with an aggregate numeric measure (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`).
  2. **Resilient Categorical Chart Shaping (`sqlKpiExecutionService.js`):**
     - Enhanced `deriveChartShape` to gracefully handle raw categorical rows: if all candidate columns are categorical, it automatically aggregates frequency counts per primary category (e.g. counting items per district), outputting a valid distribution chart (`labels`, `values`).
     - Enhanced `shapeDashboardResult` to chart multi-row results even when `item.chart_type` is omitted or null (defaulting to `'bar'`).
     - Tracked descriptive `lastExecutionError` when shaping fails so diagnostics are transparent.
     - Exported `deriveChartShape` and `shapeDashboardResult` for regression testing.
  3. **Regression Tests (`tests/reportGeneration.test.js`):**
     - Added test cases covering single KPI shaping, multi-row charts, untyped multi-row charts, and categorical frequency aggregation.
- **Verification Results:**
  - Tested live execution against project `27aa2db3-fcbf-40d4-bad3-10016fe7baca` with target KPI `"district by college"`:
    - SQL planned: `SELECT district, COUNT(college_name) AS "total_colleges" ... GROUP BY district ORDER BY total_colleges DESC`
    - Successfully executed and shaped into bar chart (54 districts, values 50, 28, 25, 24...)
    - Generated 4 analytical AI insights.
    - Dashboard persisted with `report_status: 'ready'` and `error_message: null`.
  - Regression test suites passed:
    - `tests/reportGeneration.test.js` (4/4 PASS)
    - `tests/addCatalogEntryWorkflow.test.js` (PASS)
    - `tests/profilingHistory.test.js` (19/19 PASS)
    - `tests/projectAuthorization.test.js` (33/33 PASS)

---

## 8. Data Catalog Automatic Synchronization of Overview Assets

- **Reported Issue:**
  - In the Data Catalog section (`/projects/:projectId/catalog`), users were greeted with an empty configuration banner:
    > *"No Catalog Profiling Configured. Connect an asset, choose a column, and configure statistical queries such as null count, distinct count, or averages. [+ Add Catalog]"*
  - Clicking `+ Add Catalog` prompted users to upload schemas or connect a database again, even though schemas and physical tables had already been uploaded and registered in the database from the project's **Overview** section.
- **Root Cause Analysis:**
  - `registerCatalogMetadata` was previously only invoked in the POST `/schema/upload` route handler.
  - Projects with schemas uploaded previously, or imported/generated outside that single endpoint, had entries in `public.schemas` and `public.generated_tables`, but `0` records in `public.data_source` and `public.catalog_asset`.
  - When `getCatalogSources(projectId)` was fetched by `DataCatalogPage.jsx`, an empty array was returned. The frontend responded by closing the query builder (`isBuilderOpen = false`) and displaying the empty state card prompting the user to upload schema files again.
- **Targeted Fixes Applied:**
  1. **Automatic Schema & Table Synchronization (`catalogProfilingService.js`):**
     - Implemented `syncProjectSchemasToCatalog({ project, projectId, userId, supabase })`.
     - Introspects `public.schemas` for the current project.
     - For any schema not yet present in `public.catalog_asset`, it automatically extracts column definitions (from `public.generated_tables` via `information_schema.columns` or downloaded schema JSON), creates/links the `"Uploaded Schema Files"` data source, registers all assets and columns via `registerCatalogMetadata`, and associates the physical `generated_table_id`.
     - Automatically flags the asset as populated (`is_populated = true`), enabling instant statistical profiling without manual intervention.
  2. **Controller Hooking (`catalogController.js`):**
     - Hooked `syncProjectSchemasToCatalog` directly into `getSources` and `getAssets` endpoints.
     - When any user opens the Data Catalog page, the backend seamlessly auto-syncs any registered project schemas before returning sources and assets.
  3. **Frontend Add Catalog Behavior & Layout (`DataCatalogPage.jsx`):**
     - Removed the redundant `+ Add Catalog` button from the top-right header bar.
     - Removed `UploadSchemaPanel` and modal backdrop popup completely.
     - Fixed `handleAddCatalog` and `loadCatalogData`: eliminated the `else { setIsBuilderOpen(false); }` race condition that was resetting the builder to `false` when sources were empty, preventing the button from opening.
     - Clicking `+ Add Catalog` now directly opens the **Query Configuration** section with its 4-step selection workflow (1. Project Source -> 2. Asset / Table -> 3. Asset Column -> 4. Profiling Statistic).
- **Verification Results:**
  - Verified across multiple live projects: all existing project schemas automatically synced into the catalog.
  - Query Configuration builder loads directly with all project assets, columns, and profiling options populated.
  - Regression test suites passed:
    - `tests/catalogProfiling.test.js` (10/10 PASS)
    - `tests/addCatalogEntryWorkflow.test.js` (PASS)
    - `tests/profilingHistory.test.js` (19/19 PASS)

---

## 9. Registry Asset Page & Physical Data Loading Architecture

- **Requirement:**
  - Provide a dedicated **Registry Assest** section in the project sidebar directly below **Overview & Schema** for schema file uploads and database connections.
  - End-to-end data pipeline: On uploading a schema/data file or importing tables from a database connection:
    1. Register the asset in the catalog metadata registry.
    2. Validate the incoming schema and actual data rows before altering existing state.
    3. If the table does not exist: create the physical table in the project's PostgreSQL physical schema and load actual data rows (CSV/JSON records) or 0 rows (schema-only definitions).
    4. If the table exists with identical schema and data: block the duplicate upload with HTTP 409 (`DUPLICATE_TABLE_BLOCKED`).
    5. If the table exists with updated schema or rows: safely replace the existing table transactionally (`BEGIN ... COMMIT`), rolling back and preserving previous data if any database error occurs.
    6. Synchronize metadata across `public.schemas` (`table_status = 'BUILT'`), `public.generated_tables` (`status = 'POPULATED'`, `row_count`), and `public.catalog_asset`.

- **Implementation Details:**
  1. **Frontend Navigation & Page Separation:**
     - Added sidebar item **Registry Assest** in `RapidInsight-Frontend/src/components/layout/Sidebar.jsx` positioned directly below `Overview & Schema`.
     - Created `RapidInsight-Frontend/src/pages/RegistryAssetPage.jsx` and `RegistryAssetPage.css`, hosting `UploadSchemaPanel` with live tabs for file upload and database connection/table discovery.
     - Registered route `/projects/:projectId/registry-asset` in `RapidInsight-Frontend/src/App.jsx`.
     - Preserved `ProjectWorkspacePage.jsx` with full-width `ProjectDetails` and `MySchemasPanel`.
  2. **Data Parsing & Extraction (`schemaParserService.js`):**
     - Updated CSV and JSON parsers to extract raw data rows alongside column definitions.
  3. **Atomic Physical Table Loader & Concurrency Lock (`physicalTableLoaderService.js`):**
     - `computeCanonicalFingerprint`: Generates deterministic SHA-256 hash across canonical column names, data types, constraints, and row data.
     - `validateIncomingData`: Validates field definitions and row shapes before any database mutation.
     - `quoteIdentifier`: Enforces standard PostgreSQL identifier quoting rules (`"${str.replace(/"/g, '""')}"`) with strict length and null-byte validation, preserving valid mixed-case identifiers and reserved keywords without unwanted character mutations.
     - `loadOrReplacePhysicalTable`:
       - Transactional advisory locking: Executes `SELECT pg_advisory_xact_lock(hashtext(lockKey))` inside the transaction, serializing parallel requests targeting the exact same project and table at the PostgreSQL engine level.
       - Re-checks existing schema inside the locked transaction; cleanly returns HTTP 409 (`DUPLICATE_TABLE_BLOCKED`) on identical duplicates.
       - Executes transactional table replacement using `BEGIN ... COMMIT` with automatic rollback on constraint violation.
       - Consolidates table DDL, batch row insertions, `public.schemas`, and `public.generated_tables` updates inside a single ACID transaction.
  4. **Database Connection Import Integration (`dbConnectionService.js`):**
     - Wired table import discovery to use `loadOrReplacePhysicalTable` for imported tables, forwarding external DB metadata to prevent duplicate catalog entries.

- **Verification Results:**
  - **Frontend Production Build:** `npm run build` completed cleanly with 0 errors (165 modules transformed, built in 16.50s).
  - **SQL Safety & Transaction Concurrency Suite (`RapidInsight-Backend/tests/sqlSafetyAndConcurrency.test.js`):**
    - `1.1 Mixed-Case Identifier Preservation`: **PASSED** (`ProductID` -> `"ProductID"`).
    - `1.2 Reserved Words Quoting`: **PASSED** (`user`, `order`, `table`, `select`, `group` quoted safely without unwanted renaming).
    - `1.3 Embedded Quote Escaping`: **PASSED** (`col"quote` -> `"col""quote"`).
    - `1.4 Injection Payload Containment`: **PASSED** (`col; DROP TABLE students; --` contained safely inside identifier quotes).
    - `1.5 Input Validation`: **PASSED** (null, empty, null bytes, and >63 length identifiers correctly rejected).
    - `1.6 Live PostgreSQL Execution`: **PASSED** (`CREATE TABLE` and `INSERT` with mixed-case and reserved keywords executed successfully).
    - `2.1 Advisory Lock Concurrency`: **PASSED** (2 parallel identical requests serialized; exactly 1 succeeded, 1 blocked with 409).
    - `2.2 Metadata Integrity Under Concurrency`: **PASSED** (confirmed exactly 1 schema, 1 generated_table, 1 catalog_asset; no orphan tables).
  - **HTTP Endpoints E2E Suite (`RapidInsight-Backend/tests/httpEndpointsE2E.test.js`):**
    - `[E2E 1] POST /schema/connect-db/test`: **PASSED** (200 OK, 93 tables discovered from external DB).
    - `[E2E 2] POST /schema/upload (Create)`: **PASSED** (201 Created, 2 rows loaded into physical table).
    - `[E2E 3] POST /schema/upload (Duplicate)`: **PASSED** (409 Conflict, duplicate upload blocked).
    - `[E2E 4] POST /schema/upload (Replace)`: **PASSED** (201 Created, `is_update: true`, 3 rows loaded).
    - `[E2E 5] GET /schema/my?projectId=...`: **PASSED** (200 OK, verified listed schema with `table_status="BUILT"`).
  - **Service-Level Regression Suite (`RapidInsight-Backend/tests/registryAssetDataLoad.test.js`):**
    - 6/6 tests **PASSED** (Create, 409 duplicate block, update replacement, validation fail, rollback, schema-only 0 rows).
  - **Deep Verification Suite (`RapidInsight-Backend/tests/verifyDataLoadDeep.test.js`):**
    - 11/11 tests **PASSED** (Metadata consistency across all state transitions, external DB import, concurrency, project security).
  - **Catalog Profiling Regression Suite (`RapidInsight-Backend/tests/catalogProfiling.test.js`):**
    - 10/10 tests **PASSED** confirming catalog profiling operations work seamlessly on populated physical tables.
  - **Verification Scope & Limitations:**
    - *Service-level tests* verify SQL builders, transactions, advisory locks, and DB constraints directly against PostgreSQL.
    - *HTTP E2E tests* verify live HTTP requests to `/schema/upload`, `/schema/connect-db/test`, and `/schema/my`.
    - *Frontend verification* was performed via production Vite build (`npm run build`, 0 errors) and code inspection of routes and components. Full headless browser-driven UI automation (e.g. Cypress/Playwright) was not executed in this environment.



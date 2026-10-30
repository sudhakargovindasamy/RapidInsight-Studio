# 02. Backend Microservices Code & Component Guide

**Project:** RapidInsight Studio  
**Classification:** Complete Backend Source Code Reference  
**Parent Directory:** `docs/Project_Documentation/`  
**Base Path:** `RapidInsight-Backend/backend/services/`

---

## 🏛️ 1. Architecture Overview

RapidInsight Studio’s backend is engineered as an event-ready microservices architecture composed of **9 specialized services** communicating via HTTP/REST with JSON payloads. Every service has dedicated configurations, route declarations, business logic controllers, database connection pools, and error handlers.

---

## 🚪 2. API Gateway Service (`services/gateway/` - Port `3000`)

The API Gateway is the single public ingress entry point for all frontend traffic.

### Core Files & Responsibilities:

#### `src/server.js` & `src/index.js`
* **Purpose:** Bootstraps the Express application, binds security headers via `helmet`, enables CORS for the frontend origin (`http://localhost:3006`), and initializes request logging with `pino-http`.
* **Database Connection:** Does not directly query PostgreSQL; forwards authenticated requests.
* **Importance:** Protects internal microservices from external exposure.

#### `src/middlewares/authMiddleware.js`
* **Purpose:** Verifies Supabase JWT tokens passed in the `Authorization: Bearer <token>` header.
* **Key Function:** Decodes the user's `sub` (UUID), email, and claims. Injects HTTP headers:
  * `X-User-Id`: Authenticated user UUID
  * `X-User-Email`: Authenticated user email address
  * `X-User-Role`: User permission role
* **Importance:** Guarantees that internal microservices receive pre-authenticated, verified identity headers without redundant token decoding in every service.

#### `src/middlewares/rateLimiter.js`
* **Purpose:** Enforces an IP-based sliding window rate limit (500 requests per 15 minutes) using `express-rate-limit`.
* **Importance:** Prevents denial-of-service (DoS) attacks and brute-force abuse.

#### `src/routes/proxyRoutes.js`
* **Purpose:** Reverse-proxy routing map directing API traffic to internal microservice ports:
  * `/api/projects/*` ➔ Project Service (`http://localhost:3007`)
  * `/api/schemas/*` ➔ Schema Service (`http://localhost:3001`)
  * `/api/catalog/*` ➔ Schema Service (`http://localhost:3001`)
  * `/api/tables/*` ➔ Table Service (`http://localhost:3003`)
  * `/api/datagen/*` ➔ Datagen Service (`http://localhost:3002`)
  * `/api/ai/*` ➔ AI Service (`http://localhost:3005`)

---

## 📂 3. Schema & Catalog Service (`services/schema-service/` - Port `3001`)

Responsible for schema ingestion, external database introspection, the unified Asset Catalog, and deterministic SQL profiling.

### Core Files & Responsibilities:

#### `src/controllers/catalogController.js`
* **Purpose:** Express route handler for all Data Catalog and Profiling endpoints.
* **Key Handlers:**
  * `listDataSources`: Fetches data origin containers (`public.data_source`) for an active project.
  * `listCatalogAssets`: Retrieves registered asset blueprints (`public.catalog_asset`) joined with source metadata.
  * `getCatalogAsset`: Fetches detailed specifications for a single catalog asset.
  * `getAssetColumns`: Fetches the column dictionary (`public.asset_column`) for an asset ordered by `ordinal_position`.
  * `profileAsset`: Executes real-time data profiling and returns statistical summaries, insights, and charts.
  * `getProfilingHistory`: Retrieves timestamped historical profiling runs from `public.catalog_profiling_result`.

#### `src/services/sqlDataProfilingService.js` (The Profiling Engine)
* **Purpose:** Executes **100% deterministic SQL statistical profiling** directly against physical PostgreSQL tables without AI.
* **Database Connection:** Checks out clients from `pg.Pool`, applies `SET statement_timeout = 8000`.
* **Key Functions:**
  * `resolveAssetPhysicalTable`: Resolves a `catalog_asset` to its physical table name and verifies that records exist.
  * `getVerifiedColumns`: Compares catalog columns with PostgreSQL `information_schema.columns`.
  * `executeTableProfiling`: Calculates `COUNT(*)`, null counts, empty strings, Min, Max, Average, Standard Deviation, Medians, Quartiles (Q1, Q3), and 5-bucket distribution histograms (`WIDTH_BUCKET`).
  * `generateRuleBasedInsights`: Translates raw stats into human-readable health badges (Healthy, Warning, Danger).
  * `buildChartDatasets`: Formats Chart.js-compatible JSON datasets for frontend graphs.
* **Importance:** The core engine powering the Data Catalog profiling UI.

#### `src/services/assetRegistrationService.js`
* **Purpose:** Handles the **Step 1 (Blueprint First)** asset registration lifecycle.
* **Key Function:** Inserts asset records into `public.data_source`, `public.catalog_asset`, and batch-inserts column specifications into `public.asset_column` inside an atomic transaction.
* **Importance:** Establishes the expected data contract before any raw files or database rows are ingested.

#### `src/services/databaseDiscoveryService.js`
* **Purpose:** Connects to external relational databases (PostgreSQL, MySQL) via temporary connection clients.
* **Key Functions:**
  * `testConnection`: Validates database host, port, credentials, and connectivity.
  * `discoverTables`: Queries external system catalogs to list available tables and views.
  * `discoverColumns`: Extracts column names, data types, and nullability flags from external tables.

#### `src/services/schemaParserService.js`
* **Purpose:** Ingests raw schema definition files uploaded by users.
* **Key Function:** Parses CSV, JSON, and YAML schema manifests, infers data types, detects primary keys, and checks delimiters.

#### `src/services/schemaDeleteService.js`
* **Purpose:** Executes safe, structured teardown of an uploaded schema.
* **Key Function:** Drops physical tables in PostgreSQL, deletes `generated_tables` rows, decouples catalog assets (`UPDATE catalog_asset SET schema_id = NULL`), and removes Supabase storage objects.

---

## 🗄️ 4. Table Service (`services/table-service/` - Port `3003`)

Responsible for creating physical PostgreSQL tables, managing row ingestion, and executing SQL KPI analytics.

### Core Files & Responsibilities:

#### `src/services/tableBuildOrchestratorService.js`
* **Purpose:** Central coordinator for building real SQL tables from uploaded files or mock requests.
* **Key Functions:**
  * `orchestrateTableBuild`: Coordinates DDL creation, row generation, and metadata tracking.
  * `createGeneratedTableMetadata`: Inserts tracking records into `public.generated_tables`.
* **Database Effects:** Instantiates real PostgreSQL tables (`public.project_customers`, `public.orders`, etc.).

#### `src/services/physicalTableService.js`
* **Purpose:** Generates and executes native PostgreSQL `CREATE TABLE` DDL queries.
* **Key Functions:**
  * Maps generic types (`number`, `string`, `datetime`) to native PostgreSQL types (`numeric`, `text`, `timestamptz`).
  * Safely quotes identifiers (`"schema"."table"`) to eliminate SQL injection vulnerabilities.

#### `src/services/sqlKpiExecutionService.js`
* **Purpose:** Analytics execution loop. Translates business KPI targets into verified SQL queries.
* **Key Function:** Executes parameterized aggregate queries against generated tables and packages results into live Chart.js widgets.
* **Importance:** Delivers the executive dashboard deliverables shown on the `ProjectReportPage.jsx`.

---

## 🏢 5. Project Service (`services/project-service/` - Port `3007`)

Responsible for enterprise multi-tenancy, project workspaces, user profiles, and dashboard persistence.

### Core Files & Responsibilities:

#### `src/controllers/projectController.js`
* **Purpose:** Manages collaborative project workspaces.
* **Key Handlers:**
  * `createProjectHandler`: Creates a workspace row in `public.projects` linked to `organisation_id`.
  * `listProjects`: Returns all workspaces accessible by the authenticated user.
  * `deleteProject`: Purges a project and triggers database-level cascade deletions.

#### `src/controllers/dashboardController.js`
* **Purpose:** Handles executive dashboard persistence.
* **Key Handlers:**
  * `getProjectDashboard`: Reads layout configurations from `public.dashboards` for a project.
  * `saveProjectDashboard`: Upserts layout cards, chart types, and metric formulas into `public.dashboards`.

#### `src/services/organisationService.js`
* **Purpose:** B2B multi-tenant organization manager.
* **Database Operations:** Reads and writes `public.organisations`.

#### `src/services/profileService.js`
* **Purpose:** Application profile management.
* **Database Operations:** Reads and writes `public.profiles`, linked 1:1 with `auth.users`.

---

## 🧬 6. Datagen Service (`services/datagen-service/` - Port `3002`)

Responsible for relational key assignment, constraint enforcement, and routing to the Python SDV engine.

### Core Files & Responsibilities:

#### `src/services/relationalOrchestratorService.js`
* **Purpose:** Guarantees referential integrity across related tables.
* **Key Function:** Resolves parent-child dependency trees (e.g. `customers` ➔ `orders` ➔ `order_items`). Generates parent rows first, harvests generated Primary Keys, and injects valid Foreign Keys into child records.

#### `src/services/sdvClient.js`
* **Purpose:** HTTP client wrapper for the Python SDV Service (`http://localhost:3008`).
* **Key Function:** Sends seed records to Python and receives thousands of synthesized, statistically correlated rows.

---

## 🤖 7. AI Service (`services/ai-service/` - Port `3005`)

Responsible for LLM seed row generation, KPI query authoring, and automated SQL self-repair.

### Core Files & Responsibilities:

#### `src/providers/` (`groqProvider.js`, `openaiProvider.js`, `claudeProvider.js`, `geminiProvider.js`)
* **Purpose:** Multi-provider LLM adapter pattern.
* **Importance:** Allows seamless switching between Groq, OpenAI GPT-4, Claude 3.5, and Gemini without altering application logic.

#### `src/services/seedRowService.js`
* **Purpose:** Prompts LLMs to generate high-realism seed rows (50–300 rows) with domain-accurate context (e.g., medical diagnoses, product names).

#### `src/services/sqlKpiService.js`
* **Purpose:** Converts natural language KPI prompts (e.g., *"Show monthly revenue by region"*) into safe PostgreSQL aggregate queries with AST validation.

---

## 🧠 8. SDV Synthesis Service (`services/sdv-service/` - Port `3008`)

FastAPI microservice running Python 3.12 and Synthetic Data Vault (SDV).

### Core Files & Responsibilities:

#### `app/main.py`
* **Purpose:** FastAPI server exposing `/health` and `/generate` endpoints.
* **Key Logic:** Trains Gaussian Copula and TVAE (PyTorch) mathematical models on input seed rows and samples synthetic data preserving multi-column correlations.

#### `app/synthesizer_cache.py`
* **Purpose:** Disk-based caching for trained statistical models to eliminate redundant model retraining.

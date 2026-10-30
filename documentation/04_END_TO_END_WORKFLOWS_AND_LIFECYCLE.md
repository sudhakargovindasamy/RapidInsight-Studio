# 04. End-to-End Workflows, Data Lifecycle & Documentation Maintenance Protocol

**Project:** RapidInsight Studio  
**Classification:** Complete System Lifecycle & Maintenance Procedures  
**Parent Directory:** `docs/Project_Documentation/`

---

## 🔄 1. The 5 Core System Workflows

---

### Workflow 1: User Authentication & Workspace Setup

```
[ User Registers / Logs In ]
             ↓
1. Supabase Auth creates row in auth.users (stores encrypted password hash)
             ↓
2. User enters display preferences ➔ creates row in public.profiles (1:1 with auth.users)
             ↓
3. User selects or creates Organization ➔ inserts into public.organisations
             ↓
4. User creates Project Workspace ➔ inserts into public.projects (foreign key: organisation_id)
```

* **Backend Service:** Project Service (`port 3007`)
* **Database Tables Touched:** `auth.users`, `public.profiles`, `public.organisations`, `public.projects`
* **Key Guarantee:** Tenant data isolation. Every downstream table created throughout the platform carries `project_id`.

---

### Workflow 2: Asset Blueprint Registration (Step 1: Registry First)

```
[ User Navigates to Registry Asset Page ]
             ↓
1. User provides schema manifest (.json, .yaml) or external database connection
             ↓
2. Schema Service parses column names, types (int, text, date), and nullability
             ↓
3. Creates container row in public.data_source
             ↓
4. Creates asset blueprint in public.catalog_asset (asset_name, fq_name, description)
             ↓
5. Batch-inserts column specifications into public.asset_column
```

* **Backend Service:** Schema Service (`port 3001` - `assetRegistrationService.js`)
* **Database Tables Touched:** `public.data_source`, `public.catalog_asset`, `public.asset_column`
* **Why Register First:** Establishes a strict validation blueprint. When users upload data later in Data Ingestion, incoming files are checked against these registered columns to prevent broken SQL tables.

---

### Workflow 3: Multi-Modal Data Ingestion & Physical Table Creation (Step 2: Ingest Second)

```
[ User Navigates to Data Ingestion Page ]
             ↓
1. User selects active Project and chooses a registered Catalog Asset
             ↓
2. Ingestion Method Selected:
   • Method A (File Upload): Uploads CSV/XLSX. Client & server validate file headers against asset_column.
   • Method B (Synthetic Mock): Requests synthetic row generation.
   • Method C (External DB): Introspects external tables and maps fields.
             ↓
3. Upload manifest recorded in public.schemas
             ↓
4. Table Service generates DDL and creates native table: public."<dataset_name>" (e.g. public.project_customers)
             ↓
5. Ingestion Engine streams and inserts records into the physical table
             ↓
6. Tracking metadata recorded in public.generated_tables (row_count, column_count, physical_name)
             ↓
7. Project Ingestion Tracker updates: Moves asset from "Remaining Files" to "Loaded Files"
```

* **Backend Services:** Schema Service (`port 3001`), Table Service (`port 3003`)
* **Database Tables Touched:** `public.schemas`, `public.generated_tables`, `public."<dataset_name>"` (physical table), `public.catalog_asset` (links `generated_table_id`)
* **Key Guarantee:** Queries on physical tables execute in sub-milliseconds rather than reading static files from disk.

---

### Workflow 4: Deterministic Data Quality Profiling (Step 3: Quality Audit)

```
[ User Navigates to Data Catalog Page ]
             ↓
1. Dropdown 1 strictly scopes to active Project. Dropdown 2 lists registered assets.
             ↓
2. User selects target Column and Metric (COUNT, NULL_COUNT, DISTINCT_COUNT, MIN, MAX, AVG)
             ↓
3. Clicks "Run Profiling" (Validation blocks execution if unselected)
             ↓
4. sqlDataProfilingService.js sets statement_timeout = 8000 and executes native PostgreSQL queries:
   • COUNT(*), null counts, empty text counts
   • Numeric: Min, Max, Avg, StdDev, Median (percentile 0.5), Q1, Q3, Outliers (IQR rule), Histograms
   • Categorical: Distinct counts, Top 8 frequencies, All 200 categories
   • Temporal: Min date, Max date, Monthly activity counts
             ↓
5. Rule-Based Insights Engine translates stats into health badges (Healthy, Notice, Info)
             ↓
6. Result saved permanently into public.catalog_profiling_result
             ↓
7. Frontend renders 5 visual outputs: Metric Card, KPI Grid, Insights, Chart.js Visuals, Column Quality Table
```

* **Backend Service:** Schema Service (`port 3001` - `sqlDataProfilingService.js`)
* **Database Tables Touched:** `public.catalog_profiling_result` (reads `public."<dataset_name>"`, `public.asset_column`, `public.catalog_asset`)
* **Key Guarantee:** 100% deterministic mathematical calculations with zero AI dependency.

---

### Workflow 5: Target KPIs & Executive Dashboard Delivery

```
[ User Navigates to Project Report Page ]
             ↓
1. User enters natural language target business KPIs (e.g., "Monthly Active Users", "Revenue by Plan")
             ↓
2. AI Service translates KPIs into validated SQL queries with AST whitelisting
             ↓
3. Table Service executes aggregate queries against physical PostgreSQL tables
             ↓
4. Dashboard layout and chart widgets are saved to public.dashboards (1:1 with project)
             ↓
5. Semantic joins and dimension models saved to public.project_data_models
             ↓
6. Executive reports render dynamic Chart.js charts and live KPI metric cards
```

* **Backend Services:** AI Service (`port 3005`), Table Service (`port 3003`), Project Service (`port 3007`)
* **Database Tables Touched:** `public.dashboards`, `public.project_data_models`, `public."<dataset_name>"`

---

## 🛠️ 2. Automated Documentation Maintenance Protocol

To ensure this documentation remains accurate as RapidInsight Studio evolves:

### Rule 1: Schema & Migration Changes
Whenever a new migration (`RapidInsight-Backend/backend/migrations/*.sql`) adds or modifies a table:
1. Update **`01_DATABASE_SCHEMA_AND_RELATIONSHIPS.md`** with the new table, primary key, foreign keys, and cascading rules.
2. Update the Mermaid ERD in `01_DATABASE_SCHEMA_AND_RELATIONSHIPS.md` and `Notes/Simple_Database_Architecture/RapidInsightStudio_Database_Simple_ERD.mmd`.

### Rule 2: Backend Microservice Changes
Whenever endpoints, services, or controllers are modified:
1. Update **`02_BACKEND_MICROSERVICES_CODE_GUIDE.md`** under the corresponding microservice section.
2. Note the database tables touched and any new helper utilities created.

### Rule 3: Frontend Component & Page Changes
Whenever UI components, route pages, or API clients are modified:
1. Update **`03_FRONTEND_APPLICATION_CODE_GUIDE.md`** with new state properties, API methods, and UI features.

### Rule 4: System Architecture Changes
If new microservices, background queues, or third-party integrations are introduced:
1. Update the Microservices Matrix and Architecture Diagram in **`00_MASTER_SYSTEM_ARCHITECTURE.md`**.

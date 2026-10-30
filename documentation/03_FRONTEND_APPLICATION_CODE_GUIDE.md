# 03. Frontend Application Architecture & Component Guide

**Project:** RapidInsight Studio  
**Classification:** Complete Frontend Source Code Reference  
**Parent Directory:** `docs/Project_Documentation/`  
**Base Path:** `RapidInsight-Frontend/src/`

---

## 🖥️ 1. Architecture Overview

The frontend is a single-page application (SPA) built with **React 18** and **Vite**, utilizing **React Router v6** for client-side navigation, **Chart.js** with `react-chartjs-2` for executive data visualization, and native **CSS Custom Properties** for comprehensive theme tokens (Dark & Light modes).

---

## 🌐 2. Application Entry & Contexts

#### `src/main.jsx` & `src/App.jsx`
* **Purpose:** Entry bootstrap mounting React root. Wraps the app in `BrowserRouter`, `AuthProvider`, `ThemeProvider`, and `ProjectRefreshProvider`. Defines route hierarchy and protected route gates (`ProtectedRoute.jsx`).

#### `src/lib/supabaseClient.js`
* **Purpose:** Initializes the singleton Supabase client using environment variables:
  * `VITE_SUPABASE_URL`
  * `VITE_SUPABASE_ANON_KEY`
* **Importance:** Handles client-side authentication, session persistence in localStorage, and storage bucket uploads.

#### `src/context/AuthContext.jsx`
* **Purpose:** Global authentication state provider.
* **Key State:** `user`, `session`, `loading`. Listens to `supabase.auth.onAuthStateChange` to keep session tokens in sync across tabs.

#### `src/context/ProjectRefreshContext.jsx`
* **Purpose:** Event bus / state trigger. Dispatches refresh events when assets are registered or data is ingested so other pages (Data Catalog, Report Page) update their data automatically.

#### `src/context/ThemeContext.jsx`
* **Purpose:** Manages Dark/Light UI theme switching and persists user preference.

---

## 🔌 3. API Client Layer (`src/api/`)

The API layer abstracts all HTTP requests to the API Gateway (`http://localhost:3000`), automatically attaching `Authorization: Bearer <jwt>` tokens.

#### `src/api/apiClient.js`
* **Purpose:** Central HTTP wrapper using `fetch`.
* **Key Logic:** Extracts current session access token from Supabase client, injects `Authorization: Bearer <token>`, and handles uniform error parsing.

#### `src/api/catalogApi.js`
* **Purpose:** Client methods for the Data Catalog and Data Ingestion:
  * `getCatalogAssets(projectId)`: Fetches registered assets for an active workspace.
  * `getCatalogColumns(assetId)`: Fetches column dictionary specifications.
  * `profileAsset(payload)`: Sends request to execute real-time SQL data profiling.
  * `getProfilingHistory(assetId)`: Retrieves past profiling audit runs.
  * `ingestFileIntoAsset(formData)`: Streams file to backend to populate physical tables.
  * `ingestMockDataIntoAsset(payload)`: Triggers synthetic data generation.
  * `ingestDatabaseIntoAsset(payload)`: Maps and streams records from external database.

#### `src/api/schemaApi.js`
* **Purpose:** Handles schema uploads, external database connections, and schema deletion:
  * `uploadSchemaFile(file, projectId)`: Ingests CSV/JSON/YAML schema files.
  * `testDatabaseConnection(config)`: Validates remote database credentials.
  * `getDatabaseTableColumns(config, tableName)`: Introspects external tables.

#### `src/api/tableApi.js`
* **Purpose:** Client adapter for physical table operations:
  * `getGeneratedTables(projectId)`: Lists created physical tables.
  * `buildTable(schemaId)`: Commands table service to instantiate SQL table.
  * `getTableRows(tableId, page, limit)`: Paginated row browser.
  * `runKpiQuery(payload)`: Executes KPI aggregate SQL queries.

#### `src/api/projectApi.js`
* **Purpose:** Workspace management:
  * `getProjects()`: Lists all accessible user projects.
  * `getProjectById(projectId)`: Reads workspace details.
  * `createProject(payload)`: Creates new workspace.
  * `deleteProject(projectId)`: Deletes workspace and cascades.

---

## 📄 4. Route Pages (`src/pages/`)

#### `src/pages/DataCatalogPage.jsx` & `DataCatalogPage.css`
* **Purpose:** The Data Catalog and Statistical Profiling interface.
* **Key Features:**
  * **Dropdown 1 (Active Project Isolation):** Strictly scopes catalog queries to the active workspace project.
  * **Dropdown 2 (Asset Selection):** Lists registered catalog assets.
  * **Column & Metric Selector:** Allows user to select target columns and metrics (`COUNT`, `NULL_COUNT`, `DISTINCT_COUNT`, `MIN`, `MAX`, `AVG`).
  * **Run Profiling Trigger:** Requires selection validation before execution.
  * **5 Visual Output Sections:**
    1. *Top Metric Result Card* with query execution time in milliseconds.
    2. *Table Quality KPI Grid* (Total Rows, Columns, Completeness %, Speed).
    3. *Automated Rule-Based Insights* with color-coded health badges.
    4. *Chart.js Visualizations* (Distribution histograms, category frequency, date trends).
    5. *Column Completeness Table* with visual progress bars.
    6. *Profiling History Table* displaying previous runs from `catalog_profiling_result`.

#### `src/pages/DataIngestionPage.jsx` & `DataIngestionPage.css`
* **Purpose:** Multi-modal data ingestion engine.
* **Key Features:**
  * **Select Registered Asset:** User chooses which catalog blueprint to populate.
  * **3 Ingestion Methods:**
    * *Method A (File Upload):* Uploads CSV, XLSX, XLS, JSON, YAML with automatic client-side and server-side schema verification.
    * *Method B (Synthetic Mock Data):* Configures row volume and triggers relational synthesis.
    * *Method C (External Database):* Connects to live PostgreSQL, introspects tables, maps columns, and imports records.
  * **Project Files Ingestion Status Tracker:** Real-time bottom panel showing which registered files in the project are **Loaded** vs **Remaining / Pending**, complete with quick-action buttons.

#### `src/pages/RegistryAssetPage.jsx`
* **Purpose:** Asset blueprint registration (Step 1).
* **Key Features:** Enables users to register schema manifests or discover external database tables into `public.catalog_asset` and `public.asset_column` *before* loading rows.

#### `src/pages/ProjectWorkspacePage.jsx` & `ProjectWorkspacePage.css`
* **Purpose:** Primary workspace hub dashboard.
* **Key Features:** Displays project overview, active data sources, quick navigation cards (Ingestion, Catalog, Playground, Reports), and project file stats.

#### `src/pages/ProjectReportPage.jsx` & `ProjectReportPage.css`
* **Purpose:** Executive analytics and target KPI report builder.
* **Key Features:** Allows business users to enter natural language KPIs (e.g. *Monthly Active Users*, *Revenue by Plan*), triggers the synthetic data pipeline, and renders Chart.js dashboards.

#### `src/pages/SchemaPlaygroundPage.jsx` & `SchemaPlaygroundPage.css`
* **Purpose:** Interactive visual schema graph explorer.
* **Key Features:** Graph canvas with draggable entity cards, minimap, zoom/pan controls, primary/foreign key connection lines, and column inspection.

#### `src/pages/TableViewerPage.jsx` & `TableViewerPage.css`
* **Purpose:** Real-time tabular data viewer for generated PostgreSQL tables.
* **Key Features:** Server-side pagination, column sorting, and row inspection.

---

## 🧩 5. Reusable UI Components (`src/components/`)

* **`layout/AppLayout.jsx` & `Sidebar.jsx`:** Main navigation shell with responsive drawer, project switching, and user profile modal.
* **`playground/PlaygroundCanvas.jsx`:** HTML5 Canvas / SVG graph rendering entity nodes and bezier curve relationship lines.
* **`reports/ReportChart.jsx`:** Wrapper around Chart.js bar, line, and doughnut charts with dark/light theme options.
* **`schema/UploadDropzone.jsx`:** Drag-and-drop file ingestion zone with MIME-type filtering and upload progress.
* **`tables/TableRowsViewer.jsx`:** High-performance tabular grid for rendering thousands of rows with sticky headers.

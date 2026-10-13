# RapidInsightStudio — Product Requirements Document (PRD)

---

## 1. Document Control
- **Document Version:** 1.0.0
- **Status:** Approved Baseline / Active Source of Truth
- **Branch Context:** `main` (integrating `feature/llm-sql-kpi-execution`)
- **System Scope:** RapidInsightStudio Core Platform (Frontend & Backend Microservices)
- **Target Audience:** Engineering, Product, QA, Architecture

---

## 2. Project Overview

**RapidInsightStudio** is an intelligent, schema-driven data analytics and synthetic dataset workbench. It transforms structural metadata (database schemas in JSON, YAML, or CSV formats) into full, live analytics workspaces containing:
1. Physical database tables created dynamically in isolated PostgreSQL schemas.
2. Statistically realistic synthetic datasets that maintain complex cross-column and cross-table correlations.
3. Automatically discovered data models with primary-key and foreign-key relational integrity.
4. An interactive visual Schema Playground for graph exploration and record inspection.
5. AI-generated, business-relevant Key Performance Indicators (KPIs), charts, and executive insights computed through secure, validated SQL.

---

## 3. Problem Statement

Data analytics, sales demonstrations, and product prototyping consistently bottleneck on access to representative data:
- **Client & Compliance Restrictions:** Customers cannot share real transactional, financial, or healthcare data before enterprise contracts and legal Data Protection Agreements (DPAs) are signed.
- **Flaws of Traditional Mock Tools:** Conventional generators (e.g., standard Faker) generate columns independently without semantic or statistical awareness. A customer in "Tokyo" is placed in "Brazil"; total prices contradict quantity and unit price; VIP tiers spend the same as basic tiers. These flaws result in flat, nonsensical charts in BI tools.
- **LLM Token & Volume Constraints:** Generating 10,000+ rows directly via LLM prompts is cost-prohibitive, slow, and suffers from mode collapse after ~40-50 rows.
- **Architectural Solution:** RapidInsightStudio decouples realism from volume:
  - **Realism:** LLMs generate high-fidelity, varied seed row examples (50–300 rows).
  - **Volume:** Synthetic Data Vault (SDV) statistical copula/TVAE models learn joint distributions from seed rows and sample thousands of correlated records.
  - **Determinism:** Programmatic business logic enforces unique primary keys, valid foreign-key referential integrity, and mathematical invariants.

---

## 4. Current System Capabilities & Scope

### 4.1 Existing Features & Capabilities
| Area | Feature | Status | Description |
| :--- | :--- | :--- | :--- |
| **Auth** | Supabase Auth Integration | Active | User registration, password login, and session validation via Supabase JWT. |
| **Tenancy** | Organizations & Projects | Active | Multi-tenant organization scoping with dedicated PostgreSQL schemas (e.g., `org_project`). |
| **Schema Ingestion** | Multi-Format Upload | Active | Upload JSON, YAML, or CSV schemas with automatic column type inference. |
| **Data Ingestion** | Dual Upload Modalities | Active | "Use my data" (instant ingestion of real records) vs. "Generate mock data" (AI seed rows + SDV expansion). |
| **Seed Synthesis** | LLM Seed Row Generation | Active | Multi-batch LLM prompts generating 50–300 valid rows per table in the background. |
| **Model Training** | Statistical SDV Sidecar | Active | Python FastAPI microservice running TVAE/Gaussian Copula models with artifact caching. |
| **Data Integrity** | Relational Constraint Engine | Active | Primary key sequential/UUID generation, foreign key sampling from parent tables, and `fixed_combinations` preservation. |
| **Physical Storage** | PostgreSQL Dynamic DDL | Active | Automatic creation of physical tables, indexes, and batch insertion of synthetic records. |
| **Data Modeling** | Relationship Inference | Active | AI-driven determination of fact vs. dimension tables and join paths. |
| **Analytics** | LLM SQL KPI Generation | Active | Natural language to SQL query generation with AST safety parsing, schema whitelist validation, and auto-repair loops. |
| **Visualization** | Executive Dashboard & Playground | Active | Chart.js visual charts, KPI metric cards, AI commentary cards, and pan/zoom schema graph canvas. |

### 4.2 User Personas & Use Cases
1. **Sales & Solution Engineers:** Upload prospective customer schemas during pre-sales calls to produce customized live BI dashboards instantly without handling customer PII.
2. **Product Managers & BI Architects:** Prototype and validate proposed data models, query shapes, and KPI metrics before committing data engineering sprints to ETL pipelines.
3. **QA & Software Engineers:** Generate referentially intact test databases with realistic distributions for load testing and regression verification.

---

## 5. Functional Requirements (Current System)

### 5.1 Authentication & Profile
- `FR-AUTH-01`: Support user registration with username, email, and password (minimum 6 characters).
- `FR-AUTH-02`: Support authentication returning a Supabase JWT and mapped user profile.
- `FR-AUTH-03`: Enforce single entry point through Gateway (`PORT 3000`) with route proxying and bearer token verification.

### 5.2 Project & Workspace Management
- `FR-PROJ-01`: Create named projects associated with an organization.
- `FR-PROJ-02`: Automatically provision an isolated PostgreSQL schema upon project creation.
- `FR-PROJ-03`: Support project listing, metadata querying, and dashboard summary retrieval.
- `FR-PROJ-04`: Complete cascading project deletion (dropping physical PostgreSQL schema, dropping tables, removing storage bucket artifacts, and deleting database metadata).

### 5.3 Schema Upload & Seed Generation
- `FR-SCHM-01`: Accept `.json`, `.yaml`, `.yml`, and `.csv` files up to 5MB.
- `FR-SCHM-02`: Store original uploaded schema files in Supabase Storage bucket `schemas`.
- `FR-SCHM-03`: Parse and persist normalized table field definitions into table `schemas`.
- `FR-SCHM-04`: If `data_source = 'mock'`, initiate asynchronous seed row generation via AI Service and persist results in `seed_storage_path`.
- `FR-SCHM-05`: Track seed status transitions: `pending` → `generating` → `ready` / `failed` / `not_required`.
- `FR-SCHM-06`: Provide retry endpoint for interrupted or failed seed row generation jobs.

### 5.4 Data Generation & Table Orchestration
- `FR-DGEN-01`: Block "Generate Tables" action until all project schemas satisfy `seed_status in ('ready', 'not_required')`.
- `FR-DGEN-02`: Infer project data model topology (identifying dimension tables vs fact tables and foreign key dependencies).
- `FR-DGEN-03`: Execute topological sort to compute deterministic build order (parent dimension tables created before child fact tables).
- `FR-DGEN-04`: Create physical tables in PostgreSQL with sanitized identifiers.
- `FR-DGEN-05`: Invoke `datagen-service` and `sdv-service` to fit models, preserve determining column pairs (`fixed_combinations`), sample bulk rows, and inject guaranteed foreign keys.
- `FR-DGEN-06`: Batch insert generated rows into physical PostgreSQL tables.

### 5.5 Analytics & Dashboard Execution
- `FR-ANLT-01`: Plan project KPIs and translate them into SQL queries via AI Service.
- `FR-ANLT-02`: Validate generated SQL queries against a strict AST safety validator (single SELECT, allowed functions, no schema mutations, table whitelist).
- `FR-ANLT-03`: Execute validated queries against project tables with statement timeouts (5s max).
- `FR-ANLT-04`: Generate natural-language executive insights interpreting computed query metrics.
- `FR-ANLT-05`: Persist dashboard configuration, KPI values, chart series, and insight bullets in `dashboards` table.

---

## 6. Non-Functional Requirements (Current System)

- **Security & Network Isolation:**
  - Gateway is the sole internet-facing backend service.
  - Internal microservices require `x-internal-service-key` and reject direct external requests.
  - Multi-tenant isolation enforced via separate PostgreSQL schemas and Supabase Row Level Security (RLS).
  - LLM API keys reside strictly within `ai-service` and are never exposed to clients or intermediate services.
- **Performance & Latency:**
  - Fast response on file upload (< 1.5s); seed generation runs asynchronously in background (~30–60s).
  - Bulk data generation executes in < 45 seconds for typical 4–6 table star schemas using pre-warmed SDV models.
  - SQL query execution timeout hard limit of 5000ms.
- **Reliability & Resilience:**
  - Gateway rate limiting: 500 req / 15 min globally, 20 req / 15 min on `/auth`.
  - AI Service request queueing with minimum request spacing (1.2s) and backoff retry logic on 429/5xx responses.
  - Abandoned seed generation detection via timestamp timeout (`SEED_STALE_AFTER_MS = 420000`).

---

## 7. Known Limitations of Current System

1. **SQL-writing KPI Path Hardening:** Query validator prevents malicious SQL, but queries run using the service role database connection rather than a dedicated restricted read-only PostgreSQL role.
2. **Derived Arithmetic Columns:** Functional dependencies involving mathematical expressions (e.g., `total = quantity * unit_price`) are not yet computed post-SDV sampling.
3. **Report and Export Microservices:** `report-service` (`PORT 3004`) and `export-service` (`PORT 3009`) exist solely as placeholder health-check stubs; active reporting logic is currently embedded in `table-service` and `project-service`.
4. **CSV Enum Limitation:** Type inference from CSV headers and sample values cannot deduce constrained enum sets; enum constraints require JSON or YAML schema definitions.
5. **Pre-Migration Projects:** Legacy projects created before the introduction of SDV seed columns are not backwards compatible and must be recreated.

---

## 8. Dependencies & External Services

- **Supabase Cloud / PostgreSQL:** Primary metadata storage, user authentication, and object storage.
- **AI Providers:** Pluggable LLM backends (Groq, Anthropic Claude, OpenAI, Azure OpenAI, Google Gemini, xAI Grok).
- **Python SDV & PyTorch:** Statistical copula and TVAE synthetic data generator.
- **Node.js (v20+):** Express microservices ecosystem.
- **Vite & React (v18):** Frontend client application.

---

## 9. Future Catalog Service Requirements (Planned — NOT IMPLEMENTED)

> [!IMPORTANT]
> The Catalog Service is a planned future extension and is **NOT** implemented in the current system. No catalog code, database migrations, or UI views shall be implemented until explicitly authorized.

### 9.1 High-Level Future Catalog Goals
- Centralized Data Asset & Dataset Catalog across projects and organizations.
- Automated schema profiling, metadata tagging, business glossary mapping, and domain categorization.
- Column-level and table-level lineage tracking (from uploaded source schema → generated physical table → BI dashboard views).
- Search and discovery with full-text indexing, fuzzy search, and filter facets.
- Data quality metrics, freshness tracking, and dataset ownership governance.
- Role-based dataset access control (RBAC) and compliance classification (PII, Sensitive, Public).

### 9.2 Out of Scope for Baseline System
- Catalog Service REST endpoints (`/catalog/*`).
- Catalog schema tables (`catalog_assets`, `data_dictionaries`, `lineage_nodes`, etc.).
- Metadata harvesting agents or third-party catalog connectors (DataHub, OpenMetadata).

---

## 10. Acceptance Criteria (Current Baseline)

1. Frontend loads cleanly without uncaught console errors or broken authentication contexts.
2. User can authenticate, create an organization/project, and view the project workspace.
3. Schemas in JSON, YAML, or CSV format can be uploaded with verified column parsing.
4. Background seed generation successfully completes and unlocks the "Generate Tables" gate.
5. Table generation builds physical PostgreSQL tables, inserts correlated rows, validates KPI SQL, and renders complete reports and interactive playground graphs.

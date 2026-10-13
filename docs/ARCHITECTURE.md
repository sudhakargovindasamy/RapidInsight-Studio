# RapidInsightStudio — System Architecture Document

---

## 1. System Overview

**RapidInsightStudio** is engineered around a microservices architecture with a single API Gateway protecting internal services, decoupled AI reasoning, deterministic data synthesis, and a single-page React frontend.

The system is organized around two foundational principles:
1. **Separation of Concerns:** Heavy statistical calculations (Python / SDV) and LLM inference (AI Service) are encapsulated away from public access, while core business logic is managed across modular Node.js Express microservices.
2. **Decoupled Two-Phase Pipeline:** Slow, asynchronous tasks (seed example row generation via LLM) execute quietly during schema upload; fast, high-volume statistical expansion (SDV) and SQL analytics execute on demand during table generation.

---

## 2. Current System Architecture Diagram

```mermaid
flowchart TD
    subgraph ClientLayer["Frontend Client (Port 3006)"]
        Browser["React 18 SPA (Vite)"]
    end

    subgraph Perimeter["Security Perimeter & Ingress"]
        Gateway["API Gateway (Express - Port 3000)\n• JWT Authentication\n• Rate Limiting (500/15m)\n• Proxy with Context Headers"]
    end

    subgraph InternalServices["Internal Microservices Layer"]
        ProjectSvc["Project Service (Port 3007)\n• Projects & Orgs\n• Schema Provisioning\n• Cascading Deletion"]
        SchemaSvc["Schema Service (Port 3001)\n• CSV/JSON/YAML Parsing\n• Seed Row Orchestration\n• File Upload Management"]
        TableSvc["Table Service (Port 3003)\n• Dynamic DDL & Execution\n• SQL KPI Validation & Run\n• Orchestration Pipeline"]
        DatagenSvc["Datagen Service (Port 3002)\n• Key Assignment (PK/FK)\n• Column Routing\n• SDV Proxy Client"]
        ReportSvc["Report Service (Port 3004)\n• Placeholder Stub"]
        ExportSvc["Export Service (Port 3009)\n• Placeholder Stub"]
    end

    subgraph IsolatedEngines["Isolated Processing Engines (Internal Only)"]
        AISvc["AI Service (Port 3005)\n• Groq/OpenAI/Claude/Gemini\n• Prompting & Repair Loop\n• Rate-Limit Pacing Queue"]
        SDVSvc["SDV Service (Python/FastAPI - Port 3008)\n• PyTorch & SDV 1.37\n• TVAE & Copula Models\n• Model Artifact Disk Cache"]
    end

    subgraph Persistence["Storage & Database Infrastructure"]
        Postgres[("PostgreSQL Database\n• Tenant Schemas (org_proj)\n• Tables: projects, schemas,\ndashboards, generated_tables")]
        SupabaseStore["Supabase Storage\n• 'schemas' Bucket\n• Uploaded files & seed.json"]
    end

    Browser -->|"HTTPS + Bearer JWT"| Gateway
    Gateway -->|"x-user-id + x-internal-service-key"| ProjectSvc
    Gateway -->|"x-user-id + x-internal-service-key"| SchemaSvc
    Gateway -->|"x-user-id + x-internal-service-key"| TableSvc
    Gateway -->|"x-user-id + x-internal-service-key"| DatagenSvc
    Gateway -.->|"Stub Proxy"| ReportSvc
    Gateway -.->|"Stub Proxy"| ExportSvc

    SchemaSvc -->|"POST /ai/seed-rows"| AISvc
    TableSvc -->|"Relationships / KPIs / Insights"| AISvc
    TableSvc -->|"POST /datagen/generate-relational"| DatagenSvc
    DatagenSvc -->|"POST /sdv/generate"| SDVSvc

    ProjectSvc --> Postgres
    TableSvc --> Postgres
    SchemaSvc --> Postgres
    SchemaSvc --> SupabaseStore
```

---

## 3. Microservice Catalog & Port Assignments

| Service Name | Port | Runtime / Framework | Ingress / Access | Core Responsibility |
| :--- | :---: | :--- | :--- | :--- |
| **API Gateway** | `3000` | Node.js / Express | Public / Ingress | Validates JWTs, applies rate limits, forwards requests with user headers. |
| **Schema Service** | `3001` | Node.js / Express | Internal (Gateway) | Validates uploads, parses schema definitions, triggers background seed synthesis. |
| **Datagen Service** | `3002` | Node.js / Express | Internal | Enforces relational constraints (PK/FK), calls SDV sidecar, routes columns. |
| **Table Service** | `3003` | Node.js / Express | Internal (Gateway) | Creates physical PostgreSQL tables, coordinates generation, validates & executes SQL. |
| **Report Service** | `3004` | Node.js / Express | Internal (Gateway) | Placeholder service for future standalone reporting modules. |
| **AI Service** | `3005` | Node.js / Express | Internal Only | Multi-provider LLM gateway, structured prompts, JSON validator & repair loops. |
| **Frontend** | `3006` | React 18 / Vite | Public / Client | Web client interface, visual schema canvas, analytics dashboards. |
| **Project Service** | `3007` | Node.js / Express | Internal (Gateway) | Manages organizations, projects, profiles, and cascading deletion. |
| **SDV Service** | `3008` | Python 3.12 / FastAPI | Internal Only | Statistical model training (TVAE, Copula), constraint application, disk caching. |
| **Export Service** | `3009` | Node.js / Express | Internal (Gateway) | Placeholder service for future bulk export capabilities. |

---

## 4. Key Execution Workflows

### 4.1 Schema Upload & Background Seed Synthesis
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend
    participant Gateway
    participant SchemaSvc as Schema Service
    participant Supabase as Supabase Storage
    participant AISvc as AI Service

    User->>Frontend: Upload schema (JSON/YAML/CSV) + "Generate mock data"
    Frontend->>Gateway: POST /schema/upload (multipart/form-data)
    Gateway->>SchemaSvc: Proxy with x-user-id & x-internal-service-key
    SchemaSvc->>Supabase: Persist original file in 'schemas' bucket
    SchemaSvc->>SchemaSvc: Parse fields and store record (seed_status = 'generating')
    SchemaSvc-->>Gateway: HTTP 201 Created (Instant response)
    Gateway-->>Frontend: Schema record returned (UI polls /schema/seed-status)

    Note over SchemaSvc,AISvc: Asynchronous Background Execution
    SchemaSvc->>AISvc: POST /ai/seed-rows (batched schema definitions)
    AISvc->>AISvc: Generate 50-300 valid example rows via LLM
    AISvc-->>SchemaSvc: Return validated JSON seed rows
    SchemaSvc->>Supabase: Upload seed.json to storage
    SchemaSvc->>SchemaSvc: Update DB: seed_status = 'ready', seed_fingerprint
```

### 4.2 On-Demand Table Generation & Analytics Pipeline
```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Frontend
    participant Gateway
    participant TableSvc as Table Service
    participant AISvc as AI Service
    participant DatagenSvc as Datagen Service
    participant SDVSvc as SDV Service
    participant Postgres as PostgreSQL DB

    User->>Frontend: Clicks "Generate Tables"
    Frontend->>Gateway: POST /tables/projects/:id/generate-tables
    Gateway->>TableSvc: Proxy request
    TableSvc->>TableSvc: Gate check: Verify all schemas in project have seed_status='ready'
    TableSvc->>AISvc: POST /ai/relationships (infer fact vs dimension tables)
    AISvc-->>TableSvc: Return topology and foreign key graph
    TableSvc->>TableSvc: Compute topological build order (dimensions before facts)
    TableSvc->>Postgres: Execute CREATE TABLE in project schema
    TableSvc->>DatagenSvc: POST /datagen/generate-relational (schema bundle + seeds)
    DatagenSvc->>SDVSvc: POST /sdv/generate (TVAE training + sampling)
    SDVSvc-->>DatagenSvc: Return statistically correlated records
    DatagenSvc->>DatagenSvc: Inject primary keys & valid foreign keys
    DatagenSvc-->>TableSvc: Return complete dataset
    TableSvc->>Postgres: Batch INSERT into physical tables
    TableSvc->>AISvc: POST /ai/sql-kpi-plan (request KPI queries)
    AISvc-->>TableSvc: Return SQL queries
    TableSvc->>TableSvc: AST Safety Parsing & Whitelist Check
    TableSvc->>Postgres: Execute validated SQL queries
    TableSvc->>AISvc: POST /ai/insights (summarize computed metrics)
    AISvc-->>TableSvc: Return executive insight commentary
    TableSvc->>Postgres: Persist dashboard spec and KPI metrics
    TableSvc-->>Gateway: HTTP 200 OK
    Gateway-->>Frontend: Full generated dashboard & tables payload
```

---

## 5. Security & Authentication Architecture

1. **Authentication Flow:**
   - Client authenticates against `/auth/login` on Gateway.
   - Gateway queries `profiles` table using Supabase Admin Client, maps username to email, and delegates credential check to `supabase.auth.signInWithPassword`.
   - Client receives JWT session token, stored in browser local storage (`rapidinsight_session`).
2. **Gateway Verification:**
   - Every protected request includes `Authorization: Bearer <jwt>`.
   - Gateway verifies JWT with `supabase.auth.getUser(token)`.
   - On success, Gateway attaches `x-user-id`, `x-user-email`, and secret `x-internal-service-key` to proxied downstream calls.
3. **Internal Service Guardrails:**
   - Microservices employ `verifyInternalRequest` middleware verifying the presence of `x-internal-service-key`.
   - Direct requests bypassing the Gateway are rejected with `403 Forbidden`.
4. **LLM SQL Safety Sandboxing:**
   - Generated SQL queries are parsed using `node-sql-parser`.
   - Whitelist restrictions: Single SELECT statement, no table mutations, no sleep/system functions, strict table whitelist within current project schema.
   - Forced query timeout of 5 seconds.

---

## 6. Proposed Future Architecture: Data Catalog Service (PLANNED)

> [!NOTE]
> This section documents the planned future architecture. The Catalog Service is **NOT YET IMPLEMENTED**.

```mermaid
flowchart LR
    subgraph CurrentSystem["Existing Verified System"]
        Gateway["API Gateway"]
        ProjectSvc["Project Service"]
        SchemaSvc["Schema Service"]
        TableSvc["Table Service"]
    end

    subgraph FutureCatalog["Future Data Catalog Extension (Phase 14+)"]
        CatalogSvc["Catalog Service (Node.js/Express)\n• Asset Discovery & Indexing\n• Metadata & Schema Versioning\n• Data Lineage Graph\n• Quality & Freshness Scoring\n• Access Control & Tagging"]
        SearchIndex[("Search Index / Vector Store\n(Full-text & Semantic)")]
        LineageDB[("Lineage & Catalog Metadata")]
    end

    Gateway -.->|"Future Route /catalog/*"| CatalogSvc
    CatalogSvc -.->|"Harvest Metadata"| SchemaSvc
    CatalogSvc -.->|"Inspect Tables"| TableSvc
    CatalogSvc -.->|"Asset Scopes"| ProjectSvc
    CatalogSvc --> SearchIndex
    CatalogSvc --> LineageDB
```

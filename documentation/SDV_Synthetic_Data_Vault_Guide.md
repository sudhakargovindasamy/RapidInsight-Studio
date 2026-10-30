# Synthetic Data Vault (SDV) Technical Guide & Developer Manual

> **Module**: RapidInsightStudio Synthetic Data Generation Engine  
> **Service**: `sdv-service` (Python FastAPI, Port 3008) & `datagen-service` (Node.js Express, Port 3002)  
> **Location**: `RapidInsight-Backend/backend/services/sdv-service/`

---

## 1. Overview & Architectural Role

### 1.1 Why SDV? (The Problem It Solves)
In modern data engineering and analytics testing, applications need realistic, large-scale datasets (1,000 to 100,000+ rows) with authentic relationships, correlations, and business rules.

Traditional methods have severe limitations:
1. **Faker-based generation**: Produces independent, random columns. A customer aged 14 can be marked as a "Senior VP" earning $300,000 with a "Paris, USA" address. There is zero correlation between columns. Dashboards built on this data display meaningless flat distributions.
2. **Pure Large Language Models (LLMs)**: LLMs understand realistic business domain logic, but generation is token-bound, slow, and expensive. Generating 50,000 rows directly via an LLM would take hours, cost hundreds of dollars, and frequently truncate or repeat rows.

### 1.2 The Two-Phase Decoupled Solution
RapidInsightStudio solves this via a **two-phase hybrid architecture**:

```
+--------------------------------------------------------------------------------+
| PHASE 1: Domain Semantics (LLM)                                                |
|   Prompt / Schema  ===>  LLM generates 20 - 50 highly realistic seed rows     |
|                         (e.g., Country="France", City="Paris", Tier="VIP")    |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| PHASE 2: Probabilistic Scaling (SDV - Python FastAPI)                          |
|   Learns joint multivariate distributions (TVAE / Copula)                      |
|   Samples 1,000 to 100,000+ mathematically coherent rows in seconds            |
+--------------------------------------------------------------------------------+
                                       |
                                       v
+--------------------------------------------------------------------------------+
| RELATIONAL ENFORCEMENT (Node.js datagen-service)                               |
|   Topological sort: Synthesizes Parent (Customer) -> Harvests Primary Keys    |
|   Injects Primary Keys into Child (Orders) Foreign Keys                        |
+--------------------------------------------------------------------------------+
```

---

## 2. Microservice Communication & Data Flow

RapidInsightStudio isolates Python's data-science runtime from Node.js using a **Sidecar Microservice** architecture:

```
[ Frontend / Studio UI ]
           │
           │ POST /api/generate
           ▼
[ datagen-service (Node.js :3002) ]
  ├── Schema Validation & Dependency Graph (DAG)
  ├── Seed Row Aggregation (from LLM or user)
  ├── Computes Deterministic SHA-256 Cache Key
  │
  │ HTTP POST http://localhost:3008/sdv/generate
  ▼
[ sdv-service (Python FastAPI :3008) ]
  ├── Check Artifact Disk Cache (.artifacts/<sha256>.pkl)
  │    ├── CACHE HIT  ──> Load model in ~50ms ──> Sample rows
  │    └── CACHE MISS ──> Train Synthesizer (TVAE / Copula)
  │                         └── Evaluate Quality & Diagnostic Scores
  │                         └── Save .pkl & metadata .json
  ├── Post-Processing: Clip numbers to declared schema min/max
  │
  │ JSON Response with Generated Rows + Metadata
  ▼
[ datagen-service (Node.js :3002) ]
  ├── pkFkMapper: Injects parent IDs into child Foreign Keys
  ├── CSV/JSON Serialization or Direct DB Ingestion
```

---

## 3. Deep Dive: `sdv-service` Core Components

The Python service is located at:  
`RapidInsight-Backend/backend/services/sdv-service/`

### 3.1 Directory Structure
```
backend/services/sdv-service/
├── app/
│   ├── __init__.py
│   ├── auth.py                  # Service-to-service internal auth verification
│   ├── config.py                # Ports, thresholds, epoch defaults, model types
│   ├── constraints_builder.py   # FixedCombinations, Inequality, Range constraints
│   ├── main.py                  # FastAPI application entrypoint & lifecycle
│   ├── metadata_builder.py      # Translates schema types to SDV SingleTableMetadata
│   ├── models.py                # Pydantic request/response schemas
│   ├── routes.py                # API endpoints (/sdv/fit, /sdv/sample, /sdv/generate)
│   ├── service.py               # Training, sampling, evaluation, post-processing
│   └── synthesizer_cache.py     # SHA-256 model disk & memory cache management
├── .artifacts/                  # Persisted model pickles (.pkl) and metadata (.json)
├── requirements.txt             # Python packages (sdv, fastapi, uvicorn, etc.)
└── README.md                    # Environment setup & Windows notes
```

---

### 3.2 Key Python Files & Responsibilities

#### 1. Configuration (`app/config.py`)
Centralizes all runtime parameters read from `.env`:
* `PORT`: Default `3008`.
* `DEFAULT_SYNTHESIZER`: Defaults to `"tvae"`.
* `SUPPORTED_SYNTHESIZERS`: `("tvae", "gaussian_copula", "ctgan")`.
* `TVAE_EPOCHS`: Default `300` epochs.
* `CTGAN_EPOCHS`: Default `300` epochs.
* `MIN_SEED_ROWS`: `20` (prevents fitting models on insufficient noise).
* `MAX_SEED_ROWS`: `5000`.
* `MAX_SAMPLE_ROWS`: `100000`.
* `ARTIFACT_DIR`: Path to `.artifacts` directory.

#### 2. Model Selection: Why TVAE is the Default
Benchmark testing on correlated retail data (Segment `[Basic, Premium, VIP]` $\to$ Price) yielded:
* **GaussianCopula**: Fits fast ($1.4\text{ s}$), but scrambled category-to-number relationships (VIP customers received Basic prices).
* **CTGAN**: Fit time $77.5\text{ s}$, but also inverted category orderings.
* **TVAE** (Tabular Variational Autoencoder): Fit time $\sim 95\text{ s}$ ($300\text{ epochs}$), but preserved $88\%$ of correlations and correctly maintained segment $\to$ price hierarchy.

#### 3. Metadata Mapping (`app/metadata_builder.py`)
Converts generic types into SDV's `SingleTableMetadata`:
* `numerical` $\to$ `sdtype: 'numerical'` (float or int).
* `categorical` $\to$ `sdtype: 'categorical'`.
* `datetime` $\to$ `sdtype: 'datetime'`.
* `boolean` $\to$ `sdtype: 'boolean'`.
* Automatically excludes primary keys or foreign keys that should not be trained statistically.

#### 4. Constraints Engine (`app/constraints_builder.py`)
Enforces mathematical rules before fitting:
* `fixed_combinations`: Keeps coupled columns together (e.g., `City` and `Country`).
* `inequality`: Ensures order relationships (e.g., `start_date < end_date` or `min_price <= max_price`).
* `range`: Ensures bounds between three columns (e.g., `low <= middle <= high`).

#### 5. Caching Layer (`app/synthesizer_cache.py`)
Model fitting takes $30\text{--}90\text{ s}$, but sampling takes $<1\text{ s}$.  
The cache hashes `(schemaId, columns, seedRows, constraints, synthesizer)` into a SHA-256 key:
* If identical seed and schema are requested, the pre-trained `.pkl` is reused instantly.
* If any seed row or column definition changes, it invalidates the cache and retrains.

#### 6. Execution & Thread Offloading (`app/routes.py`)
Because PyTorch model training and SDV sampling are CPU-bound, running them directly inside an `async def` would block FastAPI's event loop.  
Calls are wrapped in:
```python
await anyio.to_thread.run_sync(
    lambda: fit_model(...)
)
```
This guarantees `/health` and concurrent calls remain responsive during heavy training.

#### 7. Post-Processing Guardrails (`app/service.py`)
Deep learning models and copulas can occasionally extrapolate numbers slightly outside training ranges.  
`_post_process()` strictly clips numerical values to the user's declared schema `minimum` and `maximum` and handles nullability rules.

---

## 4. How `datagen-service` Coordinates SDV

Located at: `RapidInsight-Backend/backend/services/datagen-service/`

### 4.1 Client Bridge (`src/services/sdvClient.js`)
* Computes SHA-256 cache key on the Node.js side.
* Posts payload to `http://localhost:3008/sdv/generate`.
* Sets a $300\text{ s}$ ($5\text{ min}$) HTTP timeout (`SDV_TIMEOUT_MS`) to allow for cold-start TVAE training.
* Fails fast with clear troubleshooting guidance if `sdv-service` is offline.

### 4.2 Multi-Table Relational Generation (`relationalRowGeneratorService.js`)
SDV is inherently a single-table synthesizer. Relational integrity across tables is solved by the Node.js orchestrator:
1. **DAG Topological Sort**: Orders tables from parents to children (e.g., `departments` $\to$ `employees` $\to$ `timesheets`).
2. **Parent Generation**: SDV generates parent table rows.
3. **PK Harvesting**: Primary keys (e.g., `customer_id`) are extracted from generated rows.
4. **FK Injection**: When generating the child table (`orders`), SDV synthesizes non-relational fields (dates, amounts, status), and `pkFkMapper.js` replaces the FK column (`customer_id`) with valid harvested parent IDs.

---

## 5. Developer Guide: How to Modify & Update SDV

### Scenario A: Switching the Default Model (e.g., Speed vs. Quality)
If training is too slow during development and you want instant generation ($1\text{ s}$ instead of $60\text{ s}$), switch to `gaussian_copula`.

* **File**: `RapidInsight-Backend/backend/services/sdv-service/app/config.py`
* **Line**:
  ```python
  # Change from "tvae" to "gaussian_copula"
  DEFAULT_SYNTHESIZER = "gaussian_copula"
  ```
* **Or via `.env`**:
  ```env
  SDV_DEFAULT_SYNTHESIZER=gaussian_copula
  ```

---

### Scenario B: Tuning Training Epochs
To balance training time and fidelity:
* **File**: `RapidInsight-Backend/backend/services/sdv-service/app/config.py`
* **Change**:
  ```python
  # Lower epochs for fast generation (e.g., 100), higher for perfect correlation (e.g., 500)
  TVAE_EPOCHS = _int("SDV_TVAE_EPOCHS", 150)
  ```
* **Or in `.env`**:
  ```env
  SDV_TVAE_EPOCHS=150
  SDV_CTGAN_EPOCHS=150
  ```

---

### Scenario C: Adding Custom Data Constraints
To add new rules (e.g., custom regex or non-negative checks):
* **File**: `RapidInsight-Backend/backend/services/sdv-service/app/constraints_builder.py`
* **Import additional SDV constraints**:
  ```python
  from sdv.cag import FixedCombinations, Inequality, Range, Positive
  ```
* **Add custom handling in `build_constraints()`**:
  ```python
  if constraint.type == "positive":
      built.append(Positive(column_name=constraint.low_column))
  ```

---

### Scenario D: Changing Sample and Seed Limits
If your project needs to generate $500,000$ rows or accept larger seed sets:
* **File**: `RapidInsight-Backend/backend/services/sdv-service/app/config.py`
* **Adjust values**:
  ```python
  MAX_SAMPLE_ROWS = _int("SDV_MAX_SAMPLE_ROWS", 500000)
  MAX_SEED_ROWS   = _int("SDV_MAX_SEED_ROWS", 20000)
  MIN_SEED_ROWS   = _int("SDV_MIN_SEED_ROWS", 10)
  ```

---

### Scenario E: Cleaning or Redirecting Model Cache
Artifacts are stored in `.artifacts/` as `<sha256>.pkl` and `<sha256>.json`.
* To clear cache: Delete the contents of `backend/services/sdv-service/.artifacts/`.
* To change location:
  ```env
  SDV_ARTIFACT_DIR=/custom/path/to/artifacts
  ```

---

### Scenario F: Running & Debugging `sdv-service` Locally

1. Open PowerShell and activate the virtual environment:
   ```powershell
   # If installed in global virtualenv:
   C:\sdvenv\Scripts\activate
   # Or if inside service directory:
   cd RapidInsight-Backend\backend\services\sdv-service
   python -m venv venv
   .\venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. Start the service directly with hot reloading:
   ```powershell
   python -m uvicorn app.main:app --host 0.0.0.0 --port 3008 --reload
   ```

3. Verify it is running:
   ```powershell
   curl http://localhost:3008/health
   # Expected response: {"status":"ok","synthesizers":["tvae","gaussian_copula","ctgan"],"default":"tvae"}
   ```

---

## 6. Summary Checklist for Modifying SDV

| Goal | Where to edit | Key settings / functions |
| :--- | :--- | :--- |
| **Change model speed/quality** | `app/config.py` | `DEFAULT_SYNTHESIZER = "gaussian_copula" \| "tvae"` |
| **Change training speed** | `app/config.py` | `TVAE_EPOCHS = 100` (default 300) |
| **Change row limits** | `app/config.py` | `MAX_SAMPLE_ROWS`, `MIN_SEED_ROWS` |
| **Add column rules / constraints** | `app/constraints_builder.py` | `build_constraints()` |
| **Customize value clipping** | `app/service.py` | `_post_process()` |
| **Adjust timeout in Node.js** | `datagen-service/.../sdvClient.js` | `SDV_TIMEOUT_MS = 300000` |
| **Clear trained models** | `.artifacts/` | Delete `.pkl` and `.json` files |


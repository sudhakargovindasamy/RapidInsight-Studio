# RapidInsight Studio — SQL Data Profiling Service Technical Guide

**File Path:** `RapidInsight-Backend/backend/services/schema-service/src/services/sqlDataProfilingService.js`  
**Audience:** Full-Stack Engineers, Data Engineers, Technical Product Managers  
**Purpose:** Comprehensive architectural and mathematical reference explaining how `sqlDataProfilingService.js` operates, how all statistical metrics are calculated in PostgreSQL, and how data flows from the database to the Data Catalog UI.

---

## 📖 1. Overview & Architectural Role

`sqlDataProfilingService.js` is the core data quality and statistical profiling engine of RapidInsight Studio. 

### Key Characteristics:
* **100% Deterministic SQL:** Zero AI or LLMs are involved in profiling calculations. Every number, percentage, and insight is computed mathematically using native PostgreSQL aggregation functions.
* **Safe & Isolated Execution:** Runs read-only queries with strict statement timeouts (8 seconds), identifier escaping to prevent SQL injection, and verified table resolution.
* **Direct Database Introspection:** Directly inspects physical PostgreSQL tables (`public.project_customers`, `public.orders`, etc.) rather than reading static raw files into Node.js memory.

---

## 🔄 2. End-to-End Execution Lifecycle

When a user selects an asset in the **Data Catalog** and clicks **"Run Profiling"**, the main entry function `profileAssetData()` executes across **6 sequential phases**:

```
[ Frontend: "Run Profiling" Clicked ]
                   ↓
1. Safety Setup: SET statement_timeout = 8000 (8s circuit breaker)
                   ↓
2. Resolve Physical Table: Links catalog_asset ➔ generated_tables ➔ information_schema
                   ↓
3. Column Verification: Compares asset_column with information_schema.columns
                   ↓
4. Deterministic SQL Execution:
   • Total Rows, Null Counts, Empty Text Counts
   • Numeric: Min, Max, Avg, StdDev, Sum, Q1, Median, Q3, Outliers, Histograms
   • Categorical: Distinct Counts, Top 8 Frequencies, All 200 Values
   • Temporal: Min Date, Max Date, Monthly Activity Buckets
                   ↓
5. Rule-Based Insights Generation: Generates human-readable health badges (Zero AI)
                   ↓
6. Chart.js Dataset Construction: Formats bar & line charts for UI rendering
                   ↓
[ Return Payload to Frontend & Persist in public.catalog_profiling_result ]
```

---

## 🧮 3. Detailed Mathematical & Statistical Calculation Guide

Every calculation in `sqlDataProfilingService.js` maps to a specific SQL aggregate function. Below is the exact breakdown:

### 3.1. Row Count & Completeness Metrics

#### 1. Total Rows
* **SQL:**
  ```sql
  SELECT COUNT(*)::bigint AS total_rows FROM "public"."table_name";
  ```
* **Meaning:** The total number of records populated in the physical SQL table.

#### 2. Null Count (Missing Values)
* **SQL:**
  ```sql
  (COUNT(*) - COUNT("column_name"))::bigint AS "null_column_name"
  ```
* **How it works:** In SQL, `COUNT(*)` counts all rows, while `COUNT(column)` only counts non-null rows. The difference gives the exact number of null cells without scanning the table twice.

#### 3. Empty String Count (Blanks)
* **SQL (Applied only to text columns):**
  ```sql
  SUM(CASE WHEN TRIM("column_name"::text) = '' THEN 1 ELSE 0 END)::bigint AS "empty_column_name"
  ```
* **Meaning:** Detects whitespace-only or empty strings `""` that are technically non-null but carry no data.

#### 4. Completeness Percentage
* **Formula:**
  $$\text{Completeness } \% = \left(\frac{\text{Total Rows} - \text{Null Count}}{\text{Total Rows}}\right) \times 100$$
* **Table-Level Overall Completeness:**
  $$\text{Overall Completeness } \% = \left(\frac{\text{Total Cells} - \text{Total Null Cells}}{\text{Total Cells}}\right) \times 100$$
  *(where $\text{Total Cells} = \text{Total Rows} \times \text{Total Columns}$)*

---

### 3.2. Primary Key Uniqueness & Integrity

* **SQL:**
  ```sql
  SELECT 
    (COUNT("pk_col") - COUNT(DISTINCT "pk_col"))::bigint AS duplicate_keys,
    COUNT(DISTINCT "pk_col")::bigint AS distinct_keys
  FROM "public"."table_name"
  WHERE "pk_col" IS NOT NULL;
  ```
* **How it works:**
  * If `duplicate_keys == 0`, the primary key satisfies complete relational uniqueness (Status: `Healthy`).
  * If `duplicate_keys > 0`, it triggers an immediate critical violation badge in the insights panel.

---

### 3.3. Numeric Column Statistical Calculations

For all numeric data types (`integer`, `bigint`, `numeric`, `decimal`, `float`, `real`), the service executes a comprehensive single-pass statistical query:

```sql
SELECT 
  COUNT("col")::bigint AS count_val,
  MIN("col")::numeric AS min_val,
  MAX("col")::numeric AS max_val,
  ROUND(AVG("col")::numeric, 4) AS avg_val,
  ROUND(STDDEV("col")::numeric, 4) AS stddev_val,
  ROUND(SUM("col")::numeric, 2) AS sum_val,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY "col") AS median_val,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY "col") AS q1_val,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY "col") AS q3_val
FROM "public"."table_name"
WHERE "col" IS NOT NULL;
```

#### Detailed Metrics:
1. **Minimum (`MIN`):** Smallest numerical value recorded in the column.
2. **Maximum (`MAX`):** Largest numerical value recorded in the column.
3. **Average (`AVG`):** Arithmetic mean $\mu = \frac{1}{N}\sum_{i=1}^N x_i$.
4. **Standard Deviation (`STDDEV`):** Measure of dispersion $\sigma = \sqrt{\frac{1}{N-1}\sum_{i=1}^N (x_i - \mu)^2}$.
5. **Sum (`SUM`):** Total accumulated sum of all values.
6. **Median ($50^{\text{th}}$ Percentile):** Computed via `percentile_cont(0.5)`. The exact middle value dividing the upper and lower halves. Unlike average, median is immune to severe outliers.
7. **Quartile 1 ($Q1$ - $25^{\text{th}}$ Percentile):** 25% of data falls below this value.
8. **Quartile 3 ($Q3$ - $75^{\text{th}}$ Percentile):** 75% of data falls below this value.

---

### 3.4. Outlier Detection (Tukey's IQR Rule)

The service calculates statistical outliers using **Tukey's Interquartile Range (IQR) method**:

1. **Calculate IQR:**
   $$\text{IQR} = Q3 - Q1$$
2. **Calculate Lower & Upper Fences:**
   $$\text{Lower Fence} = Q1 - 1.5 \times \text{IQR}$$
   $$\text{Upper Fence} = Q3 + 1.5 \times \text{IQR}$$
3. **Count Outliers in PostgreSQL:**
   ```sql
   SELECT COUNT(*)::bigint AS outlier_count
   FROM "public"."table_name"
   WHERE "col" < $1 OR "col" > $2;
   ```
   *Values below the Lower Fence or above the Upper Fence are flagged as statistical anomalies.*

---

### 3.5. 5-Bucket Distribution Histograms

To generate interactive distribution charts for numeric columns, the service divides the data range into **5 equal-width buckets** using PostgreSQL's `WIDTH_BUCKET`:

* **SQL:**
  ```sql
  SELECT 
    WIDTH_BUCKET("col", $1, $2, 5) AS bucket,
    COUNT(*)::bigint AS frequency
  FROM "public"."table_name"
  WHERE "col" IS NOT NULL
  GROUP BY bucket
  ORDER BY bucket ASC;
  ```
  *(where `$1 = \text{min}$` and `$2 = \text{max}$`)*
* **Bucket Step:** $\text{step} = \frac{\text{max} - \text{min}}{5}$.
* **Result:** Formats 5 distinct range buckets (e.g. `10.0 - 50.0`, `50.0 - 90.0`, etc.) with their respective row counts.

---

### 3.6. Categorical & Text Frequency Analysis

For string and category columns:
1. **Distinct Count:**
   ```sql
   SELECT COUNT(DISTINCT "col")::bigint AS dist_cnt 
   FROM "public"."table_name" 
   WHERE "col" IS NOT NULL;
   ```
2. **Top Frequencies & Full Category Breakdown (Up to 200 categories):**
   ```sql
   SELECT 
     COALESCE(NULLIF(TRIM("col"::text), ''), '(blank)') AS cat_val,
     COUNT(*)::bigint AS count
   FROM "public"."table_name"
   WHERE "col" IS NOT NULL
   GROUP BY 1
   ORDER BY count DESC
   LIMIT 200;
   ```
3. **High Cardinality Detection:**
   $$\text{Cardinality Ratio} = \frac{\text{Distinct Count}}{\text{Total Rows}}$$
   *If $\text{Total Rows} > 15$ and $\text{Ratio} > 0.8$, the column is automatically flagged as `High Cardinality` (indicating a UUID, email, or unique identifier).*

---

### 3.7. Temporal & Date Analysis

For date and timestamp columns:
1. **Date Range:**
   ```sql
   SELECT 
     MIN("col")::text AS min_date,
     MAX("col")::text AS max_date,
     COUNT("col")::bigint AS non_null_count
   FROM "public"."table_name";
   ```
2. **Monthly Activity Trend:**
   ```sql
   SELECT 
     DATE_TRUNC('month', "col"::timestamp)::date::text AS period,
     COUNT(*)::bigint AS count
   FROM "public"."table_name"
   WHERE "col" IS NOT NULL
   GROUP BY period
   ORDER BY period ASC
   LIMIT 12;
   ```
   *Constructs a chronological activity timeline (e.g., `2026-01`, `2026-02`) rendered as a Chart.js line chart.*

---

## 💡 4. Deterministic Rule-Based Insights Generation

The function `generateRuleBasedInsights()` evaluates the computed statistics against business rules without calling any external AI models:

| Rule Category | Trigger Condition | Generated Insight / Badge | Severity |
|:---|:---|:---|:---:|
| **Completeness** | `overallCompleteness == 100` | "Table achieves 100% data completeness with 0 missing cells." | `success` |
| **Completeness** | `overallCompleteness < 80` | "Overall completeness is X%. Over 20% of data cells are null." | `warning` |
| **Missingness** | `nullCount > 0` | "Column X contains N missing values (Y% of table)." | `warning` / `info` |
| **Integrity** | `duplicateKeys == 0` | "Primary key satisfies complete uniqueness with 0 duplicates." | `success` |
| **Integrity** | `duplicateKeys > 0` | "Uniqueness Violation: Primary key contains N duplicate keys." | `danger` |
| **Outliers** | `outlierCount > 0` | "Detected N statistical outliers outside the 1.5× IQR threshold." | `warning` |
| **Cardinality** | $\text{Distinct} / \text{Total} > 0.8$ | "High cardinality detected (X unique out of N rows)." | `info` |
| **Timeline** | `minDate` & `maxDate` | "Temporal column spans from YYYY-MM-DD to YYYY-MM-DD." | `info` |

---

## 🔒 5. Security & Performance Safeguards

1. **SQL Injection Prevention:**
   * All schema, table, and column names are wrapped with `escapeIdentifier(id)`:
     ```javascript
     function escapeIdentifier(id) {
       return `"${String(id || '').replace(/"/g, '""')}"`;
     }
     ```
   * Column values and numeric thresholds are passed strictly via parameterized arguments (`$1`, `$2`).
2. **Statement Timeout Circuit Breaker:**
   * Every database client checks out with an 8-second execution limit:
     ```javascript
     await client.query('SET statement_timeout = 8000');
     ```
   * Prevents runaway queries on massive tables from freezing the server.
3. **Safe Connection Pooling:**
   * Uses `pool.connect()` with guaranteed cleanup in a `finally { client.release(); }` block to prevent database connection leaks.

---

## 🖥️ 6. Frontend UI Mapping (`DataCatalogPage.jsx`)

The structured JSON payload returned by `profileAssetData()` powers the **5 main visual sections** on the Data Catalog screen:

1. **Top Metric Stat Card:** Displays the user's targeted metric (`COUNT`, `NULL_COUNT`, `DISTINCT_COUNT`, `MIN`, `MAX`, `AVG`) with sample size and query execution time in milliseconds (`executionDurationMs`).
2. **KPI Scorecard Grid:** Populated Rows (`summary.totalRows`), Total Columns (`summary.totalColumns`), Missing Cells (`summary.missingCells`), and Overall Completeness (`summary.overallCompletenessPct`).
3. **Automated Insights Panel:** Color-coded badges (`Healthy`, `Notice`, `Info`) generated by `generateRuleBasedInsights()`.
4. **Interactive Chart.js Visualizations:** Bar and line charts formatted by `buildChartDatasets()` (Null comparisons, Top Frequencies, All Data Category distributions, Numeric Histograms, and Date Trends).
5. **Column Quality Table:** Column-by-column breakdown containing data types, null counts, completeness percentage bars, and range benchmarks.
6. **Audit History Log:** Results are written to the database table `public.catalog_profiling_result` so users can track changes across historical runs.

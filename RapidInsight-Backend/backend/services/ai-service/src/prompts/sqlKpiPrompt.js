const {
  compactSchemas
} = require("./schemaCompaction");

// Experimental step: instead of a structured plan (kpiPlanPrompt.js), the
// model writes the SQL itself. table-service still enforces every safety
// rule mechanically (sqlPlanValidator.js) - this prompt only shapes what the
// model attempts, it is never the thing that makes the query safe.
//
// Schemas arrive here with table_name/field names already swapped to the
// physical Postgres identifiers (see sqlKpiExecutionService.js), because the
// SQL this produces has to run against the real generated tables, not the
// logical names the user uploaded.

function formatFieldLine(field) {
  const flags = [];

  if (field.primaryKey) flags.push("PK");
  if (field.unique) flags.push("UNIQUE");

  const suffix = flags.length ? ` [${flags.join(", ")}]` : "";

  return `  - ${field.name} (${field.type})${suffix}`;
}

function formatTableBlock(schema) {
  return `TABLE: ${schema.table_name}\n${schema.fields.map(formatFieldLine).join("\n")}`;
}

function formatRelationships(relationships) {
  if (!Array.isArray(relationships) || relationships.length === 0) {
    return "(none - every query must stay inside a single table)";
  }

  return relationships
    .map(
      (relationship) =>
        `  - ${relationship.from_table}.${relationship.from_column} -> ` +
        `${relationship.to_table}.${relationship.to_column} (${relationship.relationship_type})`
    )
    .join("\n");
}

function formatRequests(requests) {
  return requests.map((request, index) => `${index + 1}. ${request}`).join("\n");
}

function buildSqlKpiPrompt({ schemas, relationshipModel, requests } = {}) {
  const compactedSchemas = compactSchemas(schemas);
  const relationships = relationshipModel?.relationships || [];

  return `You are a PostgreSQL analyst. Write one SQL query per requested metric, using only the tables and columns below.

TABLES (these are the real Postgres table and column names - use them exactly as spelled)

${compactedSchemas.map(formatTableBlock).join("\n\n")}

RELATIONSHIPS (confirmed foreign keys, for joins)

${formatRelationships(relationships)}

REQUESTED METRICS

${formatRequests(requests)}

RULES

1. Exactly one SQL statement per metric. No semicolons anywhere in the query text.
2. The statement must be a single SELECT. Never write INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, or any other non-SELECT statement.
3. Only reference the tables and columns listed above. Never invent a column or table name.
4. Joins, subqueries, and CTEs (WITH ...) are all allowed when the request needs them, as long as every table involved is one of the tables listed above and every join follows a relationship listed above.
5. Allowed functions: COUNT, SUM, AVG, MIN, MAX, ROW_NUMBER, RANK, DENSE_RANK, NTILE, LAG, LEAD, ROUND, COALESCE, NULLIF, DATE_TRUNC, PERCENTILE_CONT, PERCENTILE_DISC, CURRENT_DATE, CURRENT_TIMESTAMP, NOW, plus CASE expressions, INTERVAL literals (e.g. INTERVAL '90 days'), and plain arithmetic (+, -, *, /). Do not call any other function - no pg_sleep, no dblink, no file or system functions, nothing outside this list.
6. Every query MUST compute quantifiable numeric metrics for reports and dashboards:
   - For chart metrics (chart_type: "bar" | "line" | "pie" | "doughnut"), or breakdowns across groups (e.g. "X by Y", "colleges by district", "district by college"): the query MUST GROUP BY the dimension/category column (e.g. district) and calculate a numeric aggregation measure (e.g. COUNT(*), COUNT(col), SUM(col), AVG(col)) for the chart values. A chart query requires exactly one dimension label column and one numeric measure column. Never return multiple text/string columns without an aggregate! When there are many categories, ORDER BY the numeric measure DESC and LIMIT to 10 or 20.
   - For scalar KPI cards (chart_type: null): the query MUST return a single row with an aggregate numeric measure (e.g. COUNT, SUM, AVG, MIN, MAX). Never return unaggregated multi-row lists.
   - Always name/alias aggregate columns clearly (e.g. COUNT(*) AS total_count). Never use SELECT *.
7. Qualify every column with its table alias when the query touches more than one table, to avoid ambiguity.
8. Do not write comments in the SQL (no -- or /* */).
9. Do not add your own row-limiting or tenant-scoping filters - the system adds those automatically after your query is validated. Just write the query that answers the metric.
10. For a ranking request ("top N", "best/worst"), use ORDER BY ... LIMIT N, or RANK()/ROW_NUMBER() with PARTITION BY when ranking within groups (e.g. "top 3 per category"). Do not collapse a ranking into a single MAX/MIN value.
11. "Margin" or "profit margin" means a PERCENTAGE ((price - cost) / price), not the raw rupee/dollar difference, unless the request explicitly says "margin amount" or names a currency. Say so in the label (e.g. "Profit Margin %") and use format "percentage".
12. For "above average", "below average", "typical", or similar threshold comparisons, prefer the MEDIAN over the mean: PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY column) instead of AVG(column). The mean is skewed by a few extreme values; the median is not, and better represents "typical" for this kind of filter. Use AVG only when the request explicitly asks for "average" as the number to report, not as a comparison threshold.
13. When the request names a time window ("last quarter", "last 90 days", "this month", "Q4 2023", "in 2023"), add a WHERE filter on the relevant date column for that window - do not silently answer with all-time data instead. Use CURRENT_DATE/NOW() and INTERVAL for relative windows (e.g. WHERE order_date >= CURRENT_DATE - INTERVAL '90 days'), or literal date bounds for a named period (e.g. WHERE order_date >= '2023-10-01' AND order_date < '2024-01-01'). If no time window is mentioned, use all-time data as before.

OUTPUT FORMAT

Return exactly one valid JSON object with this shape and no other properties:

{
  "queries": [
    {
      "request": "the requested metric, copied exactly",
      "sql": "the SELECT statement answering it",
      "label": "a short human-readable title for this result",
      "format": "number | decimal | currency | percentage",
      "chart_type": "bar | line | pie | doughnut | null"
    }
  ]
}

Return one query object for every requested metric, in the same order.
Return only the JSON object. No markdown, no explanation outside the JSON.`;
}

function buildSqlKpiRepairPrompt(basePrompt, errorMessage, rejectedResponse) {
  const rejected =
    typeof rejectedResponse === "string"
      ? rejectedResponse
      : JSON.stringify(rejectedResponse, null, 2);

  return `${basePrompt}

PREVIOUS ATTEMPT WAS REJECTED

You returned this JSON:

${rejected}

It was rejected for this reason:

${errorMessage}

Fix only what the rejection reason describes. Keep every other query exactly as it was. Return the complete corrected JSON object.`;
}

// table-service's sqlPlanValidator.js rejects a query it received here
// AFTER this pipeline already finished (a different service, checking safety
// the structural repair above cannot see). This builds a focused, single-query
// repair prompt for that case - just this one query, not the whole batch.
function buildSqlKpiSafetyRepairPrompt({ schemas, relationshipModel, request, rejectedSql, errorMessage } = {}) {
  const compactedSchemas = compactSchemas(schemas);
  const relationships = relationshipModel?.relationships || [];

  return `You are a PostgreSQL analyst. A SQL query you wrote for one metric was rejected by an automated safety validator. Fix it.

TABLES (the real Postgres table and column names - use them exactly as spelled)

${compactedSchemas.map(formatTableBlock).join("\n\n")}

RELATIONSHIPS (confirmed foreign keys, for joins)

${formatRelationships(relationships)}

METRIC

${request}

QUERY THAT WAS REJECTED

${rejectedSql}

REJECTION REASON

${errorMessage}

RULES (same as before)

1. Exactly one SQL statement. No semicolons anywhere.
2. Must be a single SELECT. Never INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, GRANT, or any other non-SELECT statement.
3. Only reference the tables and columns listed above.
4. Joins, subqueries, and CTEs (WITH ...) are allowed, as long as every table involved is listed above.
5. Allowed functions: COUNT, SUM, AVG, MIN, MAX, ROW_NUMBER, RANK, DENSE_RANK, NTILE, LAG, LEAD, ROUND, COALESCE, NULLIF, DATE_TRUNC, PERCENTILE_CONT, PERCENTILE_DISC, CURRENT_DATE, CURRENT_TIMESTAMP, NOW, plus CASE, INTERVAL literals, and plain arithmetic.
6. Every query MUST compute quantifiable numeric metrics for reports and dashboards:
   - For chart metrics, or breakdown/distribution across groups (e.g. "X by Y"): GROUP BY the category/dimension and calculate an aggregate numeric measure (e.g. COUNT(*), SUM(col), AVG(col)). Return one label column and one numeric measure column.
   - For a single KPI metric card: return a single row with a numeric aggregate (COUNT, SUM, AVG, MIN, MAX). Never return unaggregated lists.
   - Explicit column names only, never SELECT *.
7. Qualify every column with its table/CTE alias whenever the query touches more than one table or CTE in the same scope - this is very likely what caused the rejection if the reason mentions an unqualified or ambiguous column.
8. No comments in the SQL.
9. Do not add your own row-limiting or tenant-scoping filters.

Fix only what the rejection reason describes. Keep the query's meaning the same otherwise.

OUTPUT FORMAT

Return exactly one valid JSON object with this shape and no other properties:

{ "sql": "the corrected SELECT statement" }

Return only the JSON object. No markdown, no explanation outside the JSON.`;
}

module.exports = {
  buildSqlKpiPrompt,
  buildSqlKpiRepairPrompt,
  buildSqlKpiSafetyRepairPrompt,
};

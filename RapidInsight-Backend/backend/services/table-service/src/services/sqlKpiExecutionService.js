const pool = require('../config/postgres');
const { normalizeIdentifier } = require('../utils/identifierNaming');

const { generateSqlKpis, repairSqlKpiQuery, writeInsights } = require('./aiBlueprintClient');
const { buildPhysicalContext, validateSqlPlan } = require('./sqlPlanValidator');
const {
  markDashboardGenerating,
  markDashboardReady,
  markDashboardFailed
} = require('./dashboardPersistenceService');

const VALID_FORMATS = new Set(['number', 'decimal', 'currency', 'percentage']);
const VALID_CHART_TYPES = new Set(['bar', 'line', 'pie', 'doughnut']);

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

// Shapes the project's schema bundles into what the LLM should see: the
// *physical* Postgres table/column names it will actually be writing SQL
// against, normalized the same way the tables were created
// (buildCreateTableSql.js), not the raw names the user uploaded.
function buildPhysicalSchemasForPrompt({ schemaBundles, generatedTablesBySchemaId }) {
  const schemas = [];

  for (const bundle of schemaBundles) {
    const generatedTable = generatedTablesBySchemaId.get(bundle.schema.id);
    if (!generatedTable) continue;

    const rawFields = bundle.schemaDefinition?.fields || bundle.schemaDefinition?.columns || [];

    const fields = (Array.isArray(rawFields) ? rawFields : []).map((field) => ({
      ...field,
      name: normalizeIdentifier(field?.name)
    }));

    schemas.push({
      schema_id: bundle.schema.id,
      table_name: generatedTable.physical_table_name,
      schemaDefinition: { fields }
    });
  }

  return schemas;
}

// The relationship model names tables by their logical schema table_name,
// but the SQL prompt/validator work in physical table names. Rewriting the
// relationship list keeps the "which joins are allowed" prompt section
// truthful for the physical names the model was actually given.
function toPhysicalRelationships({ relationshipModel, schemaBundles, generatedTablesBySchemaId }) {
  const physicalNameBySchemaId = new Map();

  for (const bundle of schemaBundles) {
    const generatedTable = generatedTablesBySchemaId.get(bundle.schema.id);
    if (generatedTable) physicalNameBySchemaId.set(bundle.schema.id, generatedTable.physical_table_name);
  }

  const physicalNameByLogicalName = new Map();
  (relationshipModel.tables || []).forEach((table) => {
    const physicalName = physicalNameBySchemaId.get(table.schema_id);
    if (physicalName) physicalNameByLogicalName.set(table.table_name, physicalName);
  });

  const relationships = (relationshipModel.relationships || [])
    .map((relationship) => ({
      from_table: physicalNameByLogicalName.get(relationship.from_table),
      from_column: normalizeIdentifier(relationship.from_column),
      to_table: physicalNameByLogicalName.get(relationship.to_table),
      to_column: normalizeIdentifier(relationship.to_column),
      relationship_type: relationship.relationship_type
    }))
    .filter((relationship) => relationship.from_table && relationship.to_table);

  return { tables: relationshipModel.tables, relationships };
}

const MAX_SAFETY_REPAIR_ATTEMPTS = 2;

/**
 * Validates one query's SQL, and if sqlPlanValidator rejects it (a 422 -
 * meaning the SQL itself was unsafe/unresolvable, not a system error), asks
 * the model to fix just that query and re-validates, up to
 * MAX_SAFETY_REPAIR_ATTEMPTS times. A non-422 error (parser crash, network
 * failure) is not repairable and is thrown immediately.
 */
async function validateWithRepair({
  item,
  context,
  physicalSchemas,
  physicalRelationshipModel,
  userId,
  userEmail,
  accessToken
}) {
  let sqlUsed = item.sql;

  for (let attempt = 0; attempt <= MAX_SAFETY_REPAIR_ATTEMPTS; attempt += 1) {
    try {
      const finalized = validateSqlPlan(sqlUsed, context);
      const { rows } = await withStatementTimeout(finalized);
      return { finalized, rows, sqlUsed, repairAttempts: attempt };
    } catch (error) {
      error.lastAttemptedSql = sqlUsed;

      if (attempt === MAX_SAFETY_REPAIR_ATTEMPTS) {
        throw error;
      }

      console.warn('SQL KPI query rejected by validator or database execution, asking LLM to repair', {
        request: item.request,
        attempt: attempt + 1,
        maxAttempts: MAX_SAFETY_REPAIR_ATTEMPTS,
        reason: error.message
      });

      const repaired = await repairSqlKpiQuery({
        schemas: physicalSchemas,
        relationshipModel: physicalRelationshipModel,
        request: item.request,
        rejectedSql: sqlUsed,
        errorMessage: error.message,
        userId,
        userEmail,
        accessToken
      });

      sqlUsed = repaired.sql;
    }
  }

  // Unreachable - the loop always returns or throws - but keeps the
  // function's control flow explicit for readers.
  throw new Error('SQL KPI repair loop exited without a result.');
}

function assertFormat(item, path) {
  if (!VALID_FORMATS.has(item.format)) fail(`${path}.format is invalid.`, 422);
  if (item.chart_type && !VALID_CHART_TYPES.has(item.chart_type)) {
    fail(`${path}.chart_type is invalid.`, 422);
  }
}

// Defense in depth: even a query that passed AST validation can still be
// expensive (e.g. a wide join over a large table), so it always runs with a
// hard server-side timeout rather than trusting the query shape alone.
const STATEMENT_TIMEOUT_MS = 5000;

async function withStatementTimeout(finalized) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const result = await client.query(finalized.text, finalized.values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const ID_LIKE_COLUMN = /(^|_)id$/i;

// pg returns DATE/TIMESTAMP columns as JS Date objects, and Number(dateObj)
// coerces to its epoch-milliseconds value - a large but perfectly finite
// number, which would otherwise misclassify a date column as the numeric
// measure. Objects (Date included) are never a "numeric value" here.
function isNumericValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'object') return false;
  return Number.isFinite(Number(value));
}

// A measure column can legitimately contain nulls (e.g. month-over-month
// growth has no prior month to compare against for the first row) - a lone
// null shouldn't disqualify an otherwise-numeric column from being the
// chart's value column.
function isNumericOrEmptyValue(value) {
  if (value === null || value === undefined || value === '') return true;
  return isNumericValue(value);
}

function formatLabelValue(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

// The plan-based query builder always names its result column "value";
// the LLM names its own columns, so the caller passes the actual value in.
function normalizeKpiValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return formatLabelValue(value);
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function prettifyColumnName(column) {
  return column
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Ignores id-like columns when multiple candidates exist, then requires exactly one
// non-numeric column (the label) and exactly one numeric column (the
// measure); handles 2-column numeric cases where the first column acts as bucket/label.
function deriveChartShape(rows, columns) {
  if (columns.length < 2) return null;

  let candidateColumns = columns;
  const filtered = columns.filter((column) => !ID_LIKE_COLUMN.test(column));
  if (filtered.length >= 2) {
    candidateColumns = filtered;
  }

  // Label: at least one row is something other than a number or a gap (a
  // date, a name, a category - anything that isn't measure-shaped).
  // Value: every row is a number or a gap (null) - a date column never
  // qualifies even though Date coerces to a finite epoch number, since
  // isNumericValue explicitly rejects objects.
  let labelColumns = candidateColumns.filter((column) => rows.some((row) => !isNumericOrEmptyValue(row[column])));
  let valueColumns = candidateColumns.filter((column) => rows.every((row) => isNumericOrEmptyValue(row[column])));

  // If both columns in a 2-column result are numeric (e.g. year, bucket, or id-like code as label):
  if (labelColumns.length === 0 && candidateColumns.length === 2 && valueColumns.length === 2) {
    labelColumns = [candidateColumns[0]];
    valueColumns = [candidateColumns[1]];
  }

  if (labelColumns.length !== 1 || valueColumns.length !== 1) {
    // If no numeric column exists, but rows are categorical (e.g. [category, item] or [category]):
    // Gracefully aggregate counts per category so raw grouping queries don't fail
    if (valueColumns.length === 0 && candidateColumns.length >= 1) {
      const groupCol = candidateColumns[0];
      const counts = new Map();
      for (const row of rows) {
        const val = row[groupCol];
        if (val !== null && val !== undefined && val !== '') {
          const key = String(val);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
      if (counts.size > 0) {
        const sortedEntries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
        const topEntries = sortedEntries.slice(0, 20);
        return {
          labelColumn: groupCol,
          valueColumn: candidateColumns.length > 1 ? candidateColumns[1] : groupCol,
          labels: topEntries.map(([k]) => k),
          values: topEntries.map(([, v]) => v)
        };
      }
    }
    return null;
  }

  const [labelColumn] = labelColumns;
  const [valueColumn] = valueColumns;

  return {
    labelColumn,
    valueColumn,
    labels: rows.map((row) => formatLabelValue(row[labelColumn])),
    // Preserve null as a gap rather than coercing to 0, which would
    // misrepresent "no prior month to compare" as "0% growth".
    values: rows.map((row) => {
      const value = row[valueColumn];
      return value === null || value === undefined ? null : Number(value);
    })
  };
}

function makeResultId(item, index) {
  return `${normalizeIdentifier(item.label || item.request || `metric_${index}`)}_${index}`;
}

/**
 * Shapes one successfully-executed query's rows into either a dashboard KPI
 * or a dashboard chart, matching the exact contract `dashboards.report_data`
 * needs (see dashboardPersistenceService.js / ProjectReportPage.jsx). Returns
 * null when the result doesn't cleanly fit either shape.
 */
function shapeDashboardResult(item, rows, index) {
  if (!rows || !rows.length) return null;

  const columns = Object.keys(rows[0]);
  const id = makeResultId(item, index);
  const description = `Answers: "${item.request}"`;

  // 1. Single row result without explicit chart type -> KPI
  if (rows.length === 1 && !item.chart_type) {
    const measureCol = columns.length === 1
      ? columns[0]
      : (columns.find((c) => isNumericValue(rows[0][c])) || columns[columns.length - 1]);

    return {
      kind: 'kpi',
      value: {
        id,
        title: item.label,
        description,
        measure_label: prettifyColumnName(measureCol),
        format: item.format,
        value: normalizeKpiValue(rows[0][measureCol])
      }
    };
  }

  // 2. Chart result: requires chart_type or multi-row result that fits a chart shape
  if (rows.length >= 1) {
    const shape = deriveChartShape(rows, columns);

    if (shape && (item.chart_type || rows.length > 1)) {
      let measureLabel = prettifyColumnName(shape.valueColumn);
      let groupLabel = prettifyColumnName(shape.labelColumn);

      const isGenericGroup = !groupLabel || /^(label|category|group|dimension|x)$/i.test(groupLabel);
      const isGenericMeasure = !measureLabel || /^(value|metric|val|measure|y)$/i.test(measureLabel);

      if ((isGenericGroup || isGenericMeasure) && (item.label || item.request)) {
        const text = (item.label || item.request || '').trim();
        const splitMatch = text.match(/^(.+?)\s+(?:by|per|across|vs|for each)\s+(.+)$/i);
        if (splitMatch) {
          const part1 = prettifyColumnName(splitMatch[1].trim());
          const part2 = prettifyColumnName(splitMatch[2].trim());
          const measureKeywords = /\b(count|sum|avg|average|total|number|rate|ratio|percentage|percent|margin|amount|performance|score|revenue|sales|profit|price|cost|growth|index|stat|statistics|metric|value)\b/i;
          const dimensionKeywords = /\b(name|district|city|state|country|region|college|school|category|type|status|dept|department|group|year|month|date|day|quarter|code|gender|id|class)\b/i;

          if (measureKeywords.test(part1) && !measureKeywords.test(part2)) {
            if (isGenericMeasure) measureLabel = part1;
            if (isGenericGroup) groupLabel = part2;
          } else if (dimensionKeywords.test(part1) || measureKeywords.test(part2)) {
            if (isGenericGroup) groupLabel = part1;
            if (isGenericMeasure) measureLabel = part2;
          } else {
            if (isGenericMeasure) measureLabel = part1;
            if (isGenericGroup) groupLabel = part2;
          }
        }
      }

      return {
        kind: 'chart',
        value: {
          id,
          title: item.label,
          description,
          type: item.chart_type || 'bar',
          measure_label: measureLabel,
          group_label: groupLabel,
          format: item.format || 'number',
          labels: shape.labels,
          values: shape.values
        }
      };
    }
  }

  // 3. Fallback: If 1 row exists and chart shaping didn't match, shape as KPI
  if (rows.length === 1) {
    const measureCol = columns.find((c) => isNumericValue(rows[0][c])) || columns[0];
    return {
      kind: 'kpi',
      value: {
        id,
        title: item.label,
        description,
        measure_label: prettifyColumnName(measureCol),
        format: item.format || 'number',
        value: normalizeKpiValue(rows[0][measureCol])
      }
    };
  }

  return null;
}

/**
 * Production replacement for analyticsDashboardService.js's
 * generateDashboardReport - same call contract, so the swap at the call site
 * in projectGenerateTablesService.js is a one-line change. The LLM writes
 * SQL directly for each requested KPI instead of a structured plan; safety
 * (table/column whitelist, function allow-list, tenant isolation) is
 * enforced by sqlPlanValidator.js exactly as in the preview endpoint above -
 * nothing here is trusted just because it's the "real" pipeline now.
 */
async function generateSqlDashboard({
  supabase,
  projectId,
  userId,
  userEmail,
  accessToken,
  blueprint,
  schemaBundles,
  generatedTablesBySchemaId,
  customKpis
}) {
  const requestedKpis = Array.isArray(customKpis)
    ? customKpis.filter((kpi) => String(kpi || '').trim())
    : [];

  const minimalConfig = {
    version: 1,
    title: null,
    subtitle: null,
    kpis: [],
    charts: [],
    insights: [],
    layout: null
  };

  try {
    if (!requestedKpis.length) {
      fail('At least one KPI is required to generate a dashboard. Enter one or more KPI requests and try again.');
    }

    await markDashboardGenerating({ supabase, projectId, userId, config: minimalConfig });

    const physicalSchemas = buildPhysicalSchemasForPrompt({ schemaBundles, generatedTablesBySchemaId });
    if (!physicalSchemas.length) {
      fail('No generated tables exist for this project yet. Run Generate Tables first.');
    }

    const physicalRelationshipModel = toPhysicalRelationships({
      relationshipModel: { tables: blueprint.tables, relationships: blueprint.relationships },
      schemaBundles,
      generatedTablesBySchemaId
    });

    const aiResponse = await generateSqlKpis({
      schemas: physicalSchemas,
      relationshipModel: physicalRelationshipModel,
      customKpis: requestedKpis,
      userId,
      userEmail,
      accessToken
    });

    const context = buildPhysicalContext({ schemaBundles, generatedTablesBySchemaId });

    const kpis = [];
    const charts = [];
    let lastExecutionError = null;

    for (const [index, item] of (aiResponse.queries || []).entries()) {
      const path = `queries[${index}]`;

      try {
        assertFormat(item, path);

        const { finalized, rows, repairAttempts } = await validateWithRepair({
          item,
          context,
          physicalSchemas,
          physicalRelationshipModel,
          userId,
          userEmail,
          accessToken
        });

        console.info('SQL KPI query executed successfully', {
          projectId,
          request: item.request,
          repairAttempts,
          sql: finalized.text.trim()
        });

        const shaped = shapeDashboardResult(item, rows, index);

        if (!shaped) {
          lastExecutionError = new Error(
            `Result for "${item.request}" could not be formatted into a KPI or chart (columns: ${rows.length ? Object.keys(rows[0]).join(', ') : 'none'}).`
          );
          console.warn('SQL KPI query result could not be shaped into a KPI or chart, omitting from dashboard', {
            projectId,
            request: item.request,
            columns: rows.length ? Object.keys(rows[0]) : []
          });
          continue;
        }

        if (shaped.kind === 'kpi') kpis.push(shaped.value);
        else charts.push(shaped.value);
      } catch (error) {
        lastExecutionError = error;
        console.warn('SQL KPI query rejected or failed, omitting from dashboard', {
          projectId,
          request: item.request,
          message: error.message
        });
      }
    }

    if (!kpis.length && !charts.length) {
      const errorMsg =
        lastExecutionError?.message ||
        'No KPI or chart metrics could be calculated from the project data.';
      await markDashboardFailed({
        supabase,
        projectId,
        userId,
        config: minimalConfig,
        errorMessage: errorMsg
      });
      fail(errorMsg);
    }

    let insights = [];

    if (kpis.length || charts.length) {
      try {
        const generated = await writeInsights({ kpis, charts, userId, userEmail, accessToken });
        if (Array.isArray(generated?.insights)) insights = generated.insights;
      } catch (error) {
        console.error('Insight generation failed, continuing without it:', error.message);
      }
    }

    const reportData = {
      version: 1,
      generated_at: new Date().toISOString(),
      kpis,
      charts,
      insights
    };

    return markDashboardReady({
      supabase,
      projectId,
      userId,
      config: { ...minimalConfig, insights },
      reportData
    });
  } catch (error) {
    try {
      await markDashboardFailed({
        supabase,
        projectId,
        userId,
        config: minimalConfig,
        errorMessage: error.message
      });
    } catch (persistenceError) {
      console.error('Failed to save dashboard failure state:', persistenceError);
    }

    throw error;
  }
}

module.exports = {
  generateSqlDashboard,
  deriveChartShape,
  shapeDashboardResult
};

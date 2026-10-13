const {
  buildSourceSchemaMaps,
  logBlueprint,
  isDateType,
} = require("./blueprintResponseValidator");

// Step 3 validation.
//
// The plan is still plain data at this point, not the strict dashboard
// contract, so this checks the things that would make step 4 impossible or
// produce a query that cannot run: columns that do not exist, non-numeric
// measures, and joins the confirmed relationships do not support.
//
// It deliberately does not judge whether a KPI is a good idea. A plan that is
// executable but dull is a prompt problem, not a validation problem.

const VALID_OPERATIONS = new Set(["count", "sum", "avg", "min", "max"]);
const VALID_STATUSES = new Set(["executable", "unsupported"]);
const VALID_SORT_DIRECTIONS = new Set(["asc", "desc"]);

const NUMERIC_TYPE_FAMILIES = new Set([
  "number", "numeric", "decimal", "float", "double", "real",
  "int", "integer", "tinyint", "smallint", "mediumint", "bigint",
  "serial", "smallserial", "bigserial", "money",
]);

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = 422;
    throw error;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function isNumericType(type) {
  const normalized = String(type || "").trim().toLowerCase();

  if (/^(int2|int4|int8|float4|float8|double precision)/.test(normalized)) {
    return true;
  }

  for (const numericType of NUMERIC_TYPE_FAMILIES) {
    if (normalized === numericType || normalized.startsWith(`${numericType}(`)) {
      return true;
    }
  }

  return false;
}

function isBlank(value) {
  return value === null || value === undefined || value === "";
}

// Directly connected table pairs, in both directions. Mirrors the join depth
// the downstream query builder can actually execute, so a plan accepted here
// stays executable later.
function buildConnectivity(relationships) {
  const pairs = new Set();

  (Array.isArray(relationships) ? relationships : []).forEach((relationship) => {
    const from = normalizeName(relationship?.from_table);
    const to = normalizeName(relationship?.to_table);

    if (!from || !to) return;

    pairs.add(`${from}::${to}`);
    pairs.add(`${to}::${from}`);
  });

  return pairs;
}

function resolveTable(sourceMaps, tableName, path) {
  const table = sourceMaps.byTableName.get(normalizeName(tableName));

  assert(table, `${path} "${tableName}" is not one of the uploaded tables.`);

  return table;
}

function resolveColumn(table, columnName, path) {
  const column = table.columns.get(normalizeName(columnName));

  assert(
    column,
    `${path} "${columnName}" does not exist in table "${table.tableName}".`
  );

  return column;
}

/*
 * "Top 10 products by revenue" asks for a list, so it has to group by
 * something. A model that reads "top" as "largest" answers with max and no
 * group_by, which collapses the whole list into one number and looks like a
 * working KPI rather than a failure.
 *
 * The request text is the only place that intent survives, so it is matched
 * here. A prompt rule alone cannot catch this, because the malformed plan is
 * structurally valid.
 */
const RANKING_REQUEST = /\b(?:top|bottom|best|worst|highest|lowest)\s+\d+\b|\btop\s+(?:selling|performing)\b/i;

function assertRankingHasDimension(plan, path) {
  if (!RANKING_REQUEST.test(String(plan.request || ""))) return;

  assert(
    !isBlank(plan.group_by_column),
    `${path} answers the ranking request "${plan.request}" with a single number. A "top N" request must set group_by_column to the thing being ranked, with sort_direction and limit.`
  );
}

function validateExecutablePlan(plan, index, sourceMaps, connectivity) {
  const path = `plans[${index}]`;

  assert(!isBlank(plan.base_table), `${path}.base_table is required for an executable plan.`);

  assertRankingHasDimension(plan, path);

  const baseTable = resolveTable(sourceMaps, plan.base_table, `${path}.base_table`);
  const baseTableName = normalizeName(plan.base_table);

  assert(
    VALID_OPERATIONS.has(plan.operation),
    `${path}.operation must be one of count, sum, avg, min, max.`
  );

  // count is the only operation that can work without a column, since it
  // measures rows rather than values.
  if (plan.operation === "count") {
    if (!isBlank(plan.measure_column)) {
      resolveColumn(baseTable, plan.measure_column, `${path}.measure_column`);
    }
  } else {
    assert(
      !isBlank(plan.measure_column),
      `${path}.measure_column is required for operation "${plan.operation}".`
    );

    const measureColumn = resolveColumn(
      baseTable,
      plan.measure_column,
      `${path}.measure_column`
    );

    // A date measure column is normally meaningless for sum/avg, but it is
    // exactly what a date difference needs: the aggregate runs on the day count
    // produced by the subtraction, not on the raw date. The difference block
    // below confirms the other side is also a date.
    const measuresDateDifference =
      !isBlank(plan.difference_column) && isDateType(measureColumn.type);

    assert(
      isNumericType(measureColumn.type) || measuresDateDifference,
      `${path}.measure_column "${measureColumn.name}" is type "${measureColumn.type}", which cannot be used with "${plan.operation}".`
    );
  }

  if (!isBlank(plan.ratio_column)) {
    assert(
      plan.operation !== "count",
      `${path}.ratio_column cannot be combined with operation "count".`
    );

    assert(
      isBlank(plan.difference_column),
      `${path} sets both ratio_column and difference_column. A measure is either a ratio (A divided by B) or a difference (A minus B), not both.`
    );

    const ratioColumn = resolveColumn(
      baseTable,
      plan.ratio_column,
      `${path}.ratio_column`
    );

    assert(
      isNumericType(ratioColumn.type),
      `${path}.ratio_column "${ratioColumn.name}" is type "${ratioColumn.type}" and must be numeric.`
    );
  }

  // A difference measure subtracts one column from another and aggregates the
  // result: profit as unit_price - cost_price, or a duration as
  // discharge_date - admission_date. Unlike a ratio, the subtracted column may
  // live on a directly connected table.
  if (!isBlank(plan.difference_column)) {
    assert(
      plan.operation !== "count",
      `${path}.difference_column cannot be combined with operation "count".`
    );

    assert(
      !isBlank(plan.measure_column),
      `${path}.difference_column requires measure_column, which is the value it is subtracted from.`
    );

    const differenceTableName = isBlank(plan.difference_table)
      ? baseTableName
      : normalizeName(plan.difference_table);

    const differenceTable = isBlank(plan.difference_table)
      ? baseTable
      : resolveTable(sourceMaps, plan.difference_table, `${path}.difference_table`);

    if (differenceTableName !== baseTableName) {
      assert(
        connectivity.has(`${baseTableName}::${differenceTableName}`),
        `${path} subtracts "${plan.difference_column}" on "${plan.difference_table}" from a measure on "${plan.base_table}", but no confirmed relationship connects them directly.`
      );
    }

    const differenceColumn = resolveColumn(
      differenceTable,
      plan.difference_column,
      `${path}.difference_column`
    );

    const measureColumn = resolveColumn(
      baseTable,
      plan.measure_column,
      `${path}.measure_column`
    );

    // Both sides must be the same category: numeric minus numeric yields a
    // value, date minus date yields a duration. Mixing them is meaningless.
    const bothNumeric =
      isNumericType(measureColumn.type) && isNumericType(differenceColumn.type);
    const bothDates =
      isDateType(measureColumn.type) && isDateType(differenceColumn.type);

    assert(
      bothNumeric || bothDates,
      `${path} subtracts "${differenceColumn.name}" (${differenceColumn.type}) from "${measureColumn.name}" (${measureColumn.type}). Both columns must be numeric, or both must be dates.`
    );

    if (plan.difference_as_percentage === true) {
      assert(
        bothNumeric,
        `${path}.difference_as_percentage requires numeric columns, but "${measureColumn.name}" and "${differenceColumn.name}" are dates. A percentage of a duration is not meaningful.`
      );
    }
  } else {
    assert(
      plan.difference_as_percentage !== true,
      `${path}.difference_as_percentage is set without difference_column, so there is no difference to express as a percentage.`
    );
  }

  // group_by_table and group_by_column travel together: a dimension without a
  // column, or a column without a table, cannot be turned into a GROUP BY.
  const hasGroupByTable = !isBlank(plan.group_by_table);
  const hasGroupByColumn = !isBlank(plan.group_by_column);

  assert(
    hasGroupByTable === hasGroupByColumn,
    `${path}.group_by_table and group_by_column must both be set or both be null.`
  );

  if (hasGroupByColumn) {
    const groupByTable = resolveTable(
      sourceMaps,
      plan.group_by_table,
      `${path}.group_by_table`
    );

    resolveColumn(groupByTable, plan.group_by_column, `${path}.group_by_column`);

    const groupByTableName = normalizeName(plan.group_by_table);

    if (groupByTableName !== baseTableName) {
      assert(
        connectivity.has(`${baseTableName}::${groupByTableName}`),
        `${path} groups "${plan.base_table}" by "${plan.group_by_table}", but no confirmed relationship connects them directly.`
      );
    }
  }

  if (!isBlank(plan.sort_direction)) {
    assert(
      VALID_SORT_DIRECTIONS.has(plan.sort_direction),
      `${path}.sort_direction must be asc or desc.`
    );
  }

  if (!isBlank(plan.limit)) {
    assert(
      Number.isInteger(plan.limit) && plan.limit >= 1 && plan.limit <= 20,
      `${path}.limit must be a whole number from 1 to 20.`
    );
  }
}

function validateKpiPlanResponse(response, schemas, relationshipModel, requests = []) {
  logBlueprint("RAW KPI PLAN RESPONSE", response);

  assert(isObject(response), "KPI plan response must be a JSON object.");

  Object.keys(response).forEach((property) => {
    assert(
      property === "plans",
      `kpiPlan.${property} is not allowed. Return only plans.`
    );
  });

  assert(Array.isArray(response.plans), "kpiPlan.plans must be an array.");

  /*
   * Every requested metric must come back. Silently dropping one is the
   * failure mode that leaves a user wondering why they asked for four KPIs
   * and got two.
   *
   * Only a shortfall is rejected. A request like "top products / top
   * categories" is legitimately two metrics, and failing the run because the
   * model split it correctly would throw away a good answer over arithmetic.
   */
  if (requests.length) {
    assert(
      response.plans.length >= requests.length,
      `kpiPlan.plans is missing a plan for at least one requested metric (expected at least ${requests.length}, got ${response.plans.length}). Return one plan per request.`
    );

    if (response.plans.length > requests.length) {
      console.warn('KPI plan returned more plans than requests', {
        requests: requests.length,
        plans: response.plans.length
      });
    }
  }

  const sourceMaps = buildSourceSchemaMaps(schemas);
  const connectivity = buildConnectivity(relationshipModel?.relationships);

  response.plans.forEach((plan, index) => {
    const path = `plans[${index}]`;

    assert(isObject(plan), `${path} must be an object.`);
    assert(
      typeof plan.request === "string" && plan.request.trim().length > 0,
      `${path}.request is required.`
    );
    assert(
      VALID_STATUSES.has(plan.status),
      `${path}.status must be executable or unsupported.`
    );
    assert(
      typeof plan.reason === "string" && plan.reason.trim().length > 0,
      `${path}.reason is required.`
    );

    if (plan.status === "executable") {
      validateExecutablePlan(plan, index, sourceMaps, connectivity);
    }
  });

  logBlueprint("VALIDATED KPI PLAN", response);

  return true;
}

module.exports = {
  validateKpiPlanResponse,
};

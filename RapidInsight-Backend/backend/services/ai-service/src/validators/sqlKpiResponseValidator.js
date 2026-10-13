const { logBlueprint } = require("./blueprintResponseValidator");

// Structural validation only: shape of the JSON response, not safety of the
// SQL text inside it. This runs in ai-service, which has no schema/tenant
// context to check a query against. The actual safety check (table/column
// whitelist, function allow-list, tenant isolation) happens in table-service's
// sqlPlanValidator.js, right before the query is executed.

const VALID_FORMATS = new Set(["number", "decimal", "currency", "percentage"]);
const VALID_CHART_TYPES = new Set(["bar", "line", "pie", "doughnut"]);

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

function isBlank(value) {
  return value === null || value === undefined || value === "";
}

function validateSqlKpiResponse(response, requests = []) {
  logBlueprint("RAW SQL KPI RESPONSE", response);

  assert(isObject(response), "SQL KPI response must be a JSON object.");

  Object.keys(response).forEach((property) => {
    assert(
      property === "queries",
      `sqlKpi.${property} is not allowed. Return only queries.`
    );
  });

  assert(Array.isArray(response.queries), "sqlKpi.queries must be an array.");

  if (requests.length) {
    assert(
      response.queries.length >= requests.length,
      `sqlKpi.queries is missing an entry for at least one requested metric (expected at least ${requests.length}, got ${response.queries.length}). Return one query per request.`
    );
  }

  response.queries.forEach((item, index) => {
    const path = `queries[${index}]`;

    assert(isObject(item), `${path} must be an object.`);
    assert(
      typeof item.request === "string" && item.request.trim().length > 0,
      `${path}.request is required.`
    );
    assert(
      typeof item.sql === "string" && item.sql.trim().length > 0,
      `${path}.sql is required and must be a non-empty string.`
    );
    assert(
      typeof item.label === "string" && item.label.trim().length > 0,
      `${path}.label is required.`
    );
    assert(
      VALID_FORMATS.has(item.format),
      `${path}.format must be one of number, decimal, currency, percentage.`
    );

    if (!isBlank(item.chart_type)) {
      assert(
        VALID_CHART_TYPES.has(item.chart_type),
        `${path}.chart_type must be one of bar, line, pie, doughnut, or null.`
      );
    }
  });

  logBlueprint("VALIDATED SQL KPI RESPONSE", response);

  return true;
}

function validateSqlKpiRepairResponse(response) {
  logBlueprint("RAW SQL KPI SAFETY REPAIR RESPONSE", response);

  assert(isObject(response), "SQL KPI repair response must be a JSON object.");

  Object.keys(response).forEach((property) => {
    assert(property === "sql", `sqlKpiRepair.${property} is not allowed. Return only sql.`);
  });

  assert(
    typeof response.sql === "string" && response.sql.trim().length > 0,
    "sqlKpiRepair.sql is required and must be a non-empty string."
  );

  return true;
}

module.exports = {
  validateSqlKpiResponse,
  validateSqlKpiRepairResponse,
};

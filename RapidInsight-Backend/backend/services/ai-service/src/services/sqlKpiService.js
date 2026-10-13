const {
  getAiProvider
} = require('../providers/aiClientFactory');

const {
  buildSqlKpiPrompt,
  buildSqlKpiRepairPrompt,
  buildSqlKpiSafetyRepairPrompt
} = require('../prompts/sqlKpiPrompt');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  validateSqlKpiResponse,
  validateSqlKpiRepairResponse
} = require('../validators/sqlKpiResponseValidator');

const {
  validateSourceSchemas
} = require('../validators/blueprintResponseValidator');

const MAX_SQL_KPI_ATTEMPTS = 3;
const REPAIR_TEMPERATURES = [0, 0.2, 0.4];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // structural response validation rejected it
  502  // response was not valid JSON
]);

// Mirrors kpiPlanService.js's request-splitting so a pasted list of metrics
// produces one query per metric, matching how the frontend already sends
// custom KPI requests.
function splitCompoundRequest(value) {
  return String(value || '')
    .split(/\r?\n|\s*\/\s*|;/)
    .map((part) =>
      part
        .replace(/\t+/g, ' - ')
        .replace(/\s+/g, ' ')
        .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '')
        .trim()
    )
    .filter(Boolean);
}

function normalizeRequests(customKpis) {
  if (Array.isArray(customKpis)) {
    return customKpis.flatMap(splitCompoundRequest);
  }

  if (typeof customKpis === 'string') {
    return splitCompoundRequest(customKpis);
  }

  return [];
}

/**
 * Experimental alternative to generateKpiPlan (kpiPlanService.js): asks the
 * model to write SQL directly instead of a structured plan. The response is
 * only structurally validated here - the SQL text itself is opaque to
 * ai-service and is checked for real by table-service's sqlPlanValidator
 * before it ever runs against Postgres.
 */
async function generateSqlKpiQueries(input) {
  if (!input || !Array.isArray(input.schemas) || input.schemas.length === 0) {
    const error = new Error('schemas are required to generate SQL KPI queries.');
    error.statusCode = 400;
    throw error;
  }

  const relationshipModel = input.relationship_model || input.relationshipModel;

  if (!relationshipModel || !Array.isArray(relationshipModel.tables)) {
    const error = new Error(
      'relationship_model with tables is required to generate SQL KPI queries. Run relationship inference first.'
    );

    error.statusCode = 400;
    throw error;
  }

  const requests = normalizeRequests(
    input.custom_kpis || input.customKpis || input.requests
  );

  if (!requests.length) {
    const error = new Error('At least one requested KPI is required to generate SQL KPI queries.');
    error.statusCode = 400;
    throw error;
  }

  validateSourceSchemas(input.schemas);

  const basePrompt = buildSqlKpiPrompt({
    schemas: input.schemas,
    relationshipModel,
    requests
  });

  const provider = getAiProvider();

  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= MAX_SQL_KPI_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildSqlKpiRepairPrompt(basePrompt, lastError.message, lastResponse);

    const rawResult = await provider.generateDataModelBlueprint({
      prompt,
      input,
      temperature:
        REPAIR_TEMPERATURES[attempt - 1] ??
        REPAIR_TEMPERATURES[REPAIR_TEMPERATURES.length - 1]
    });

    lastResponse = rawResult;

    try {
      const parsed =
        typeof rawResult === 'string'
          ? parseStrictJson(rawResult)
          : rawResult;

      validateSqlKpiResponse(parsed, requests);

      if (attempt > 1) {
        console.warn('SQL KPI response accepted after repair attempts', {
          attempts: attempt
        });
      }

      return parsed;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) {
        throw error;
      }

      lastError = error;

      console.warn('SQL KPI response rejected, requesting repair', {
        attempt,
        maxAttempts: MAX_SQL_KPI_ATTEMPTS,
        statusCode: error.statusCode,
        reason: error.message
      });
    }
  }

  lastError.message = `${lastError.message} (unresolved after ${MAX_SQL_KPI_ATTEMPTS} attempts)`;

  throw lastError;
}

const MAX_SAFETY_REPAIR_ATTEMPTS = 2;
const SAFETY_REPAIR_TEMPERATURES = [0.2, 0.4];

/**
 * Fixes one query that table-service's SQL safety validator rejected - a
 * different failure than the structural repair loop above, since the
 * rejection only exists after this pipeline already returned an answer.
 * Retries a couple of times against the model's own repair attempts, each
 * time feeding back whatever error the validator raised.
 */
async function repairSqlKpiQuery({ schemas, relationshipModel, request, rejectedSql, errorMessage }) {
  if (!Array.isArray(schemas) || schemas.length === 0) {
    const error = new Error('schemas are required to repair a SQL KPI query.');
    error.statusCode = 400;
    throw error;
  }

  if (!request || !rejectedSql || !errorMessage) {
    const error = new Error('request, rejectedSql, and errorMessage are required to repair a SQL KPI query.');
    error.statusCode = 400;
    throw error;
  }

  const provider = getAiProvider();

  let currentSql = rejectedSql;
  let currentError = errorMessage;
  let lastFailure;

  for (let attempt = 1; attempt <= MAX_SAFETY_REPAIR_ATTEMPTS; attempt += 1) {
    const prompt = buildSqlKpiSafetyRepairPrompt({
      schemas,
      relationshipModel,
      request,
      rejectedSql: currentSql,
      errorMessage: currentError
    });

    const rawResult = await provider.generateDataModelBlueprint({
      prompt,
      temperature: SAFETY_REPAIR_TEMPERATURES[attempt - 1] ?? SAFETY_REPAIR_TEMPERATURES[SAFETY_REPAIR_TEMPERATURES.length - 1]
    });

    try {
      const parsed =
        typeof rawResult === 'string'
          ? parseStrictJson(rawResult)
          : rawResult;

      validateSqlKpiRepairResponse(parsed);

      return { sql: parsed.sql };
    } catch (error) {
      if (error.statusCode !== 502) throw error;

      lastFailure = error;
      // Only ai-service's own structural check can fail here (bad JSON) -
      // the actual SQL safety re-check happens back in table-service.
      console.warn('SQL KPI safety repair response was not valid JSON, retrying', {
        attempt,
        maxAttempts: MAX_SAFETY_REPAIR_ATTEMPTS
      });
    }
  }

  lastFailure.message = `${lastFailure.message} (unresolved after ${MAX_SAFETY_REPAIR_ATTEMPTS} repair attempts)`;
  throw lastFailure;
}

module.exports = {
  generateSqlKpiQueries,
  repairSqlKpiQuery
};

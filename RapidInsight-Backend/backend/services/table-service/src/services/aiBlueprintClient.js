const axios = require('axios');

const DEFAULT_AI_SERVICE_URL = 'http://localhost:3005';
const DEFAULT_TIMEOUT_MS = 180000;

function normalizeBaseUrl(value) {
  return String(
    value ||
    DEFAULT_AI_SERVICE_URL
  ).replace(/\/+$/, '');
}

function buildSafeUpstreamDetails(error) {
  const responseData = error.response?.data;

  return {
    statusCode:
      error.response?.status ||
      null,
    code:
      responseData?.code ||
      error.code ||
      null,
    message:
      responseData?.message ||
      error.message ||
      'AI blueprint request failed.',
    details:
      responseData?.details ||
      null
  };
}

function createAiServiceError(error) {
  const upstream = buildSafeUpstreamDetails(error);

  const statusCode =
    Number.isInteger(upstream.statusCode) &&
      upstream.statusCode >= 400
      ? upstream.statusCode
      : 502;

  const wrappedError = new Error(
    upstream.message
  );

  wrappedError.statusCode = statusCode;
  wrappedError.code =
    upstream.code ||
    'AI_BLUEPRINT_REQUEST_FAILED';

  wrappedError.details = upstream.details;

  return wrappedError;
}

function getRequestHeaders({
  userId,
  userEmail,
  accessToken
}) {
  const internalServiceKey =
    process.env.INTERNAL_SERVICE_KEY;

  if (!internalServiceKey) {
    const error = new Error(
      'INTERNAL_SERVICE_KEY is not configured in table-service.'
    );

    error.statusCode = 500;
    error.code = 'INTERNAL_SERVICE_KEY_MISSING';

    throw error;
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-internal-service-key': internalServiceKey,
    'x-user-id': userId
  };

  if (userEmail) {
    headers['x-user-email'] = userEmail;
  }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
}

async function generateDataModelBlueprint({
  project,
  schemas,
  custom_kpis,
  customKpis,
  userId,
  userEmail,
  accessToken
}) {
  if (!userId) {
    const error = new Error(
      'userId is required for AI blueprint generation.'
    );

    error.statusCode = 400;
    error.code = 'AI_USER_ID_REQUIRED';

    throw error;
  }

  if (!Array.isArray(schemas) || schemas.length === 0) {
    const error = new Error(
      'At least one schema is required for AI blueprint generation.'
    );

    error.statusCode = 400;
    error.code = 'AI_SCHEMAS_REQUIRED';

    throw error;
  }

  const aiServiceUrl = normalizeBaseUrl(
    process.env.AI_SERVICE_URL
  );

  const endpoint =
    `${aiServiceUrl}/ai/data-model-blueprint`;

  const requestBody = {
    project,
    schemas,
    custom_kpis: custom_kpis || customKpis || []
  };

  const requestBytes = Buffer.byteLength(
    JSON.stringify(requestBody),
    'utf8'
  );

  console.info('Requesting data model blueprint', {
    aiServiceUrl,
    endpoint,
    schemaCount: schemas.length,
    requestBytes
  });

  try {
    const response = await axios.post(
      endpoint,
      requestBody,
      {
        headers: getRequestHeaders({
          userId,
          userEmail,
          accessToken
        }),
        timeout:
          Number.parseInt(
            process.env.AI_REQUEST_TIMEOUT_MS,
            10
          ) || DEFAULT_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const blueprint =
      response.data?.data ||
      response.data;

    if (!blueprint || typeof blueprint !== 'object') {
      const error = new Error(
        'AI service returned an invalid blueprint response.'
      );

      error.statusCode = 502;
      error.code = 'AI_BLUEPRINT_INVALID_RESPONSE';

      throw error;
    }

    return blueprint;
  } catch (error) {
    if (
      error.statusCode &&
      !error.response
    ) {
      throw error;
    }

    const safeError = createAiServiceError(error);

    console.error('AI blueprint request failed', {
      endpoint,
      statusCode: safeError.statusCode,
      code: safeError.code,
      message: safeError.message,
      details: safeError.details || null,
      schemaCount: schemas.length,
      requestBytes
    });

    throw safeError;
  }
}

/**
 * Step 1 of the multi-step generation pipeline: keys and relationships only.
 *
 * Kept separate from generateDataModelBlueprint so the caller can persist the
 * data model as soon as it exists, without waiting for KPI planning. The
 * response carries only tables and relationships.
 */
async function inferRelationships({
  project,
  schemas,
  userId,
  userEmail,
  accessToken
}) {
  if (!userId) {
    const error = new Error(
      'userId is required for AI relationship inference.'
    );

    error.statusCode = 400;
    error.code = 'AI_USER_ID_REQUIRED';

    throw error;
  }

  if (!Array.isArray(schemas) || schemas.length === 0) {
    const error = new Error(
      'At least one schema is required for AI relationship inference.'
    );

    error.statusCode = 400;
    error.code = 'AI_SCHEMAS_REQUIRED';

    throw error;
  }

  const aiServiceUrl = normalizeBaseUrl(
    process.env.AI_SERVICE_URL
  );

  const endpoint = `${aiServiceUrl}/ai/relationships`;

  const requestBody = {
    project,
    schemas
  };

  const requestBytes = Buffer.byteLength(
    JSON.stringify(requestBody),
    'utf8'
  );

  console.info('Requesting relationship inference', {
    aiServiceUrl,
    endpoint,
    schemaCount: schemas.length,
    requestBytes
  });

  try {
    const response = await axios.post(
      endpoint,
      requestBody,
      {
        headers: getRequestHeaders({
          userId,
          userEmail,
          accessToken
        }),
        timeout:
          Number.parseInt(
            process.env.AI_REQUEST_TIMEOUT_MS,
            10
          ) || DEFAULT_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    const relationships =
      response.data?.data ||
      response.data;

    if (
      !relationships ||
      typeof relationships !== 'object' ||
      !Array.isArray(relationships.tables)
    ) {
      const error = new Error(
        'AI service returned an invalid relationship response.'
      );

      error.statusCode = 502;
      error.code = 'AI_RELATIONSHIPS_INVALID_RESPONSE';

      throw error;
    }

    return relationships;
  } catch (error) {
    if (
      error.statusCode &&
      !error.response
    ) {
      throw error;
    }

    const safeError = createAiServiceError(error);

    console.error('AI relationship request failed', {
      endpoint,
      statusCode: safeError.statusCode,
      code: safeError.code,
      message: safeError.message,
      details: safeError.details || null,
      schemaCount: schemas.length,
      requestBytes
    });

    throw safeError;
  }
}

/**
 * Shared transport for the multi-step endpoints.
 *
 * The two original methods predate the split and each carry their own copy of
 * this. New steps share one implementation so a change to timeouts, headers,
 * or error shaping applies to every step at once.
 */
async function postToAiService({
  path,
  body,
  label,
  userId,
  userEmail,
  accessToken,
  isValidResponse,
  invalidCode
}) {
  if (!userId) {
    const error = new Error(`userId is required for ${label}.`);

    error.statusCode = 400;
    error.code = 'AI_USER_ID_REQUIRED';

    throw error;
  }

  const aiServiceUrl = normalizeBaseUrl(process.env.AI_SERVICE_URL);
  const endpoint = `${aiServiceUrl}${path}`;

  const requestBytes = Buffer.byteLength(JSON.stringify(body), 'utf8');

  console.info(`Requesting ${label}`, {
    aiServiceUrl,
    endpoint,
    requestBytes
  });

  try {
    const response = await axios.post(endpoint, body, {
      headers: getRequestHeaders({
        userId,
        userEmail,
        accessToken
      }),
      timeout:
        Number.parseInt(process.env.AI_REQUEST_TIMEOUT_MS, 10) ||
        DEFAULT_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    const payload = response.data?.data || response.data;

    if (!payload || typeof payload !== 'object' || !isValidResponse(payload)) {
      const error = new Error(`AI service returned an invalid ${label} response.`);

      error.statusCode = 502;
      error.code = invalidCode;

      throw error;
    }

    return payload;
  } catch (error) {
    if (error.statusCode && !error.response) {
      throw error;
    }

    const safeError = createAiServiceError(error);

    console.error(`AI ${label} request failed`, {
      endpoint,
      statusCode: safeError.statusCode,
      code: safeError.code,
      message: safeError.message,
      details: safeError.details || null,
      requestBytes
    });

    throw safeError;
  }
}

/**
 * Step 3: map requested KPIs onto the confirmed data model.
 */
async function planKpis({
  schemas,
  relationshipModel,
  customKpis,
  userId,
  userEmail,
  accessToken
}) {
  return postToAiService({
    path: '/ai/kpi-plan',
    label: 'KPI planning',
    body: {
      schemas,
      relationship_model: relationshipModel,
      custom_kpis: customKpis
    },
    userId,
    userEmail,
    accessToken,
    isValidResponse: (payload) => Array.isArray(payload.plans),
    invalidCode: 'AI_KPI_PLAN_INVALID_RESPONSE'
  });
}

/**
 * Experimental alternative to planKpis: asks the model to write SQL
 * directly instead of a structured plan. The response is only structurally
 * validated by ai-service - sqlKpiExecutionService.js runs the actual SQL
 * safety validation before executing anything.
 */
async function generateSqlKpis({
  schemas,
  relationshipModel,
  customKpis,
  userId,
  userEmail,
  accessToken
}) {
  return postToAiService({
    path: '/ai/sql-kpi-plan',
    label: 'SQL KPI generation',
    body: {
      schemas,
      relationship_model: relationshipModel,
      custom_kpis: customKpis
    },
    userId,
    userEmail,
    accessToken,
    isValidResponse: (payload) => Array.isArray(payload.queries),
    invalidCode: 'AI_SQL_KPI_INVALID_RESPONSE'
  });
}

/**
 * Fixes one query that sqlPlanValidator.js rejected. A different failure
 * than generateSqlKpis' own structural retries - this only exists because
 * the safety check runs here, in table-service, after ai-service already
 * returned its answer.
 */
async function repairSqlKpiQuery({
  schemas,
  relationshipModel,
  request,
  rejectedSql,
  errorMessage,
  userId,
  userEmail,
  accessToken
}) {
  return postToAiService({
    path: '/ai/sql-kpi-repair',
    label: 'SQL KPI repair',
    body: {
      schemas,
      relationship_model: relationshipModel,
      request,
      rejectedSql,
      errorMessage
    },
    userId,
    userEmail,
    accessToken,
    isValidResponse: (payload) => typeof payload.sql === 'string' && payload.sql.trim().length > 0,
    invalidCode: 'AI_SQL_KPI_REPAIR_INVALID_RESPONSE'
  });
}

/**
 * Step 4: format the plans into the strict dashboard contract.
 */
async function buildDashboardSpec({
  schemas,
  relationshipModel,
  plans,
  userId,
  userEmail,
  accessToken
}) {
  return postToAiService({
    path: '/ai/dashboard-spec',
    label: 'dashboard spec',
    body: {
      schemas,
      relationship_model: relationshipModel,
      plans
    },
    userId,
    userEmail,
    accessToken,
    isValidResponse: (payload) =>
      payload.dashboard && typeof payload.dashboard === 'object',
    invalidCode: 'AI_DASHBOARD_SPEC_INVALID_RESPONSE'
  });
}

/**
 * Step 6: describe results that have already been computed.
 */
async function writeInsights({
  kpis,
  charts,
  maxInsights,
  userId,
  userEmail,
  accessToken
}) {
  return postToAiService({
    path: '/ai/insights',
    label: 'insight generation',
    body: {
      kpis,
      charts,
      max_insights: maxInsights
    },
    userId,
    userEmail,
    accessToken,
    isValidResponse: (payload) => Array.isArray(payload.insights),
    invalidCode: 'AI_INSIGHTS_INVALID_RESPONSE'
  });
}

module.exports = {
  generateDataModelBlueprint,
  inferRelationships,
  planKpis,
  generateSqlKpis,
  repairSqlKpiQuery,
  buildDashboardSpec,
  writeInsights
};
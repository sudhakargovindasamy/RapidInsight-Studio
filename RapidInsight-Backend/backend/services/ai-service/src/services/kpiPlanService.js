const {
  getAiProvider
} = require('../providers/aiClientFactory');

const {
  buildKpiPlanPrompt,
  buildKpiPlanRepairPrompt
} = require('../prompts/kpiPlanPrompt');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  validateKpiPlanResponse
} = require('../validators/kpiPlanResponseValidator');

const {
  validateSourceSchemas
} = require('../validators/blueprintResponseValidator');

const MAX_KPI_PLAN_ATTEMPTS = 3;

// At temperature 0 an identical prompt reproduces an identical response, so a
// repair attempt must change the input: it carries the rejected JSON plus the
// reason, and nudges temperature up to escape a stuck answer.
const REPAIR_TEMPERATURES = [0, 0.2, 0.4];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // strict plan validation rejected the response
  502  // response was not valid JSON
]);

/*
 * One entry in the UI can still hold several metrics: pasting a list into the
 * box produces a single array item containing newlines, and users write
 * "Top 10 products by revenue / Top categories" as one line meaning two.
 *
 * Splitting here rather than collapsing whitespace keeps the count the model
 * is asked for equal to the number of metrics it can actually see, which is
 * what the one-plan-per-request check depends on.
 */
function splitCompoundRequest(value) {
  return String(value || '')
    /*
     * A slash separates two metrics when text sits on both sides, with or
     * without spaces ("top products/top categories"). Requiring spaces missed
     * the common unspaced form. Slashes inside a word, as in "profit/loss
     * ratio", are still split, which is the safer error: an extra plan is
     * tolerated downstream, a merged pair is not.
     */
    .split(/\r?\n|\s*\/\s*|;/)
    .map((part) =>
      part
        .replace(/\t+/g, ' - ')
        .replace(/\s+/g, ' ')
        // Drop any "1." or "-" list marker the user pasted in with the text.
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
 * Step 3 of the multi-step generation pipeline.
 *
 * Maps each requested metric onto the confirmed data model, deciding table,
 * column, operation, and dimension. Step 4 turns the result into the strict
 * dashboard contract; keeping the two apart means neither the reasoning nor
 * the formatting has to compete for the model's attention.
 */
async function generateKpiPlan(input) {
  if (!input || !Array.isArray(input.schemas) || input.schemas.length === 0) {
    const error = new Error('schemas are required to plan KPIs.');
    error.statusCode = 400;
    throw error;
  }

  const relationshipModel = input.relationship_model || input.relationshipModel;

  if (!relationshipModel || !Array.isArray(relationshipModel.tables)) {
    const error = new Error(
      'relationship_model with tables is required to plan KPIs. Run relationship inference first.'
    );

    error.statusCode = 400;
    throw error;
  }

  const requests = normalizeRequests(
    input.custom_kpis || input.customKpis || input.requests
  );

  if (!requests.length) {
    const error = new Error('At least one requested KPI is required to plan KPIs.');
    error.statusCode = 400;
    throw error;
  }

  // Problems in the uploaded schemas cannot be repaired by re-prompting, so
  // fail before spending any provider calls on them.
  validateSourceSchemas(input.schemas);

  const basePrompt = buildKpiPlanPrompt({
    schemas: input.schemas,
    relationshipModel,
    requests
  });

  const provider = getAiProvider();

  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= MAX_KPI_PLAN_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildKpiPlanRepairPrompt(basePrompt, lastError.message, lastResponse);

    const rawResult = await provider.generateDataModelBlueprint({
      prompt,
      input,
      temperature:
        REPAIR_TEMPERATURES[attempt - 1] ??
        REPAIR_TEMPERATURES[REPAIR_TEMPERATURES.length - 1]
    });

    lastResponse = rawResult;

    try {
      const plan =
        typeof rawResult === 'string'
          ? parseStrictJson(rawResult)
          : rawResult;

      validateKpiPlanResponse(
        plan,
        input.schemas,
        relationshipModel,
        requests
      );

      if (attempt > 1) {
        console.warn('KPI plan accepted after repair attempts', {
          attempts: attempt
        });
      }

      return plan;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) {
        throw error;
      }

      lastError = error;

      console.warn('KPI plan rejected, requesting repair', {
        attempt,
        maxAttempts: MAX_KPI_PLAN_ATTEMPTS,
        statusCode: error.statusCode,
        reason: error.message
      });
    }
  }

  lastError.message = `${lastError.message} (unresolved after ${MAX_KPI_PLAN_ATTEMPTS} attempts)`;

  throw lastError;
}

module.exports = {
  generateKpiPlan
};

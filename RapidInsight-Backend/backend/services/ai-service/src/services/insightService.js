const {
  getAiProvider
} = require('../providers/aiClientFactory');

const {
  buildInsightPrompt,
  buildInsightRepairPrompt
} = require('../prompts/insightPrompt');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  validateInsightResponse
} = require('../validators/insightResponseValidator');

const MAX_INSIGHT_ATTEMPTS = 2;

// Insights are prose, so a rejected response is almost always a shape problem
// rather than a stuck answer. Two attempts is enough; spending a third on
// wording burns rate limit that later steps may need.
const REPAIR_TEMPERATURES = [0.3, 0.5];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // strict insight validation rejected the response
  502  // response was not valid JSON
]);

const DEFAULT_MAX_INSIGHTS = 4;

/**
 * Step 6 of the multi-step generation pipeline.
 *
 * Writes plain-language observations about results that have already been
 * computed. This is the only step with access to real values, so it is the
 * only one that can say anything about what the numbers mean.
 *
 * Returns an empty list rather than throwing when there is nothing to
 * describe: a dashboard with working numbers and no commentary is still a
 * useful dashboard.
 */
async function generateInsights(input) {
  const kpis = Array.isArray(input?.kpis) ? input.kpis : [];
  const charts = Array.isArray(input?.charts) ? input.charts : [];

  const maxInsights =
    Number.isInteger(input?.max_insights) && input.max_insights > 0
      ? input.max_insights
      : DEFAULT_MAX_INSIGHTS;

  if (!kpis.length && !charts.length) {
    console.warn('No results to describe, skipping insight generation.');

    return { insights: [] };
  }

  const basePrompt = buildInsightPrompt({ kpis, charts, maxInsights });
  const provider = getAiProvider();

  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= MAX_INSIGHT_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildInsightRepairPrompt(basePrompt, lastError.message, lastResponse);

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

      validateInsightResponse(parsed, { maxInsights });

      if (attempt > 1) {
        console.warn('Insights accepted after repair attempts', {
          attempts: attempt
        });
      }

      return parsed;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) {
        throw error;
      }

      lastError = error;

      console.warn('Insights rejected, requesting repair', {
        attempt,
        maxAttempts: MAX_INSIGHT_ATTEMPTS,
        statusCode: error.statusCode,
        reason: error.message
      });
    }
  }

  lastError.message = `${lastError.message} (unresolved after ${MAX_INSIGHT_ATTEMPTS} attempts)`;

  throw lastError;
}

module.exports = {
  generateInsights
};

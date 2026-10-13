const {
  getAiProvider
} = require('../providers/aiClientFactory');

const {
  buildRelationshipPrompt,
  buildRelationshipRepairPrompt
} = require('../prompts/relationshipPrompt');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  validateRelationshipResponse
} = require('../validators/relationshipResponseValidator');

const {
  validateSourceSchemas
} = require('../validators/blueprintResponseValidator');

const MAX_RELATIONSHIP_ATTEMPTS = 3;

// At temperature 0 an identical prompt reproduces an identical response, so a
// repair attempt must change the input: it carries the rejected JSON plus the
// reason, and nudges temperature up to escape a stuck answer.
const REPAIR_TEMPERATURES = [0, 0.2, 0.4];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // strict relationship validation rejected the response
  502  // response was not valid JSON
]);

// Step 1 of the multi-step generation pipeline.
//
// Returns only tables and relationships. The caller persists this immediately,
// which is what lets the Schema Playground render a diagram without waiting for
// KPI planning to finish.
async function generateRelationships(input) {
  if (!input || !Array.isArray(input.schemas) || input.schemas.length === 0) {
    const error = new Error('schemas are required to infer relationships.');
    error.statusCode = 400;
    throw error;
  }

  // Problems in the uploaded schemas cannot be repaired by re-prompting, so
  // fail before spending any provider calls on them.
  validateSourceSchemas(input.schemas);

  const basePrompt = buildRelationshipPrompt(input);
  const provider = getAiProvider();

  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= MAX_RELATIONSHIP_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildRelationshipRepairPrompt(basePrompt, lastError.message, lastResponse);

    const rawResult = await provider.generateDataModelBlueprint({
      prompt,
      input,
      temperature:
        REPAIR_TEMPERATURES[attempt - 1] ??
        REPAIR_TEMPERATURES[REPAIR_TEMPERATURES.length - 1]
    });

    lastResponse = rawResult;

    try {
      const relationships =
        typeof rawResult === 'string'
          ? parseStrictJson(rawResult)
          : rawResult;

      validateRelationshipResponse(relationships, input.schemas);

      if (attempt > 1) {
        console.warn('Relationships accepted after repair attempts', {
          attempts: attempt
        });
      }

      return relationships;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) {
        throw error;
      }

      lastError = error;

      console.warn('Relationships rejected, requesting repair', {
        attempt,
        maxAttempts: MAX_RELATIONSHIP_ATTEMPTS,
        statusCode: error.statusCode,
        reason: error.message
      });
    }
  }

  lastError.message = `${lastError.message} (unresolved after ${MAX_RELATIONSHIP_ATTEMPTS} attempts)`;

  throw lastError;
}

module.exports = {
  generateRelationships
};
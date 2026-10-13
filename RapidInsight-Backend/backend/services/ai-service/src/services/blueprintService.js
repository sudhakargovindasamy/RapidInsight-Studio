const {
  getAiProvider
} = require('../providers/aiClientFactory');

const {
  buildDataModelBlueprintPrompt,
  buildBlueprintRepairPrompt
} = require('../prompts/dataModelBlueprintPrompt');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  validateBlueprintResponse,
  validateSourceSchemas
} = require('../validators/blueprintResponseValidator');

const MAX_BLUEPRINT_ATTEMPTS = 3;

// At temperature 0 an identical prompt reproduces an identical response, so a
// repair attempt must change the input: it carries the rejected JSON plus the
// reason, and nudges temperature up to escape a stuck answer.
const REPAIR_TEMPERATURES = [0, 0.2, 0.4];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // strict blueprint validation rejected the response
  502  // response was not valid JSON
]);

async function generateBlueprint(input) {
  if (!input || !Array.isArray(input.schemas) || input.schemas.length === 0) {
    const error = new Error('schemas are required to generate data model blueprint.');
    error.statusCode = 400;
    throw error;
  }

  // Problems in the uploaded schemas cannot be repaired by re-prompting, so
  // fail before spending any provider calls on them.
  validateSourceSchemas(input.schemas);

  const basePrompt = buildDataModelBlueprintPrompt(input);
  const provider = getAiProvider();

  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= MAX_BLUEPRINT_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildBlueprintRepairPrompt(basePrompt, lastError.message, lastResponse);

    const rawResult = await provider.generateDataModelBlueprint({
      prompt,
      input,
      temperature:
        REPAIR_TEMPERATURES[attempt - 1] ??
        REPAIR_TEMPERATURES[REPAIR_TEMPERATURES.length - 1]
    });

    lastResponse = rawResult;

    try {
      const blueprint =
        typeof rawResult === 'string'
          ? parseStrictJson(rawResult)
          : rawResult;

      validateBlueprintResponse(blueprint, input.schemas);

      if (attempt > 1) {
        console.warn('Blueprint accepted after repair attempts', {
          attempts: attempt
        });
      }

      return blueprint;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) {
        throw error;
      }

      lastError = error;

      console.warn('Blueprint rejected, requesting repair', {
        attempt,
        maxAttempts: MAX_BLUEPRINT_ATTEMPTS,
        statusCode: error.statusCode,
        reason: error.message
      });
    }
  }

  lastError.message = `${lastError.message} (unresolved after ${MAX_BLUEPRINT_ATTEMPTS} attempts)`;

  throw lastError;
}

module.exports = {
  generateBlueprint
};

const axios = require('axios');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  callProvider
} = require('./providerRequest');

const DEFAULT_MODEL = 'gemini-3-flash';
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

function sanitizeUpstreamError(error) {
  const data = error.response?.data;

  if (!data) {
    return null;
  }

  return {
    error: data.error
      ? {
        code: data.error.code || null,
        status: data.error.status || null,
        message: data.error.message || null
      }
      : null,
    message:
      typeof data.message === 'string'
        ? data.message
        : null
  };
}

function createGeminiError(error, model, prompt) {
  const upstreamStatus = error.response?.status;
  const statusCode =
    Number.isInteger(upstreamStatus) && upstreamStatus >= 400
      ? upstreamStatus
      : 502;

  const sanitizedUpstream = sanitizeUpstreamError(error);

  const upstreamMessage =
    sanitizedUpstream?.error?.message ||
    sanitizedUpstream?.message ||
    error.message ||
    'Gemini request failed.';

  console.error('Gemini request failed', {
    statusCode,
    model,
    promptCharacters: prompt.length,
    promptBytes: Buffer.byteLength(prompt, 'utf8'),
    upstream: sanitizedUpstream,
    errorCode: error.code || null
  });

  const wrappedError = new Error(
    statusCode === 413
      ? 'Gemini rejected the blueprint request because the request or expected response was too large.'
      : upstreamMessage
  );

  wrappedError.statusCode = statusCode;
  wrappedError.code =
    sanitizedUpstream?.error?.status ||
    (statusCode === 413
      ? 'GEMINI_PAYLOAD_TOO_LARGE'
      : 'GEMINI_REQUEST_FAILED');

  wrappedError.details = {
    provider: 'gemini',
    model,
    upstreamStatus: statusCode,
    promptCharacters: prompt.length,
    promptBytes: Buffer.byteLength(prompt, 'utf8')
  };

  return wrappedError;
}

function getGeminiApiKey() {
  return process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
}

function getGeminiModel() {
  return process.env.AI_MODEL || DEFAULT_MODEL;
}

function getMaxOutputTokens() {
  const configuredValue = Number.parseInt(
    process.env.AI_MAX_OUTPUT_TOKENS,
    10
  );

  if (
    Number.isInteger(configuredValue) &&
    configuredValue >= 1024
  ) {
    return configuredValue;
  }

  return DEFAULT_MAX_OUTPUT_TOKENS;
}

function buildGeminiRequest(prompt, temperature) {
  return {
    generationConfig: {
      // Honoured rather than pinned at 0: seed-row generation deliberately runs
      // hot for variety, and ignoring it here would make switching to Gemini
      // quietly produce repetitive example rows.
      temperature: Number.isFinite(temperature) ? temperature : 0,
      responseMimeType: 'application/json',
      maxOutputTokens: getMaxOutputTokens(),
      // Thinking tokens count against maxOutputTokens on reasoning-capable
      // Gemini models, which can silently truncate the JSON answer. This is
      // structured extraction, not deliberation, so thinking is set to the
      // lowest level. Gemini 3.x rejects the legacy thinkingBudget field
      // (400 INVALID_ARGUMENT) in favor of thinkingLevel.
      thinkingConfig: {
        thinkingLevel: process.env.AI_THINKING_LEVEL || 'low'
      }
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: prompt
          }
        ]
      }
    ]
  };
}

function extractGeminiContent(response) {
  return response?.data?.candidates?.[0]?.content?.parts?.[0]?.text;
}

async function generateDataModelBlueprint({ prompt, temperature, model: modelOverride }) {
  const apiKey = getGeminiApiKey();
  const model = modelOverride || getGeminiModel();

  if (!apiKey) {
    const error = new Error(
      'AI_API_KEY or GEMINI_API_KEY is required for Gemini provider.'
    );

    error.statusCode = 500;
    error.code = 'GEMINI_API_KEY_MISSING';

    throw error;
  }

  if (!prompt || typeof prompt !== 'string') {
    const error = new Error(
      'A non-empty prompt is required for Gemini blueprint generation.'
    );

    error.statusCode = 400;
    error.code = 'GEMINI_PROMPT_REQUIRED';

    throw error;
  }

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const requestBody = buildGeminiRequest(prompt, temperature);

  console.info('Sending blueprint request to Gemini', {
    model,
    promptCharacters: prompt.length,
    promptBytes: Buffer.byteLength(prompt, 'utf8'),
    maxOutputTokens: requestBody.generationConfig.maxOutputTokens
  });

  try {
    /*
     * Queueing and retries (429 and 5xx alike) are handled by callProvider,
     * shared with every other provider. Gemini used to run its own retry loop
     * that never touched the shared queue, so concurrent uploads could still
     * stack requests on top of each other and trip the per-minute limit.
     */
    const response = await callProvider({
      provider: 'Gemini',
      request: () => axios.post(
        endpoint,
        requestBody,
        {
          params: {
            key: apiKey
          },
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: Number.parseInt(
            process.env.AI_REQUEST_TIMEOUT_MS,
            10
          ) || DEFAULT_TIMEOUT_MS,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus(status) {
            return status >= 200 && status < 300;
          }
        }
      )
    });

    const content = extractGeminiContent(response);

    if (!content) {
      const emptyResponseError = new Error(
        'Gemini provider returned an empty response.'
      );

      emptyResponseError.statusCode = 502;
      emptyResponseError.code = 'GEMINI_EMPTY_RESPONSE';

      throw emptyResponseError;
    }

    return parseStrictJson(content);
  } catch (error) {
    // Errors we raised ourselves - including the shared rate-limit error, which
    // carries a statusCode but no HTTP response - already say what went wrong.
    // Only genuine upstream failures need Gemini's richer wrapping.
    if (
      error.statusCode &&
      !error.response &&
      error.code !== 'ECONNABORTED'
    ) {
      throw error;
    }

    throw createGeminiError(
      error,
      model,
      prompt
    );
  }
}

module.exports = {
  generateDataModelBlueprint
};
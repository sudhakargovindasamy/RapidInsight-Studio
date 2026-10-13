const axios = require('axios');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  callProvider
} = require('./providerRequest');

const DEFAULT_MODEL = 'grok-2-latest';
const BASE_URL = 'https://api.x.ai/v1';
const REQUEST_TIMEOUT_MS = 120000;

async function generateDataModelBlueprint({ prompt, temperature, model: modelOverride }) {
  const apiKey = process.env.AI_API_KEY;
  const model = modelOverride || process.env.AI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error('AI_API_KEY is required for Grok provider.');
  }

  const response = await callProvider({
    provider: 'Grok',
    request: () => axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model,
        // See openaiProvider: seed rows need the caller's temperature, not a
        // hardcoded 0, or switching provider silently kills row variety.
        temperature: Number.isFinite(temperature) ? temperature : 0,
        response_format: {
          type: 'json_object'
        },
        messages: [
          {
            role: 'system',
            content: 'You are a strict data modeling assistant. Return only valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    )
  });

  const content = response.data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Grok provider returned empty response.');
  }

  return parseStrictJson(content);
}

module.exports = {
  generateDataModelBlueprint
};

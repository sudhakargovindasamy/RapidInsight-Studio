const axios = require('axios');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  callProvider
} = require('./providerRequest');

const DEFAULT_MODEL = 'claude-sonnet-5';
const BASE_URL = 'https://api.anthropic.com/v1';
const REQUEST_TIMEOUT_MS = 120000;
const MAX_TOKENS = 8000;

async function generateDataModelBlueprint({ prompt, temperature, model: modelOverride }) {
  const apiKey = process.env.AI_API_KEY;
  const model = modelOverride || process.env.AI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error('AI_API_KEY is required for Claude provider.');
  }

  const response = await callProvider({
    provider: 'Claude',
    request: () => axios.post(
      `${BASE_URL}/messages`,
      {
        model,
        max_tokens: MAX_TOKENS,
        // See openaiProvider: the caller's temperature matters for seed rows.
        temperature: Number.isFinite(temperature) ? temperature : 0,
        system: 'You are a strict data modeling assistant. Return only valid JSON. Do not include markdown.',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    )
  });

  const content = response.data?.content?.[0]?.text;

  if (!content) {
    throw new Error('Claude provider returned empty response.');
  }

  return parseStrictJson(content);
}

module.exports = {
  generateDataModelBlueprint
};

const axios = require('axios');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  callProvider
} = require('./providerRequest');

const DEFAULT_MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 120000;

async function generateDataModelBlueprint({ prompt, temperature, model: modelOverride }) {
  const apiKey = process.env.AI_API_KEY;
  const model = modelOverride || process.env.AI_MODEL || DEFAULT_MODEL;
  const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    throw new Error('AI_API_KEY is required for OpenAI provider.');
  }

  const response = await callProvider({
    provider: 'OpenAI',
    request: () => axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        // Honoured rather than pinned at 0: seed-row generation deliberately
        // runs hot for variety, and ignoring that here would make switching
        // provider quietly produce repetitive example rows.
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
    throw new Error('OpenAI provider returned empty response.');
  }

  return parseStrictJson(content);
}

module.exports = {
  generateDataModelBlueprint
};

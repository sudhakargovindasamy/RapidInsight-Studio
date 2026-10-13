const axios = require('axios');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  callProvider
} = require('./providerRequest');

const DEFAULT_MODEL = 'llama-3.1-8b-instant';
const BASE_URL = 'https://api.groq.com/openai/v1';
const REQUEST_TIMEOUT_MS = 120000;

// The optional model override lets one step choose a different model from the
// rest of the pipeline. Seed rows use it: inventing plausible product names is
// the easiest job here and the highest volume, so it runs on a small fast model
// while the reasoning steps stay on the larger one.
async function generateDataModelBlueprint({ prompt, temperature, model: modelOverride }) {
  const apiKey = process.env.AI_API_KEY;
  const model = modelOverride || process.env.AI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    throw new Error('AI_API_KEY is required for Groq provider.');
  }

  // Queueing and retries are handled by callProvider, shared with every other
  // provider so switching AI_PROVIDER cannot change how failures are handled.
  const response = await callProvider({
    provider: 'Groq',
    request: () => axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model,
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
    throw new Error('Groq provider returned empty response.');
  }

  return parseStrictJson(content);
}

module.exports = {
  generateDataModelBlueprint
};

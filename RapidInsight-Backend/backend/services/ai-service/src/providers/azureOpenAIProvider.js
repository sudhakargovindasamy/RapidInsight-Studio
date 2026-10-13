const axios = require('axios');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  callProvider
} = require('./providerRequest');

const DEFAULT_API_VERSION = '2024-08-01-preview';
const REQUEST_TIMEOUT_MS = 120000;

/*
 * Azure OpenAI is not a drop-in for the OpenAI provider: the model is chosen
 * by deployment name baked into the URL (not a "model" body field), auth is
 * an `api-key` header rather than `Authorization: Bearer`, and every call
 * needs an `api-version` query param. Routing Azure through openaiProvider
 * would silently 401/404 - this is its own provider on purpose.
 */
async function generateDataModelBlueprint({ prompt, temperature, model: modelOverride }) {
  const apiKey = process.env.AI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const deployment = modelOverride || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.AI_MODEL;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_API_VERSION;

  if (!apiKey) {
    throw new Error('AI_API_KEY is required for Azure OpenAI provider.');
  }

  if (!endpoint) {
    throw new Error('AZURE_OPENAI_ENDPOINT is required for Azure OpenAI provider (e.g. https://your-resource.openai.azure.com).');
  }

  if (!deployment) {
    throw new Error('AZURE_OPENAI_DEPLOYMENT (or AI_MODEL) is required for Azure OpenAI provider - it must match a deployment name in your Azure resource, not a raw model name.');
  }

  const baseUrl = endpoint.replace(/\/+$/, '');

  const response = await callProvider({
    provider: 'Azure OpenAI',
    request: () => axios.post(
      `${baseUrl}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
      {
        // See openaiProvider: the caller's temperature matters for seed rows.
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
          'api-key': apiKey,
          'Content-Type': 'application/json'
        },
        timeout: REQUEST_TIMEOUT_MS
      }
    )
  });

  const content = response.data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Azure OpenAI provider returned empty response.');
  }

  return parseStrictJson(content);
}

module.exports = {
  generateDataModelBlueprint
};

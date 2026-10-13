const axios = require('axios');

const env = require('../config/env');

/*
 * Calls ai-service to write example rows for one schema.
 *
 * The timeout is generous because this is the slowest call in the pipeline: the
 * work is several batched provider calls with a deliberate pause between them.
 * It runs in the background after the upload response has already been sent, so
 * nothing is waiting on it.
 */
const SEED_REQUEST_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.SEED_REQUEST_TIMEOUT_MS, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
})();

async function requestSeedRows({ schemaId, tableName, schemaDefinition, rowCount, userId, userEmail }) {
  const response = await axios.post(
    `${env.AI_SERVICE_URL.replace(/\/+$/, '')}/ai/seed-rows`,
    {
      rowCount,
      schema: {
        schema_id: schemaId,
        sanitized_table_name: tableName,
        schemaDefinition
      }
    },
    {
      headers: {
        'x-internal-service-key': env.INTERNAL_SERVICE_KEY,
        'x-user-id': userId,
        'x-user-email': userEmail || '',
        'Content-Type': 'application/json'
      },
      timeout: SEED_REQUEST_TIMEOUT_MS
    }
  );

  const data = response.data?.data;

  if (!data || !Array.isArray(data.rows)) {
    throw new Error('ai-service returned no seed rows.');
  }

  return data;
}

module.exports = {
  requestSeedRows
};
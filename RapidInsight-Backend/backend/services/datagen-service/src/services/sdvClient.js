const axios = require('axios');
const crypto = require('crypto');

/*
 * Talks to sdv-service.
 *
 * There is no fallback generator behind this. Faker was removed deliberately,
 * so if SDV cannot produce rows the run fails - loudly, with a message that says
 * what to do. The alternative was keeping a silent fallback that produces
 * uncorrelated data looking superficially fine, which is the failure mode this
 * whole migration exists to remove.
 */

const SDV_SERVICE_URL = process.env.SDV_SERVICE_URL || 'http://localhost:3008';

/*
 * A cold request trains a model. Phase 1 measured TVAE at 37s for a small table
 * and 95s for a wider one, so the timeout has to clear that with room to spare.
 * A warm request returns in about a second.
 */
const SDV_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.SDV_TIMEOUT_MS, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
})();

/*
 * The cache key decides when a model is reused.
 *
 * Computed here rather than in sdv-service because this is the side that knows
 * what "unchanged" means: the same columns, the same seed rows, the same
 * constraints. Change any of them and the old model no longer describes the
 * data, so the key changes and it retrains.
 */
function buildCacheKey({ schemaId, sdvColumns, seedRows, constraints, synthesizer }) {
  const material = JSON.stringify({
    schemaId,
    columns: sdvColumns,
    constraints,
    synthesizer,
    seedRows
  });

  return crypto.createHash('sha256').update(material).digest('hex');
}

function describeFailure(error) {
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return (
      `Could not reach sdv-service at ${SDV_SERVICE_URL}. ` +
      `Data generation needs it running - start it with ` +
      `"python -m uvicorn app.main:app --port 3008" in backend/services/sdv-service.`
    );
  }

  if (error.code === 'ECONNABORTED') {
    return (
      `sdv-service did not respond within ${Math.round(SDV_TIMEOUT_MS / 1000)}s. ` +
      `Training a model on a large table can take a few minutes; raise ` +
      `SDV_TIMEOUT_MS if this keeps happening.`
    );
  }

  const detail = error.response?.data?.detail || error.response?.data?.message;

  if (detail) return `sdv-service rejected the request: ${detail}`;

  return `sdv-service failed: ${error.message}`;
}

async function generateRows({
  schemaId,
  tableName,
  sdvColumns,
  seedRows,
  numRows,
  constraints = [],
  synthesizer,
  randomSeed
}) {
  const cacheKey = buildCacheKey({
    schemaId,
    sdvColumns,
    seedRows,
    constraints,
    synthesizer
  });

  const payload = {
    cache_key: cacheKey,
    table_name: tableName,
    columns: sdvColumns,
    seed_rows: seedRows,
    num_rows: numRows,
    constraints,
    random_seed: randomSeed
  };

  if (synthesizer) payload.synthesizer = synthesizer;

  try {
    const response = await axios.post(
      `${SDV_SERVICE_URL.replace(/\/+$/, '')}/sdv/generate`,
      payload,
      {
        headers: {
          'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY,
          'x-user-id': 'datagen-service',
          'Content-Type': 'application/json'
        },
        timeout: SDV_TIMEOUT_MS
      }
    );

    const data = response.data;

    if (!data || !Array.isArray(data.rows)) {
      throw new Error('sdv-service returned no rows.');
    }

    return {
      rows: data.rows,
      quality: data.quality || {},
      model: data.model || {},
      warnings: data.warnings || []
    };
  } catch (error) {
    const failure = new Error(describeFailure(error));

    failure.statusCode = error.response?.status === 422 ? 422 : 502;
    failure.code = 'SDV_GENERATION_FAILED';
    failure.cause = error;

    throw failure;
  }
}

async function checkHealth() {
  try {
    const response = await axios.get(
      `${SDV_SERVICE_URL.replace(/\/+$/, '')}/health`,
      { timeout: 5000 }
    );

    return { reachable: true, ...response.data };
  } catch (error) {
    return { reachable: false, message: describeFailure(error) };
  }
}

module.exports = {
  generateRows,
  checkHealth,
  buildCacheKey,
  SDV_SERVICE_URL
};
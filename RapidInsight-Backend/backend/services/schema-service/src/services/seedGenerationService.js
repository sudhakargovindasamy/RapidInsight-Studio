const crypto = require('crypto');

const env = require('../config/env');
const logger = require('../config/logger');

const {
  createSupabaseAdminClient
} = require('../config/supabase');

const {
  requestSeedRows
} = require('./seedRowsClient');

/*
 * Example rows for SDV, generated when a schema is uploaded.
 *
 * Why here and not at Generate Tables: writing example rows takes 30-60 seconds
 * per table. A ten-table project would spend ten minutes inside one button
 * click and time out. Uploads happen one at a time, minutes or days apart, so
 * the cost never bunches up - and by the time the user clicks Generate Tables
 * the rows are already in storage.
 *
 * Only schemas uploaded with "Generate mock data" get seeds. A schema uploaded
 * with "Use my data" already has real rows and is marked not_required.
 */

// Enough for TVAE to learn the shape of a correlation and roughly its
// magnitude. Phase 1 measured fidelity improving from 120 rows to 400; 200 is
// the point where the curve flattens against the provider cost of more batches.
const DEFAULT_SEED_ROW_COUNT = 200;

/*
 * How long a schema may sit in "generating" before we stop believing it.
 *
 * Generation only lives in the memory of the process that started it. If that
 * process restarts - a crash, a redeploy, a dev-server reload - the job dies
 * with it, but the database row still says "generating" and nothing is left to
 * ever change it. The UI then waits on a job that no longer exists.
 *
 * Comfortably above SEED_REQUEST_TIMEOUT_MS (300s), so a job that is merely slow
 * is never mistaken for a dead one.
 */
const STALE_GENERATING_AFTER_MS = (() => {
  const parsed = Number.parseInt(process.env.SEED_STALE_AFTER_MS, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 420000;
})();

function isStaleGenerating(schema) {
  if (schema?.seed_status !== 'generating') return false;

  const startedAt = Date.parse(
    schema.seed_started_at || schema.updated_at || schema.created_at || ''
  );

  if (!Number.isFinite(startedAt)) return true;

  return Date.now() - startedAt > STALE_GENERATING_AFTER_MS;
}

function fingerprintSchemaDefinition(schemaDefinition) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(schemaDefinition))
    .digest('hex');
}

function buildSeedStoragePath({ userId, projectId, schemaId }) {
  return `${userId}/${projectId}/${schemaId}/seed.json`;
}

async function updateSeedStatus({ supabase, schemaId, patch }) {
  const { error } = await supabase
    .from('schemas')
    .update(patch)
    .eq('id', schemaId);

  if (error) {
    // The status row is only a progress record. Failing to write it must not
    // take down the generation that is otherwise succeeding.
    logger.error(
      { err: error, schemaId, patch },
      'Failed to update seed status'
    );
  }
}

async function uploadSeedRows({ supabase, bucket, path, payload }) {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, JSON.stringify(payload), {
      contentType: 'application/json',
      upsert: true
    });

  if (error) throw error;

  return { bucket, path };
}

/*
 * Generate and store seed rows for one schema.
 *
 * Uses the admin client rather than the caller's token: this runs after the
 * upload response has been sent, and the request's access token is not
 * guaranteed to still be valid by the time the provider calls finish.
 */
async function generateAndStoreSeedRows({
  schemaId,
  projectId,
  userId,
  userEmail,
  tableName,
  schemaDefinition,
  rowCount = DEFAULT_SEED_ROW_COUNT
}) {
  const supabase = createSupabaseAdminClient();
  const bucket = env.SCHEMA_STORAGE_BUCKET;

  await updateSeedStatus({
    supabase,
    schemaId,
    // The timestamp is what makes a dead job detectable later - without it a
    // "generating" row is indistinguishable from one abandoned by a restart.
    patch: {
      seed_status: 'generating',
      seed_error: null,
      seed_started_at: new Date().toISOString()
    }
  });

  try {
    const result = await requestSeedRows({
      schemaId,
      tableName,
      schemaDefinition,
      rowCount,
      userId,
      userEmail
    });

    const path = buildSeedStoragePath({ userId, projectId, schemaId });

    await uploadSeedRows({
      supabase,
      bucket,
      path,
      payload: {
        schema_id: schemaId,
        table_name: result.table_name,
        columns: result.columns,
        rows: result.rows,
        stats: result.stats,
        generated_at: new Date().toISOString()
      }
    });

    await updateSeedStatus({
      supabase,
      schemaId,
      patch: {
        seed_status: 'ready',
        seed_storage_path: path,
        seed_row_count: result.rows.length,
        seed_fingerprint: fingerprintSchemaDefinition(schemaDefinition),
        seed_generated_at: new Date().toISOString(),
        seed_error: null
      }
    });

    logger.info(
      {
        schemaId,
        rows: result.rows.length,
        stats: result.stats
      },
      'Seed rows generated'
    );

    return { status: 'ready', rows: result.rows.length, path };
  } catch (error) {
    const message =
      error.response?.data?.message ||
      error.message ||
      'Seed row generation failed.';

    /*
     * A failure here is recoverable and must not block the project. The schema
     * is marked failed with the reason, the user can retry that one schema, and
     * every other schema in the project is unaffected.
     */
    await updateSeedStatus({
      supabase,
      schemaId,
      patch: {
        seed_status: 'failed',
        seed_error: message.slice(0, 500)
      }
    });

    logger.error({ err: error, schemaId }, 'Seed row generation failed');

    return { status: 'failed', error: message };
  }
}

/*
 * Kick generation off without waiting for it.
 *
 * The upload response has already been sent by the time this runs. Any error is
 * recorded on the schema row, so nothing is lost by not awaiting - but the
 * promise still needs a catch, or a rejection here would be an unhandled
 * rejection and could take the process down.
 */
function startSeedGeneration(input) {
  setImmediate(() => {
    generateAndStoreSeedRows(input).catch((error) => {
      logger.error(
        { err: error, schemaId: input.schemaId },
        'Unhandled error in background seed generation'
      );
    });
  });
}

function shouldGenerateSeeds(dataSource) {
  return dataSource !== 'uploaded';
}

module.exports = {
  generateAndStoreSeedRows,
  startSeedGeneration,
  shouldGenerateSeeds,
  isStaleGenerating,
  STALE_GENERATING_AFTER_MS,
  fingerprintSchemaDefinition,
  buildSeedStoragePath,
  DEFAULT_SEED_ROW_COUNT
};
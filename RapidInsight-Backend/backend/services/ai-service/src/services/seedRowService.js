const {
  getAiProvider
} = require("../providers/aiClientFactory");

const {
  buildSeedRowsPrompt,
  buildSeedRowsRepairPrompt,
  getRequestedFields
} = require("../prompts/seedRowsPrompt");

const {
  parseStrictJson
} = require("../utils/safeJsonParser");

const {
  validateSeedRowsResponse
} = require("../validators/seedRowsResponseValidator");

const {
  resolveTableName
} = require("../prompts/schemaCompaction");

const MAX_BATCH_ATTEMPTS = 3;

// Variety is the point of this call, so it starts hot rather than at 0. A repair
// attempt drops the temperature instead of raising it: the earlier answer was
// rejected for being malformed, and the fix is more compliance, not more
// creativity. This is the opposite of the blueprint prompts, where the model is
// being asked to reason rather than invent.
const BATCH_TEMPERATURES = [0.9, 0.6, 0.35];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // the batch was structurally unusable
  502 // the response was not valid JSON
]);

// A batch much larger than this stops being reliable: the model starts repeating
// rows partway through, and long responses risk being truncated by the output
// limit before the JSON closes.
const MAX_ROWS_PER_BATCH = 50;
const MAX_BATCHES = 8;

// Below this, a copula fits noise instead of structure. Matches
// SDV_MIN_SEED_ROWS in sdv-service - the two need to agree or we generate seeds
// that the next service refuses.
// Configurable for the same reason as MAX_ROW_LOSS_RATIO below: a model being
// evaluated should be allowed to produce a poor result that can be looked at,
// rather than failing the table and leaving nothing to inspect.
const MIN_USABLE_ROWS = (() => {
  const parsed = Number.parseInt(process.env.SEED_MIN_USABLE_ROWS, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
})();

/*
 * If a batch loses more than this share of its rows, it is retried rather than
 * accepted. A short batch is usually a weak model failing to follow "return
 * exactly N rows" rather than a data problem, and retrying normally fixes it.
 *
 * Configurable so a run can be allowed through for inspection. Raising it near 1
 * accepts almost anything, which is how you see what a model actually produces
 * instead of only seeing that it was rejected - useful when comparing models.
 * Leave it at the default for real use: accepting short batches means fitting
 * SDV on less data than the table deserves.
 */
const MAX_ROW_LOSS_RATIO = (() => {
  const parsed = Number.parseFloat(process.env.SEED_MAX_ROW_LOSS_RATIO);

  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : 0.5;
})();

/*
 * Model used for seed rows only, falling back to the pipeline default.
 *
 * This is the highest-volume step - several calls per uploaded schema - and the
 * least demanding: writing a plausible product name needs far less of a model
 * than inferring relationships or planning metrics. Running it on a small fast
 * model keeps uploads quick and leaves the larger model's rate limit budget for
 * the reasoning steps that actually need it.
 *
 * Bad rows are dropped and retried by design, so a slightly sloppier model costs
 * a few discarded rows rather than correctness.
 */
const SEED_MODEL = process.env.SEED_AI_MODEL || null;

const BATCH_DELAY_MS = (() => {
  const parsed = Number.parseInt(process.env.SEED_BATCH_DELAY_MS, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1500;
})();

async function pauseBetweenBatches() {
  if (BATCH_DELAY_MS <= 0) return;

  await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
}

/*
 * How many example rows a table is worth.
 *
 * Measured in phase 1: TVAE reproduces the shape of a correlation from ~120
 * rows but compresses its magnitude, and sharpens as rows increase (a value
 * whose true mean was 200 came back at 162 from 120 rows and at 204 from 400).
 * So more is better, but each batch is a provider call, and a table that only
 * needs 10 rows gains nothing from a model fitted on 300.
 */
function resolveTargetRowCount(requested) {
  const parsed = Number(requested);

  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.max(Math.floor(parsed), MIN_USABLE_ROWS), MAX_ROWS_PER_BATCH * MAX_BATCHES);
  }

  return 200;
}

function planBatches(targetRows) {
  const batches = Math.min(Math.ceil(targetRows / MAX_ROWS_PER_BATCH), MAX_BATCHES);
  const rowsPerBatch = Math.min(Math.ceil(targetRows / batches), MAX_ROWS_PER_BATCH);

  return { batches, rowsPerBatch };
}

/*
 * Rows are deduplicated on their full contents.
 *
 * The failure this guards against is not a model returning literally the same
 * row twice - it is the same row arriving from two different batches, which is
 * exactly what happens when the segment instructions fail to pull the model
 * apart. Duplicates would teach SDV that a value is more common than it is.
 */
function buildRowKey(row, fields) {
  return fields
    .map((field) => {
      const value = row[field.name];

      return value === null || value === undefined ? "" : String(value).trim().toLowerCase();
    })
    .join("");
}

async function runBatch({
  provider,
  schema,
  fields,
  rowsPerBatch,
  batchIndex,
  totalBatches
}) {
  const basePrompt = buildSeedRowsPrompt({
    schema,
    rowsPerBatch,
    batchIndex,
    totalBatches
  });

  let lastError;

  for (let attempt = 1; attempt <= MAX_BATCH_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildSeedRowsRepairPrompt(basePrompt, lastError.message);

    let rawResult;

    try {
      rawResult = await provider.generateDataModelBlueprint({
        prompt,
        input: { schema },
        model: SEED_MODEL,
        temperature:
          BATCH_TEMPERATURES[attempt - 1] ??
          BATCH_TEMPERATURES[BATCH_TEMPERATURES.length - 1]
      });
    } catch (error) {
      // A rate limit or a network failure is not something a differently worded
      // prompt fixes, so it ends the batch immediately.
      if (error.statusCode === 429) throw error;

      lastError = error;

      console.warn("Seed batch provider call failed", {
        batch: batchIndex + 1,
        attempt,
        reason: error.message
      });

      continue;
    }

    try {
      const parsed =
        typeof rawResult === "string" ? parseStrictJson(rawResult) : rawResult;

      const { rows, problems } = validateSeedRowsResponse(parsed, fields);

      const lossRatio = 1 - rows.length / rowsPerBatch;

      if (rows.length === 0 || lossRatio > MAX_ROW_LOSS_RATIO) {
        const error = new Error(
          `Only ${rows.length} of ${rowsPerBatch} rows were valid. Problems: ${problems
            .slice(0, 5)
            .join(" | ")}`
        );
        error.statusCode = 422;
        throw error;
      }

      if (problems.length) {
        console.warn("Seed batch accepted with some rows dropped", {
          batch: batchIndex + 1,
          kept: rows.length,
          dropped: problems.length,
          firstProblem: problems[0]
        });
      }

      return rows;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) throw error;

      lastError = error;

      console.warn("Seed batch rejected, requesting repair", {
        batch: batchIndex + 1,
        attempt,
        maxAttempts: MAX_BATCH_ATTEMPTS,
        reason: error.message
      });
    }
  }

  // One failed batch does not sink the whole table - the remaining batches may
  // still produce enough rows to fit a model. The caller checks the total.
  console.error("Seed batch failed after all attempts", {
    batch: batchIndex + 1,
    reason: lastError?.message
  });

  return [];
}

/*
 * Generate example rows for one table.
 *
 * Returns the rows plus the statistics needed to explain what happened - how
 * many batches ran, how many rows each contributed, how many duplicates were
 * removed. When seed quality is later blamed for bad synthetic data, this is
 * what makes the cause visible.
 */
async function generateSeedRows(input) {
  const schema = input?.schema;

  if (!schema) {
    const error = new Error("schema is required to generate seed rows.");
    error.statusCode = 400;
    throw error;
  }

  const fields = getRequestedFields(schema);

  if (!fields.length) {
    // A pure join table - keys and foreign keys only. Both are assigned by our
    // own code at Generate Tables, so there is no distribution for SDV to learn
    // and nothing for the model to write. Not an error: the table is fine, it
    // simply needs no seeds.
    const error = new Error(
      "Schema has no generatable columns. A table of only primary and foreign keys has nothing to learn from."
    );
    error.statusCode = 422;
    error.code = "NO_GENERATABLE_COLUMNS";
    throw error;
  }

  const tableName = resolveTableName(schema);
  const targetRows = resolveTargetRowCount(input.rowCount);
  const { batches, rowsPerBatch } = planBatches(targetRows);

  const provider = getAiProvider();

  const rows = [];
  const seen = new Set();

  let duplicatesDropped = 0;
  const batchSizes = [];

  console.info("Generating seed rows", {
    table: tableName,
    targetRows,
    batches,
    rowsPerBatch,
    columns: fields.length,
    model: SEED_MODEL || process.env.AI_MODEL || "(provider default)"
  });

  for (let batchIndex = 0; batchIndex < batches; batchIndex += 1) {
    if (batchIndex > 0) await pauseBetweenBatches();

    const batchRows = await runBatch({
      provider,
      schema,
      fields,
      rowsPerBatch,
      batchIndex,
      totalBatches: batches
    });

    let kept = 0;

    batchRows.forEach((row) => {
      const key = buildRowKey(row, fields);

      if (seen.has(key)) {
        duplicatesDropped += 1;
        return;
      }

      seen.add(key);
      rows.push(row);
      kept += 1;
    });

    batchSizes.push(kept);
  }

  if (rows.length < MIN_USABLE_ROWS) {
    const error = new Error(
      `Only ${rows.length} usable seed rows were generated for "${tableName}", below the minimum of ${MIN_USABLE_ROWS}. A model fitted on this many rows reproduces noise rather than structure.`
    );
    error.statusCode = 422;
    error.code = "INSUFFICIENT_SEED_ROWS";
    throw error;
  }

  const shortfall = targetRows - rows.length;

  console.info("Seed rows complete", {
    table: tableName,
    model: SEED_MODEL || process.env.AI_MODEL || "(provider default)",
    generated: rows.length,
    target: targetRows,
    shortfallPercent: Math.round((shortfall / targetRows) * 100),
    duplicatesDropped,
    batchSizes
  });

  // Called out separately because it is the number that matters when judging a
  // model: it finished, but on far less data than the table was meant to get.
  if (shortfall > 0) {
    console.warn(
      `Seed rows for "${tableName}" finished ${shortfall} rows short of ${targetRows} ` +
        `(${rows.length} generated). SDV will be fitted on less data than intended.`
    );
  }

  return {
    table_name: tableName,
    schema_id: schema.schema_id || schema.id || null,
    columns: fields.map((field) => field.name),
    rows,
    stats: {
      target_rows: targetRows,
      generated_rows: rows.length,
      batches,
      rows_per_batch: rowsPerBatch,
      batch_sizes: batchSizes,
      duplicates_dropped: duplicatesDropped
    }
  };
}

module.exports = {
  generateSeedRows,
  resolveTargetRowCount,
  planBatches,
  MIN_USABLE_ROWS
};
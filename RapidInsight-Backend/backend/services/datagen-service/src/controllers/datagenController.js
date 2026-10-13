const {
  normalizeRowCount,
  PREVIEW_ROW_COUNT
} = require('../utils/generationLimits');

const { generateRows } = require('../services/rowGeneratorService');

const {
  generateRelationalRows
} = require('../services/relationalRowGeneratorService');

const { checkHealth } = require('../services/sdvClient');

async function generatePreview(req, res, next) {
  try {
    const { schemaDefinition, seedRows = [], schemaId, tableName } = req.body;

    const rows = await generateRows({
      schemaDefinition,
      rowCount: PREVIEW_ROW_COUNT,
      seedRows,
      schemaId,
      tableName: tableName || 'preview'
    });

    res.json({
      success: true,
      rows_generated: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

async function generateData(req, res, next) {
  try {
    const {
      schemaDefinition,
      seedRows = [],
      schemaId,
      tableName,
      randomSeed,
      synthesizer
    } = req.body;

    const rowCount = normalizeRowCount(req.body.rowCount || req.body.rows);

    const rows = await generateRows({
      schemaDefinition,
      rowCount,
      seedRows,
      schemaId,
      tableName: tableName || 'table',
      randomSeed,
      synthesizer
    });

    res.json({
      success: true,
      rows_generated: rows.length,
      data: rows
    });
  } catch (error) {
    next(error);
  }
}

async function generateRelationalData(req, res, next) {
  try {
    const rowCount = normalizeRowCount(req.body.rowCount || req.body.rows);

    const {
      blueprint,
      schemas,
      // Keyed by schema_id. Produced at schema-upload time and passed through by
      // table-service; without them SDV has nothing to learn from.
      seedRows = {},
      randomSeed,
      synthesizer
    } = req.body;

    const result = await generateRelationalRows({
      blueprint,
      schemas,
      rowCount,
      seedRows,
      randomSeed,
      synthesizer
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
}

/*
 * Reports whether the SDV sidecar is reachable.
 *
 * Faker was removed deliberately, so there is no fallback generator: if this
 * says unreachable, data generation will fail. Exposing it separately means the
 * cause can be seen before a user clicks Generate Tables and waits.
 */
async function sdvStatus(req, res, next) {
  try {
    const health = await checkHealth();

    res.status(health.reachable ? 200 : 503).json({
      success: health.reachable,
      data: health
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  generatePreview,
  generateData,
  generateRelationalData,
  sdvStatus
};
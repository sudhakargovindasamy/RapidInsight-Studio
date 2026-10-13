const { validateSchemaDefinition } = require('./schemaFetcherService');
const { routeColumns, applyDerivedDates } = require('./columnRoutingService');
const { generateRows: generateSdvRows } = require('./sdvClient');

const {
  generatePrimaryKey,
  createUniqueTracker
} = require('./keyGeneratorService');

const { createRandom, seedFromString } = require('../utils/seededRandom');

/*
 * Single-table generation, for preview and for the standalone generate endpoint.
 *
 * Same routing as the relational path, minus foreign keys - there are no parent
 * tables here. Seed rows are required for the same reason: SDV has nothing to
 * learn from without them.
 */

function buildVocabularies(vocabularyColumns, seedRows) {
  const vocabularies = new Map();

  vocabularyColumns.forEach(({ name }) => {
    vocabularies.set(
      name,
      seedRows
        .map((row) => row[name])
        .filter((value) => value !== null && value !== undefined && value !== '')
    );
  });

  return vocabularies;
}

async function generateRows({
  schemaDefinition,
  rowCount,
  seedRows = [],
  schemaId = null,
  tableName = 'preview',
  randomSeed,
  synthesizer
}) {
  const fields = validateSchemaDefinition(schemaDefinition);

  const routing = routeColumns({
    fields,
    tableName,
    seedRows
  });

  if (routing.sdvColumns.length && !seedRows.length) {
    const error = new Error(
      'Seed rows are required to generate data. They are created when a schema is uploaded with "Generate mock data".'
    );
    error.statusCode = 422;
    error.code = 'MISSING_SEED_ROWS';
    throw error;
  }

  const seed = Number.isFinite(Number(randomSeed))
    ? Number(randomSeed)
    : seedFromString(tableName);

  const random = createRandom(seed);
  const uniqueTracker = createUniqueTracker();

  let attributeRows;

  if (!routing.sdvColumns.length) {
    attributeRows = Array.from({ length: rowCount }, () => ({}));
  } else if (rowCount <= seedRows.length) {
    // Nothing to gain from training a model to produce fewer rows than we were
    // already given.
    attributeRows = random.shuffle(seedRows).slice(0, rowCount);
  } else {
    const result = await generateSdvRows({
      schemaId,
      tableName,
      sdvColumns: routing.sdvColumns,
      seedRows,
      numRows: rowCount,
      constraints: routing.constraints,
      synthesizer,
      randomSeed: seed
    });

    // Later dates are derived from their earlier partner rather than modelled,
    // so the ordering holds by construction.
    attributeRows = applyDerivedDates({
      rows: result.rows,
      datePairs: routing.datePairs,
      random
    });
  }

  const vocabularies = buildVocabularies(routing.vocabularyColumns, seedRows);

  const rows = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = {};

    routing.sdvColumns.forEach((column) => {
      row[column.name] = attributeRows[index]?.[column.name] ?? null;
    });

    routing.datePairs.forEach((pair) => {
      row[pair.to] = attributeRows[index]?.[pair.to] ?? null;
    });

    routing.keyColumns.forEach(({ name, field }) => {
      row[name] = generatePrimaryKey({
        columnName: name,
        field,
        strategy: field.faker,
        index
      });
    });

    routing.vocabularyColumns.forEach(({ name, field, unique }) => {
      const pool = vocabularies.get(name) || [];

      let value = pool.length ? random.pick(pool) : `${name}_${index + 1}`;

      if (unique) {
        value = uniqueTracker.reserve({
          tableName,
          columnName: name,
          value,
          field
        });
      }

      row[name] = value;
    });

    rows.push(row);
  }

  return rows;
}

module.exports = {
  generateRows
};
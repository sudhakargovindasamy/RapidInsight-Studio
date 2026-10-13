const { validateSchemaDefinition } = require('./schemaFetcherService');
const {
  routeColumns,
  normalizeColumnName,
  applyDerivedDates
} = require('./columnRoutingService');
const { generateRows: generateSdvRows } = require('./sdvClient');

const {
  generatePrimaryKey,
  createKeyRegistry,
  pickForeignKey,
  createUniqueTracker
} = require('./keyGeneratorService');

const {
  createRandom,
  seedFromString
} = require('../utils/seededRandom');

/*
 * Builds a set of related tables.
 *
 * The shape of this file is unchanged: tables are still built parents-first,
 * primary keys are still counters, foreign keys are still drawn from the parent
 * ids we just produced, and uniqueness is still reserved per column. What
 * changed is where ordinary column values come from - SDV instead of Faker - so
 * that the columns in a row agree with each other.
 */

const MAX_ROWS_PER_TABLE = 10000;

function normalizeTableName(name) {
  return normalizeColumnName(name);
}

function getSchemaId(schema) {
  return schema.schema_id || schema.schemaId || schema.id;
}

function buildSchemaMap(schemas) {
  const map = new Map();

  schemas.forEach((schema) => {
    const schemaId = getSchemaId(schema);

    if (schemaId) map.set(schemaId, { ...schema, schema_id: schemaId });
  });

  return map;
}

function buildRelationshipMap(relationships = []) {
  const map = new Map();

  relationships.forEach((relationship) => {
    const fromTable = normalizeTableName(relationship.from_table);
    const fromColumn = normalizeColumnName(relationship.from_column);

    map.set(`${fromTable}.${fromColumn}`, {
      from_table: fromTable,
      from_column: fromColumn,
      to_table: normalizeTableName(relationship.to_table),
      to_column: normalizeColumnName(relationship.to_column)
    });
  });

  return map;
}

function buildBlueprintTableMap(blueprint) {
  const map = new Map();

  (blueprint.tables || []).forEach((table) => {
    map.set(normalizeTableName(table.table_name), table);
  });

  return map;
}

function getGenerationRule(tableName, blueprint) {
  return (
    (blueprint.data_generation_rules || []).find(
      (rule) => normalizeTableName(rule.table_name) === normalizeTableName(tableName)
    ) || null
  );
}

function resolveRowCountForTable({ table, blueprint, defaultRowCount }) {
  const rule = getGenerationRule(table.table_name, blueprint);

  const configured = Number(
    table.row_count || table.generation?.row_count || rule?.row_count
  );

  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.floor(configured), MAX_ROWS_PER_TABLE);
  }

  if (table.table_type === 'fact' || table.table_type === 'bridge') {
    return Math.min(Math.max(defaultRowCount, 100), MAX_ROWS_PER_TABLE);
  }

  return Math.min(Math.max(Math.floor(defaultRowCount / 2), 25), MAX_ROWS_PER_TABLE);
}

function resolveDependencyOrder(blueprint) {
  const declared = Array.isArray(blueprint.dependency_order)
    ? blueprint.dependency_order.map(normalizeTableName)
    : [];

  const tableNames = (blueprint.tables || []).map((table) =>
    normalizeTableName(table.table_name)
  );

  const ordered = [];

  declared.forEach((tableName) => {
    if (tableNames.includes(tableName) && !ordered.includes(tableName)) {
      ordered.push(tableName);
    }
  });

  tableNames.forEach((tableName) => {
    if (!ordered.includes(tableName)) ordered.push(tableName);
  });

  return ordered;
}

function getSeedRowsForSchema(seedRowsBySchemaId, schemaId) {
  const entry = seedRowsBySchemaId?.[schemaId];

  if (!entry) return [];
  if (Array.isArray(entry)) return entry;
  if (Array.isArray(entry.rows)) return entry.rows;

  return [];
}

/*
 * Normalises seed row keys to the same form as the schema's column names.
 *
 * Seed rows come from an LLM. It is asked for exact column names and usually
 * complies, but a stray "Order Date" against an order_date column would
 * otherwise silently become a column of nulls.
 */
function normalizeSeedRows(seedRows) {
  return seedRows.map((row) => {
    const clean = {};

    Object.entries(row).forEach(([key, value]) => {
      clean[normalizeColumnName(key)] = value;
    });

    return clean;
  });
}

/*
 * Builds a value pool per column from the seed rows.
 *
 * Used for columns SDV does not own: free text and unique columns. Sampling real
 * seed values keeps names looking like names, which SDV cannot do for a column
 * with hundreds of distinct values.
 */
function buildVocabularies(vocabularyColumns, seedRows) {
  const vocabularies = new Map();

  vocabularyColumns.forEach(({ name }) => {
    const values = seedRows
      .map((row) => row[name])
      .filter((value) => value !== null && value !== undefined && value !== '');

    vocabularies.set(name, values);
  });

  return vocabularies;
}

function fallbackVocabularyValue({ columnName, field, index }) {
  const type = String(field?.type || 'string').toLowerCase();

  if (type === 'email') return `user${index + 1}@example.com`;
  if (type === 'number') return index + 1;

  return `${columnName}_${index + 1}`;
}

/*
 * Generates the SDV-owned columns for one table.
 *
 * When the table needs no more rows than the seed provides, the seed rows are
 * used directly. Fitting a model to sample ten rows is slower than taking ten
 * good ones, and worse - the model can only blur what it was shown.
 */
async function generateAttributeRows({
  schemaId,
  tableName,
  routing,
  seedRows,
  rowCount,
  random,
  randomSeed,
  synthesizer
}) {
  if (!routing.sdvColumns.length) {
    return { rows: Array.from({ length: rowCount }, () => ({})), meta: null };
  }

  if (rowCount <= seedRows.length) {
    const chosen = random.shuffle(seedRows).slice(0, rowCount);

    return {
      rows: chosen.map((row) => {
        const picked = {};

        routing.sdvColumns.forEach((column) => {
          picked[column.name] = row[column.name] ?? null;
        });

        // Seed rows already carry the real later date, so it is copied through
        // rather than re-derived - the original is more faithful than anything
        // we would compute.
        routing.datePairs.forEach((pair) => {
          picked[pair.to] = row[pair.to] ?? null;
        });

        return picked;
      }),
      meta: { source: 'seed_rows', reason: 'target row count is within the seed size' }
    };
  }

  const result = await generateSdvRows({
    schemaId,
    tableName,
    sdvColumns: routing.sdvColumns,
    seedRows: seedRows.map((row) => {
      const trimmed = {};

      routing.sdvColumns.forEach((column) => {
        trimmed[column.name] = row[column.name] ?? null;
      });

      return trimmed;
    }),
    numRows: rowCount,
    constraints: routing.constraints,
    synthesizer,
    randomSeed
  });

  return {
    // Derived dates are filled in here, after SDV, so ordering holds by
    // construction instead of being left to the model.
    rows: applyDerivedDates({
      rows: result.rows,
      datePairs: routing.datePairs,
      random
    }),
    meta: {
      source: 'sdv',
      quality: result.quality,
      model: result.model,
      warnings: result.warnings
    }
  };
}

function assembleTableRows({
  tableName,
  routing,
  attributeRows,
  rowCount,
  registry,
  random,
  uniqueTracker,
  vocabularies
}) {
  const rows = [];

  for (let index = 0; index < rowCount; index += 1) {
    const row = { ...(attributeRows[index] || {}) };

    routing.keyColumns.forEach(({ name, field }) => {
      row[name] = generatePrimaryKey({
        columnName: name,
        field,
        // field.faker is a property of the stored schema format - a generation
        // hint such as "uuid" or "incremental" - not a reference to the Faker
        // library, which is gone. Renaming it would invalidate every schema
        // already in storage.
        strategy: field.faker,
        index
      });
    });

    routing.foreignKeyColumns.forEach(({ name, relationship }) => {
      row[name] = pickForeignKey({
        registry,
        random,
        parentTable: relationship.to_table,
        parentColumn: relationship.to_column
      });
    });

    routing.vocabularyColumns.forEach(({ name, field, unique }) => {
      const pool = vocabularies.get(name) || [];

      let value = pool.length
        ? random.pick(pool)
        : fallbackVocabularyValue({ columnName: name, field, index });

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

function storePrimaryKeys({ registry, tableName, tableBlueprint, routing, rows }) {
  const primaryKey = normalizeColumnName(tableBlueprint.primary_key);

  const keyName =
    primaryKey || (routing.keyColumns.length ? routing.keyColumns[0].name : null);

  if (!keyName) return;

  registry.store(
    tableName,
    keyName,
    rows.map((row) => row[keyName]).filter((value) => value !== null && value !== undefined)
  );

  /*
   * A relationship can point at a unique key rather than the primary key, so
   * those are registered too. Without this a foreign key targeting, say,
   * product_code would find an empty pool and fail.
   */
  (tableBlueprint.unique_keys || []).forEach((uniqueKey) => {
    const column = normalizeColumnName(uniqueKey);

    if (!column || column === keyName) return;

    const values = rows
      .map((row) => row[column])
      .filter((value) => value !== null && value !== undefined);

    if (values.length) registry.store(tableName, column, values);
  });
}

async function generateRelationalRows({
  blueprint,
  schemas,
  rowCount,
  seedRows: seedRowsBySchemaId = {},
  randomSeed,
  synthesizer
}) {
  if (!blueprint || !Array.isArray(blueprint.tables)) {
    throw new Error('Valid blueprint.tables is required.');
  }

  if (!Array.isArray(schemas) || schemas.length === 0) {
    throw new Error('schemas are required for relational generation.');
  }

  const schemaMap = buildSchemaMap(schemas);
  const tableMap = buildBlueprintTableMap(blueprint);
  const relationshipMap = buildRelationshipMap(blueprint.relationships);
  const dependencyOrder = resolveDependencyOrder(blueprint);

  const registry = createKeyRegistry();
  const uniqueTracker = createUniqueTracker();

  const baseSeed = Number.isFinite(Number(randomSeed))
    ? Number(randomSeed)
    : seedFromString(dependencyOrder.join(','));

  const result = {
    dependency_order: dependencyOrder,
    tables: {},
    generation: { engine: 'sdv', tables: {} }
  };

  for (const tableName of dependencyOrder) {
    const tableBlueprint = tableMap.get(tableName);

    if (!tableBlueprint) continue;

    const schema = schemaMap.get(tableBlueprint.schema_id);

    if (!schema) {
      throw new Error(`Schema not found for table ${tableBlueprint.table_name}.`);
    }

    const schemaDefinition = schema.schemaDefinition || schema.schema_definition;
    const fields = validateSchemaDefinition(schemaDefinition);

    const seedRows = normalizeSeedRows(
      getSeedRowsForSchema(seedRowsBySchemaId, tableBlueprint.schema_id)
    );

    const routing = routeColumns({
      fields,
      tableName,
      tableBlueprint,
      relationshipMap,
      seedRows
    });

    const count = resolveRowCountForTable({
      table: tableBlueprint,
      blueprint,
      defaultRowCount: rowCount
    });

    if (routing.sdvColumns.length && !seedRows.length) {
      const error = new Error(
        `No seed rows available for table "${tableBlueprint.table_name}". ` +
          `Seed rows are generated when a schema is uploaded - if this schema predates that, ` +
          `retry seed generation for it before generating tables.`
      );
      error.statusCode = 422;
      error.code = 'MISSING_SEED_ROWS';
      throw error;
    }

    // One stream per table, derived from the shared seed, so adding a table
    // does not change the values produced for the tables before it.
    const random = createRandom(baseSeed + seedFromString(tableName));

    const { rows: attributeRows, meta } = await generateAttributeRows({
      schemaId: tableBlueprint.schema_id,
      tableName,
      routing,
      seedRows,
      rowCount: count,
      random,
      randomSeed: baseSeed,
      synthesizer
    });

    const vocabularies = buildVocabularies(routing.vocabularyColumns, seedRows);

    const rows = assembleTableRows({
      tableName,
      routing,
      attributeRows,
      rowCount: count,
      registry,
      random,
      uniqueTracker,
      vocabularies
    });

    storePrimaryKeys({ registry, tableName, tableBlueprint, routing, rows });

    result.tables[tableName] = {
      schema_id: tableBlueprint.schema_id,
      table_name: tableBlueprint.table_name,
      rows_generated: rows.length,
      rows
    };

    result.generation.tables[tableName] = {
      source: meta?.source || 'keys_only',
      sdv_columns: routing.sdvColumns.map((column) => column.name),
      derived_date_columns: routing.datePairs.map(
        (pair) => `${pair.to} = ${pair.from} + gap`
      ),
      vocabulary_columns: routing.vocabularyColumns.map((column) => column.name),
      key_columns: routing.keyColumns.map((column) => column.name),
      foreign_key_columns: routing.foreignKeyColumns.map((column) => column.name),
      constraints: routing.constraints,
      quality: meta?.quality || null,
      warnings: meta?.warnings || []
    };
  }

  return result;
}

module.exports = {
  generateRelationalRows
};
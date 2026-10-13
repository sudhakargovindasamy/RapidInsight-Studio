const pool = require('../config/db');

const {
  buildCreateTableSql,
  resolveFields,
  mapTypeToSql,
} = require('../utils/buildCreateTableSql');

const {
  normalizeIdentifier,
  quoteIdentifier,
  quoteQualifiedIdentifier,
} = require('../utils/identifierUtils');

const SYSTEM_COLUMNS = new Set([
  '__ris_id',
  '__ris_generated_table_id',
  '__ris_created_by',
  '__ris_created_at',
]);

async function createProjectSchemaIfNotExists({ client, schemaName }) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
}

async function tableExists({ client, schemaName, tableName }) {
  const result = await client.query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
          AND table_type = 'BASE TABLE'
      ) AS exists
    `,
    [schemaName, tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

async function getExistingColumns({ client, schemaName, tableName }) {
  const result = await client.query(
    `
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = $2
      ORDER BY ordinal_position
    `,
    [schemaName, tableName]
  );

  return result.rows.map((row) => ({
    name: row.column_name,
    normalizedName: normalizeIdentifier(row.column_name),
    dataType: row.data_type,
  }));
}

function getMissingColumns({ existingColumns, schemaDefinition }) {
  const fields = resolveFields(schemaDefinition);

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Fields are required to evolve table schema.');
  }

  const existingColumnNames = new Set(
    existingColumns.map((column) => normalizeIdentifier(column.name))
  );

  return fields
    .map((field) => {
      const columnName = normalizeIdentifier(field.name);

      return {
        field,
        columnName,
        sqlType: mapTypeToSql(field),
      };
    })
    .filter((column) => !SYSTEM_COLUMNS.has(column.columnName))
    .filter((column) => !existingColumnNames.has(column.columnName));
}

async function addMissingColumnsToTable({
  client,
  schemaName,
  tableName,
  schemaDefinition,
}) {
  const existingColumns = await getExistingColumns({
    client,
    schemaName,
    tableName,
  });

  const missingColumns = getMissingColumns({
    existingColumns,
    schemaDefinition,
  });

  for (const column of missingColumns) {
    /*
      Important:
      New columns are intentionally added as nullable columns.

      Reason:
      If the existing table already has rows, adding a NOT NULL column without
      a default value will fail in PostgreSQL. This behaviour preserves existing
      data and allows the table to evolve safely.
    */
    await client.query(
      `ALTER TABLE ${quoteQualifiedIdentifier(schemaName, tableName)} ADD COLUMN ${quoteIdentifier(column.columnName)} ${column.sqlType}`
    );
  }

  return {
    addedColumns: missingColumns.map((column) => column.columnName),
    existingColumns: existingColumns.map((column) => column.name),
  };
}

async function dropTable({ client, schemaName, tableName }) {
  await client.query(`DROP TABLE IF EXISTS ${quoteQualifiedIdentifier(schemaName, tableName)}`);
}

async function createPhysicalTable({
  client,
  schemaName,
  tableName,
  schemaDefinition,
}) {
  const sql = buildCreateTableSql({
    schemaName,
    tableName,
    schemaDefinition,
  });

  await client.query(sql);
}

async function countRows({
  schemaName = 'public',
  tableName,
  generatedTableId,
  userId,
}) {
  const conditions = ['"__ris_created_by" = $1'];
  const values = [userId];

  if (generatedTableId) {
    values.push(generatedTableId);
    conditions.push(`"__ris_generated_table_id" = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${quoteQualifiedIdentifier(schemaName, tableName)} WHERE ${conditions.join(' AND ')}`,
    values
  );

  return result.rows[0]?.count || 0;
}

module.exports = {
  createProjectSchemaIfNotExists,
  tableExists,
  getExistingColumns,
  getMissingColumns,
  addMissingColumnsToTable,
  dropTable,
  createPhysicalTable,
  countRows,
};

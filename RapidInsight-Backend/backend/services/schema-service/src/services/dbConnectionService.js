const { Client } = require('pg');
const crypto = require('crypto');
const Papa = require('papaparse');
const env = require('../config/env');
const logger = require('../config/logger');
const { normalizeIdentifier } = require('../utils/identifierNaming');
const { uploadSchemaDefinition, uploadRawDataFile } = require('./schemaStorageService');
const { registerCatalogMetadata } = require('./catalogIngestionService');
const pool = require('../config/db');
const { loadOrReplacePhysicalTable } = require('./physicalTableLoaderService');

function parseClientConfig(connectionConfig) {
  if (connectionConfig.connectionString) {
    const isLocalhost = connectionConfig.connectionString.includes('localhost') || connectionConfig.connectionString.includes('127.0.0.1');
    return {
      connectionString: connectionConfig.connectionString.trim(),
      connectionTimeoutMillis: 8000,
      ssl: isLocalhost ? false : { rejectUnauthorized: false }
    };
  }

  const isLocalhost = connectionConfig.host === 'localhost' || connectionConfig.host === '127.0.0.1';
  return {
    host: connectionConfig.host,
    port: Number(connectionConfig.port) || 5432,
    database: connectionConfig.database,
    user: connectionConfig.user,
    password: connectionConfig.password,
    connectionTimeoutMillis: 8000,
    ssl: isLocalhost ? false : { rejectUnauthorized: false }
  };
}

function mapPgTypeToSchemaType(pgType) {
  const type = String(pgType || '').toLowerCase();
  if (['integer', 'bigint', 'smallint', 'decimal', 'numeric', 'real', 'double precision', 'int', 'int4', 'int8', 'float4', 'float8'].some(t => type.includes(t))) {
    return 'number';
  }
  if (['boolean', 'bool'].some(t => type.includes(t))) {
    return 'boolean';
  }
  if (['date', 'timestamp', 'time'].some(t => type.includes(t))) {
    return 'date';
  }
  return 'string';
}

async function testAndDiscoverTables(connectionConfig) {
  const clientConfig = parseClientConfig(connectionConfig);
  const client = new Client(clientConfig);

  try {
    await client.connect();

    const query = `
      SELECT 
        t.table_schema, 
        t.table_name,
        (
          SELECT count(*)::int 
          FROM information_schema.columns c 
          WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
        ) as column_count
      FROM information_schema.tables t
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'graphql', 'vault', 'auth', 'storage', 'realtime')
        AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_schema, t.table_name;
    `;

    const result = await client.query(query);

    return {
      success: true,
      tables: result.rows.map(r => ({
        schema: r.table_schema,
        name: r.table_name,
        fullName: `${r.table_schema}.${r.table_name}`,
        columnCount: r.column_count
      }))
    };
  } catch (err) {
    logger.error({ err }, 'Database connection test failed');
    throw new Error(`Database connection failed: ${err.message}`);
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}

async function importTablesAsSchemas({
  project,
  userId,
  userEmail,
  connectionConfig,
  selectedTables, // array of { schema, name }
  supabase
}) {
  const clientConfig = parseClientConfig(connectionConfig);
  const client = new Client(clientConfig);
  const bucket = env.SCHEMA_STORAGE_BUCKET;

  const importedSchemas = [];

  try {
    await client.connect();

    for (const tableItem of selectedTables) {
      const tableSchema = (typeof tableItem === 'object' && tableItem !== null ? tableItem.schema : 'public') || 'public';
      const tableName = typeof tableItem === 'object' && tableItem !== null ? (tableItem.name || tableItem.tableName) : String(tableItem);
      if (!tableName) continue;

      // 1. Introspect columns & primary key
      const colQuery = `
        SELECT 
          c.column_name, 
          c.data_type, 
          c.is_nullable,
          c.column_default,
          CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
        FROM information_schema.columns c
        LEFT JOIN (
          SELECT kcu.column_name, kcu.table_schema, kcu.table_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
        ) pk ON pk.table_schema = c.table_schema 
            AND pk.table_name = c.table_name 
            AND pk.column_name = c.column_name
        WHERE c.table_schema = $1 AND c.table_name = $2
        ORDER BY c.ordinal_position;
      `;

      const colsResult = await client.query(colQuery, [tableSchema, tableName]);
      if (!colsResult.rows.length) continue;

      const fields = colsResult.rows.map(col => ({
        name: col.column_name,
        type: mapPgTypeToSchemaType(col.data_type),
        primaryKey: Boolean(col.is_primary_key),
        notNull: col.is_nullable === 'NO',
        unique: Boolean(col.is_primary_key)
      }));

      const schemaDefinition = { fields };

      // 2. Sample data rows
      let sampleRows = [];
      try {
        const safeSchema = String(tableSchema).replace(/"/g, '""');
        const safeTable = String(tableName).replace(/"/g, '""');
        const rowsQuery = `SELECT * FROM "${safeSchema}"."${safeTable}" LIMIT 100;`;
        const rowsResult = await client.query(rowsQuery);
        sampleRows = rowsResult.rows || [];
      } catch (err) {
        logger.warn({ err, table: tableName }, 'Could not read sample rows from source table');
      }

      // 3. Prepare schema metadata
      const schemaId = crypto.randomUUID();
      const storagePath = `${userId}/${project.id}/${schemaId}/schema.json`;
      const dataStoragePath = `${userId}/${project.id}/${schemaId}/data.csv`;
      const sanitizedTableName = normalizeIdentifier(tableName);
      const displayName = `${project.name} / ${tableName} (from DB)`;
      const hasData = sampleRows.length > 0;

      // Upload schema.json definition
      await uploadSchemaDefinition({
        supabase,
        bucket,
        path: storagePath,
        schemaDefinition
      });

      // Upload raw data CSV if rows were fetched
      if (hasData) {
        const csvContent = Papa.unparse(sampleRows);
        await uploadRawDataFile({
          supabase,
          bucket,
          path: dataStoragePath,
          buffer: Buffer.from(csvContent, 'utf-8'),
          contentType: 'text/csv'
        });
      }

      // Load or replace physical table and synchronize metadata
      const tableResult = await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project,
        userId,
        schemaDefinition,
        rows: sampleRows,
        sanitizedTableName,
        originalFileName: `${tableName}.csv`,
        fileType: 'csv',
        storagePath,
        dataStoragePath: hasData ? dataStoragePath : null,
        bucket,
        displayName,
        source: {
          sourceName: connectionConfig.database ? `DB: ${connectionConfig.database}` : 'External PostgreSQL',
          sourceType: 'EXTERNAL_POSTGRESQL',
          host: connectionConfig.host || 'remote',
          port: connectionConfig.port || 5432,
          databaseName: connectionConfig.database || null
        },
        assetType: 'TABLE'
      });

      importedSchemas.push({
        id: tableResult.schemaId,
        sanitized_table_name: sanitizedTableName,
        physical_table_name: tableResult.physicalTableName,
        row_count: tableResult.rowCount,
        is_update: tableResult.isUpdate
      });
    }

    return {
      success: true,
      importedCount: importedSchemas.length,
      schemas: importedSchemas
    };
  } catch (err) {
    logger.error({ err }, 'Failed importing tables from connected database');
    throw err;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore close errors
    }
  }
}

module.exports = {
  testAndDiscoverTables,
  importTablesAsSchemas
};

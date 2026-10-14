const crypto = require('crypto');
const Papa = require('papaparse');
const env = require('../config/env');
const logger = require('../config/logger');
const { normalizeIdentifier } = require('../utils/identifierNaming');
const { uploadSchemaDefinition, uploadRawDataFile } = require('./schemaStorageService');
const { registerCatalogMetadata } = require('./catalogIngestionService');
const pool = require('../config/db');
const { loadOrReplacePhysicalTable } = require('./physicalTableLoaderService');
const { resolveConnector, securityUtils } = require('../connectors');

/**
 * Backward compatibility helper for legacy code requiring parsed client config.
 */
function parseClientConfig(connectionConfig) {
  const { connector } = resolveConnector(connectionConfig);
  return connector.validateConfig(connectionConfig);
}

/**
 * Tests database connectivity and introspects available user tables using the resolved connector.
 * @param {Object} connectionConfig
 * @returns {Promise<{ success: boolean, tables: Array }>}
 */
async function testAndDiscoverTables(connectionConfig) {
  const { connector } = resolveConnector(connectionConfig);
  return await connector.testConnection(connectionConfig);
}

/**
 * Introspects selected tables and imports them into project schemas and physical tables.
 */
async function importTablesAsSchemas({
  project,
  userId,
  userEmail,
  connectionConfig,
  selectedTables, // array of { schema, name }
  supabase
}) {
  const { connector, resolvedType } = resolveConnector(connectionConfig);
  const client = await connector.createClient(connectionConfig);
  const bucket = env.SCHEMA_STORAGE_BUCKET;

  const importedSchemas = [];

  try {
    for (const tableItem of selectedTables) {
      const tableSchema = (typeof tableItem === 'object' && tableItem !== null ? tableItem.schema : 'public') || 'public';
      const tableName = typeof tableItem === 'object' && tableItem !== null ? (tableItem.name || tableItem.tableName) : String(tableItem);
      if (!tableName) continue;

      // 1. Introspect columns & primary key via connector
      const fields = await connector.introspectTableColumns(client, tableSchema, tableName);
      if (!fields || !fields.length) continue;

      const schemaDefinition = { fields };

      // 2. Sample data rows via connector
      let sampleRows = [];
      try {
        sampleRows = await connector.fetchSampleRows(client, tableSchema, tableName, 100);
      } catch (err) {
        logger.warn(
          { err: securityUtils.sanitizeErrorMessage(err.message), table: tableName },
          'Could not read sample rows from source table'
        );
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
      const sourceTypeName = resolvedType === 'postgres' ? 'EXTERNAL_POSTGRESQL' : `EXTERNAL_${resolvedType.toUpperCase()}`;
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
          sourceName: connectionConfig.database ? `DB: ${connectionConfig.database}` : `External ${resolvedType.toUpperCase()}`,
          sourceType: sourceTypeName,
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
    logger.error(
      { err: securityUtils.sanitizeErrorMessage(err.message) },
      'Failed importing tables from connected database'
    );
    throw err;
  } finally {
    await connector.closeClient(client);
  }
}

/**
 * Introspects column definitions for a specific table in a connected database.
 */
async function getDatabaseTableColumns(connectionConfig, schema = 'public', table) {
  const { connector } = resolveConnector(connectionConfig);
  const client = await connector.createClient(connectionConfig);
  try {
    return await connector.introspectTableColumns(client, schema || 'public', table);
  } finally {
    await connector.closeClient(client);
  }
}

module.exports = {
  parseClientConfig,
  testAndDiscoverTables,
  importTablesAsSchemas,
  getDatabaseTableColumns
};

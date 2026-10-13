const crypto = require('crypto');
const pool = require('../config/db');
const AppError = require('../errors/AppError');
const logger = require('../config/logger');
const { registerCatalogMetadata } = require('./catalogIngestionService');
const { normalizeIdentifier } = require('../utils/identifierNaming');

/**
 * Registers asset metadata into the Asset Registry / Data Catalog without storing business data rows.
 * Fulfills the requirement:
 * 1. Validates metadata structure (file name, format, column names, column count).
 * 2. Checks for duplicates according to duplicate-handling rules.
 * 3. Persists metadata in public.data_source, public.catalog_asset, public.asset_column, and public.schemas.
 * 4. NEVER inserts or stores actual business rows (row_count = 0, uploaded_row_count = 0).
 * 5. NEVER uploads raw file to Supabase Storage.
 * 6. ACID transactional consistency.
 */
async function registerAssetMetadata({ project, userId, payload }) {
  if (!project || !project.id) {
    throw new AppError('Valid project is required for asset registration.', 400, 'PROJECT_REQUIRED');
  }
  if (!userId) {
    throw new AppError('User ID is required for asset registration.', 401, 'USER_UNAUTHORIZED');
  }

  const originalFileName = String(payload.originalFileName || payload.name || '').trim();
  if (!originalFileName) {
    throw new AppError('originalFileName is required.', 400, 'ORIGINAL_FILE_NAME_REQUIRED');
  }

  const assetName = normalizeIdentifier(payload.assetName || originalFileName);
  if (!assetName) {
    throw new AppError('Invalid asset name derived from file.', 400, 'INVALID_ASSET_NAME');
  }

  const fileType = String(payload.fileType || 'csv').trim().toLowerCase().replace(/^\./, '');
  const fileSize = payload.fileSize != null ? Number(payload.fileSize) : null;
  const sheetName = payload.sheetName ? String(payload.sheetName).trim() : null;
  const columns = Array.isArray(payload.columns) ? payload.columns : [];

  if (columns.length === 0) {
    throw new AppError('Asset must define at least one valid column header.', 400, 'EMPTY_COLUMNS');
  }

  // Validate column definitions
  const seenCols = new Set();
  const normalizedColumns = columns.map((col, index) => {
    const colName = String(col.name || col.column_name || '').trim().toLowerCase();
    if (!colName) {
      throw new AppError(`Column at position ${index} must have a valid non-empty name.`, 400, 'INVALID_COLUMN_NAME');
    }
    if (seenCols.has(colName)) {
      throw new AppError(`Duplicate column name "${colName}" found in schema.`, 400, 'DUPLICATE_COLUMN_NAME');
    }
    seenCols.add(colName);

    return {
      name: colName,
      type: String(col.type || col.data_type || 'string').trim().toLowerCase(),
      ordinalPosition: typeof col.ordinalPosition === 'number' ? col.ordinalPosition : index,
      isPk: Boolean(col.isPk || col.is_pk || col.primaryKey),
      isNullable: col.isNullable !== undefined ? Boolean(col.isNullable) : true
    };
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Advisory transaction lock scoped to (project_id, asset_name)
    const lockKey = `${project.id}:${assetName}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

    // Check duplicate asset in catalog_asset for this project
    const { rows: existingAssets } = await client.query(
      `SELECT ca.asset_id, ca.asset_name, ca.schema_id
       FROM public.catalog_asset ca
       WHERE ca.project_id = $1 AND ca.asset_name = $2
       LIMIT 1`,
      [project.id, assetName]
    );

    let schemaId;
    let isUpdate = false;

    if (existingAssets.length > 0) {
      // Check existing columns
      const existingAssetId = existingAssets[0].asset_id;
      const { rows: existingCols } = await client.query(
        `SELECT column_name, data_type FROM public.asset_column WHERE asset_id = $1 ORDER BY ordinal_position`,
        [existingAssetId]
      );

      const isSameSchema =
        existingCols.length === normalizedColumns.length &&
        existingCols.every((ec, idx) => ec.column_name === normalizedColumns[idx].name && ec.data_type === normalizedColumns[idx].type);

      if (isSameSchema) {
        await client.query('ROLLBACK');
        throw new AppError(
          `Asset "${assetName}" is already registered in this project with identical schema. Duplicate registration blocked.`,
          409,
          'DUPLICATE_ASSET_BLOCKED'
        );
      }

      isUpdate = true;
      schemaId = existingAssets[0].schema_id || crypto.randomUUID();
    } else {
      schemaId = crypto.randomUUID();
    }

    // 1. Register or update in public.schemas (metadata only: uploaded_row_count = 0, no file buffer uploaded)
    const physicalSchemaName = project.physical_schema_name || 'public';
    const physicalTableName = assetName;

    if (isUpdate) {
      await client.query(
        `UPDATE public.schemas
         SET field_count = $1,
             table_status = 'REGISTERED',
             uploaded_row_count = 0,
             file_size = $2,
             sheet_name = $3,
             file_type = $4,
             updated_at = now()
         WHERE id = $5`,
        [normalizedColumns.length, fileSize, sheetName, fileType, schemaId]
      );
    } else {
      const storagePath = `metadata/${userId}/${project.id}/${schemaId}.json`;
      await client.query(
        `INSERT INTO public.schemas (
          id, user_id, project_id, original_file_name, display_name,
          storage_bucket, storage_path,
          file_type, field_count, status, table_status, sanitized_table_name,
          physical_schema_name, physical_table_name, data_source,
          uploaded_row_count, file_size, sheet_name, seed_status, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          'schemas', $6,
          $7, $8, 'uploaded', 'REGISTERED', $9,
          $10, $11, 'uploaded',
          0, $12, $13, 'not_required', now(), now()
        )`,
        [
          schemaId,
          userId,
          project.id,
          originalFileName,
          originalFileName,
          storagePath,
          fileType,
          normalizedColumns.length,
          assetName,
          physicalSchemaName,
          physicalTableName,
          fileSize,
          sheetName
        ]
      );
    }

    // 2. Register catalog metadata (data_source, catalog_asset, asset_column)
    const catalogResult = await registerCatalogMetadata({
      project,
      userId,
      source: {
        sourceName: originalFileName,
        sourceType: 'FILE_UPLOAD'
      },
      asset: {
        schemaId,
        generatedTableId: null,
        schemaName: physicalSchemaName,
        assetName,
        assetType: 'FILE_SCHEMA',
        fileSize,
        sheetName,
        columnCount: normalizedColumns.length,
        mimeType: payload.mimeType || null
      },
      columns: normalizedColumns,
      dbClient: client
    });

    await client.query('COMMIT');

    logger.info(
      { projectId: project.id, assetName, assetId: catalogResult.assetId, columnCount: normalizedColumns.length },
      'Asset metadata successfully registered in Asset Registry (no data rows stored)'
    );

    return {
      assetId: catalogResult.assetId,
      sourceId: catalogResult.sourceId,
      schemaId,
      assetName,
      originalFileName,
      fileType,
      fileSize,
      sheetName,
      columnCount: normalizedColumns.length,
      columns: normalizedColumns,
      isUpdate
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  registerAssetMetadata
};

const pool = require('../config/db');
const logger = require('../config/logger');

/**
 * Registers data source, catalog asset, and asset columns into the Data Catalog.
 * Fully idempotent: re-registering an asset updates timestamps and definitions
 * without creating duplicates.
 *
 * @param {Object} params
 * @param {Object} params.project - Project object (must include id and organisation_id)
 * @param {string} params.userId - Authenticated user UUID
 * @param {Object} params.source - Source details { sourceName, sourceType, host, port, databaseName }
 * @param {Object} params.asset - Asset details { schemaId, generatedTableId, schemaName, assetName, assetType }
 * @param {Array}  params.columns - Array of columns [{ name, type, ordinalPosition, isPk, isNullable }]
 * @param {Object} [params.dbClient] - Optional PG client if inside an existing transaction
 */
async function registerCatalogMetadata({
  project,
  userId,
  source,
  asset,
  columns,
  dbClient = null
}) {
  if (!project || !project.id) {
    throw new Error('Project with valid id is required for catalog ingestion.');
  }
  if (!userId) {
    throw new Error('User ID is required for catalog ingestion.');
  }
  if (!source || !source.sourceName || !source.sourceType) {
    throw new Error('Valid source name and source type are required.');
  }
  if (!asset || !asset.assetName) {
    throw new Error('Valid asset name is required.');
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('Columns array must not be empty.');
  }

  const client = dbClient || (await pool.connect());
  const shouldRelease = !dbClient;

  try {
    if (shouldRelease) {
      await client.query('BEGIN');
    }

    // 1. Idempotent DATA_SOURCE registration
    // organization_id is auto-synced/validated by trigger trg_data_source_sync_organisation
    const sourceQuery = `
      INSERT INTO public.data_source (
        project_id,
        organisation_id,
        source_name,
        source_type,
        environment,
        host,
        port,
        database_name,
        auth_type,
        status,
        created_by
      ) VALUES ($1, $2, $3, $4, 'development', $5, $6, $7, 'NONE', 'ACTIVE', $8)
      ON CONFLICT (project_id, source_name) DO UPDATE SET
        environment = EXCLUDED.environment,
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        database_name = EXCLUDED.database_name,
        status = 'ACTIVE',
        updated_at = now()
      RETURNING source_id;
    `;

    const sourceRes = await client.query(sourceQuery, [
      project.id,
      project.organisation_id,
      source.sourceName.trim(),
      source.sourceType,
      source.host || null,
      source.port ? Number(source.port) : null,
      source.databaseName || null,
      userId
    ]);

    const sourceId = sourceRes.rows[0].source_id;

    // 2. Idempotent CATALOG_ASSET registration (Strict single-asset per table/project)
    const schemaName = (asset.schemaName || 'public').trim();
    const assetName = asset.assetName.trim();
    const fqName = `${schemaName}.${assetName}`;
    const assetType = asset.assetType || 'TABLE';

    const fileSize = asset.fileSize != null ? Number(asset.fileSize) : null;
    const sheetName = asset.sheetName || null;
    const columnCount = typeof asset.columnCount === 'number' ? asset.columnCount : columns.length;
    const mimeType = asset.mimeType || null;

    // Check if an asset already exists for this table in this project to prevent duplicates
    let existingAssetId = asset.assetId || null;
    if (!existingAssetId && asset.schemaId) {
      const { rows: schemaAssetRows } = await client.query(
        `SELECT asset_id FROM public.catalog_asset WHERE project_id = $1 AND schema_id = $2 AND status = 'ACTIVE' LIMIT 1`,
        [project.id, asset.schemaId]
      );
      if (schemaAssetRows.length) existingAssetId = schemaAssetRows[0].asset_id;
    }
    if (!existingAssetId) {
      const { rows: fqAssetRows } = await client.query(
        `SELECT asset_id FROM public.catalog_asset WHERE project_id = $1 AND fq_name = $2 AND status = 'ACTIVE' LIMIT 1`,
        [project.id, fqName]
      );
      if (fqAssetRows.length) existingAssetId = fqAssetRows[0].asset_id;
    }

    let assetId;
    if (existingAssetId) {
      const updateQuery = `
        UPDATE public.catalog_asset
        SET source_id = $1,
            schema_id = COALESCE($2, schema_id),
            generated_table_id = COALESCE($3, generated_table_id),
            asset_type = $4,
            file_size = COALESCE($5, file_size),
            sheet_name = COALESCE($6, sheet_name),
            column_count = COALESCE($7, column_count),
            mime_type = COALESCE($8, mime_type),
            status = 'ACTIVE',
            updated_at = now()
        WHERE asset_id = $9
        RETURNING asset_id;
      `;
      const updateRes = await client.query(updateQuery, [
        sourceId,
        asset.schemaId || null,
        asset.generatedTableId || null,
        assetType,
        fileSize,
        sheetName,
        columnCount,
        mimeType,
        existingAssetId
      ]);
      assetId = updateRes.rows[0].asset_id;
    } else {
      const assetQuery = `
        INSERT INTO public.catalog_asset (
          source_id,
          project_id,
          schema_id,
          generated_table_id,
          schema_name,
          asset_name,
          asset_type,
          fq_name,
          classification,
          status,
          created_by,
          file_size,
          sheet_name,
          column_count,
          mime_type
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'INTERNAL', 'ACTIVE', $9, $10, $11, $12, $13)
        ON CONFLICT (source_id, fq_name) DO UPDATE SET
          schema_id = COALESCE(EXCLUDED.schema_id, public.catalog_asset.schema_id),
          generated_table_id = COALESCE(EXCLUDED.generated_table_id, public.catalog_asset.generated_table_id),
          asset_type = EXCLUDED.asset_type,
          file_size = COALESCE(EXCLUDED.file_size, public.catalog_asset.file_size),
          sheet_name = COALESCE(EXCLUDED.sheet_name, public.catalog_asset.sheet_name),
          column_count = COALESCE(EXCLUDED.column_count, public.catalog_asset.column_count),
          mime_type = COALESCE(EXCLUDED.mime_type, public.catalog_asset.mime_type),
          status = 'ACTIVE',
          updated_at = now()
        RETURNING asset_id;
      `;

      const assetRes = await client.query(assetQuery, [
        sourceId,
        project.id,
        asset.schemaId || null,
        asset.generatedTableId || null,
        schemaName,
        assetName,
        assetType,
        fqName,
        userId,
        fileSize,
        sheetName,
        columnCount,
        mimeType
      ]);

      assetId = assetRes.rows[0].asset_id;
    }

    // 3. Idempotent ASSET_COLUMN registration
    // We remove prior columns for this asset within this transaction so any ordinal_position
    // or column set reshuffling will never trigger position uniqueness collisions.
    await client.query('DELETE FROM public.asset_column WHERE asset_id = $1', [assetId]);

    const activeColumnNames = [];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const colName = String(col.name || col.column_name || '').trim();
      if (!colName) continue;

      activeColumnNames.push(colName);
      const dataType = String(col.type || col.data_type || 'string').trim().toLowerCase();
      const ordinalPos = typeof col.ordinalPosition === 'number' ? col.ordinalPosition : i;
      const isPk = Boolean(col.isPk || col.is_pk || col.primaryKey);
      const isNullable = col.isNullable !== undefined ? Boolean(col.isNullable) : (col.notNull !== undefined ? !col.notNull : true);

      const colQuery = `
        INSERT INTO public.asset_column (
          asset_id,
          column_name,
          data_type,
          ordinal_position,
          is_pk,
          is_nullable,
          classification
        ) VALUES ($1, $2, $3, $4, $5, $6, 'INTERNAL')
        ON CONFLICT (asset_id, column_name) DO UPDATE SET
          data_type = EXCLUDED.data_type,
          ordinal_position = EXCLUDED.ordinal_position,
          is_pk = EXCLUDED.is_pk,
          is_nullable = EXCLUDED.is_nullable,
          updated_at = now();
      `;

      await client.query(colQuery, [
        assetId,
        colName,
        dataType,
        ordinalPos,
        isPk,
        isNullable
      ]);
    }

    if (shouldRelease) {
      await client.query('COMMIT');
    }

    logger.info(
      { projectId: project.id, sourceId, assetId, columnsCount: activeColumnNames.length },
      'Successfully registered catalog metadata'
    );

    return {
      sourceId,
      assetId,
      columnsCount: activeColumnNames.length
    };
  } catch (err) {
    if (shouldRelease) {
      await client.query('ROLLBACK');
    }
    logger.error({ err, projectId: project?.id }, 'Failed to register catalog metadata');
    throw err;
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  registerCatalogMetadata
};

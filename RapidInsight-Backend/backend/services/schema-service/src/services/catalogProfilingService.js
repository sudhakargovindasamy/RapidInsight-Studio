const pool = require('../config/db');
const logger = require('../config/logger');
const AppError = require('../errors/AppError');
const { createSupabaseClient } = require('../config/supabase');
const { registerCatalogMetadata } = require('./catalogIngestionService');
const { profileAssetData } = require('./sqlDataProfilingService');

const NUMERIC_DATA_TYPES = new Set([
  'number',
  'integer',
  'bigint',
  'smallint',
  'decimal',
  'numeric',
  'real',
  'double precision',
  'float',
  'int',
  'int2',
  'int4',
  'int8',
  'float4',
  'float8'
]);

function isNumericType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  return NUMERIC_DATA_TYPES.has(normalized);
}

function escapeIdentifier(identifier) {
  if (!identifier || typeof identifier !== 'string') {
    throw new AppError('Invalid identifier for SQL escaping.', 500, 'INVALID_SQL_IDENTIFIER');
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Automatically synchronizes uploaded project schemas and physical tables from the
 * Overview section into the Data Catalog. Ensures that any project with uploaded schemas
 * is immediately ready for profiling without prompting the user to re-upload.
 */
async function syncProjectSchemasToCatalog({ project = null, projectId = null, userId = null, supabase = null } = {}) {
  const targetProjectId = projectId || project?.id;
  if (!targetProjectId) return;

  try {
    let resolvedProject = project;
    if (!resolvedProject) {
      const { rows } = await pool.query('SELECT * FROM public.projects WHERE id = $1', [targetProjectId]);
      if (!rows.length) return;
      resolvedProject = rows[0];
    }

    const { rows: schemas } = await pool.query(
      'SELECT * FROM public.schemas WHERE project_id = $1 ORDER BY created_at ASC',
      [targetProjectId]
    );

    if (!schemas.length) return;

    const { rows: existingAssets } = await pool.query(
      'SELECT asset_id, schema_id, asset_name FROM public.catalog_asset WHERE project_id = $1 AND status = $2',
      [targetProjectId, 'ACTIVE']
    );

    const assetBySchemaId = new Map(existingAssets.map((a) => [a.schema_id, a]));
    const sb = supabase || createSupabaseClient();

    for (const schema of schemas) {
      if (assetBySchemaId.has(schema.id)) continue;

      let fields = [];

      // 1. Try reading fields from physical generated table columns if populated
      const { rows: gtRows } = await pool.query(
        'SELECT * FROM public.generated_tables WHERE schema_id = $1 AND project_id = $2',
        [schema.id, targetProjectId]
      );

      if (gtRows.length) {
        const physSchema = schema.physical_schema_name || resolvedProject.physical_schema_name || 'public';
        const physTable = gtRows[0].physical_table_name;
        const { rows: colRows } = await pool.query(
          `SELECT column_name as name, data_type as type, ordinal_position 
           FROM information_schema.columns 
           WHERE table_schema = $1 AND table_name = $2 AND column_name NOT LIKE '__ris_%' 
           ORDER BY ordinal_position`,
          [physSchema, physTable]
        );
        if (colRows.length) {
          fields = colRows;
        }
      }

      // 2. If not found in physical tables, download schema definition JSON from storage
      if (!fields.length && schema.storage_path && sb?.storage) {
        try {
          const { data } = await sb.storage
            .from(schema.storage_bucket || 'schemas')
            .download(schema.storage_path);
          if (data) {
            const text = await data.text();
            const json = JSON.parse(text);
            fields = json.fields || json.columns || [];
          }
        } catch {
          // ignore storage download failure and continue
        }
      }

      if (!fields.length) continue;

      await registerCatalogMetadata({
        project: resolvedProject,
        userId: schema.user_id || userId || resolvedProject.created_by,
        source: {
          sourceName: 'Uploaded Schema Files',
          sourceType: 'FILE_UPLOAD'
        },
        asset: {
          schemaId: schema.id,
          generatedTableId: gtRows[0]?.id || schema.generated_table_id || null,
          schemaName: schema.physical_schema_name || resolvedProject.physical_schema_name || 'public',
          assetName: schema.sanitized_table_name || schema.original_file_name.replace(/\\.[^/.]+$/, ''),
          assetType: 'FILE_SCHEMA'
        },
        columns: fields
      });
    }

    // Link any populated generated tables to catalog assets where generated_table_id is still null
    await pool.query(
      `UPDATE public.catalog_asset ca
       SET generated_table_id = gt.id, updated_at = now()
       FROM public.generated_tables gt
       WHERE gt.project_id = ca.project_id
         AND (gt.schema_id = ca.schema_id OR gt.physical_table_name ILIKE ca.asset_name || '_%')
         AND ca.project_id = $1
         AND ca.generated_table_id IS NULL`,
      [targetProjectId]
    );
  } catch (error) {
    logger.warn({ projectId: targetProjectId, error: error.message }, 'Catalog auto-sync encountered an issue; continuing');
  }
}

/**
 * List catalog sources for an authorized project
 */
async function listCatalogSources({ projectId, project = null, userId = null, supabase = null, loadedOnly = false }) {
  await syncProjectSchemasToCatalog({ project, projectId, userId, supabase });

  let query;
  if (loadedOnly) {
    query = `
      SELECT DISTINCT
        ds.source_id,
        ds.project_id,
        ds.organisation_id,
        ds.source_name,
        ds.source_type,
        ds.environment,
        ds.host,
        ds.port,
        ds.database_name,
        ds.auth_type,
        ds.status,
        ds.created_at,
        ds.updated_at
      FROM public.data_source ds
      JOIN public.catalog_asset ca ON ca.source_id = ds.source_id
      LEFT JOIN public.generated_tables gt 
        ON (gt.id = ca.generated_table_id OR (ca.generated_table_id IS NULL AND gt.schema_id = ca.schema_id))
      LEFT JOIN public.schemas s ON s.id = ca.schema_id
      WHERE ds.project_id = $1 
        AND ds.status = 'ACTIVE'
        AND ca.status = 'ACTIVE'
        AND (
          (gt.status = 'POPULATED' AND COALESCE(gt.row_count, 0) > 0)
          OR (COALESCE(s.uploaded_row_count, 0) > 0)
        )
      ORDER BY ds.created_at ASC;
    `;
  } else {
    query = `
      SELECT 
        source_id,
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
        created_at,
        updated_at
      FROM public.data_source
      WHERE project_id = $1 AND status = 'ACTIVE'
      ORDER BY created_at ASC;
    `;
  }
  const result = await pool.query(query, [projectId]);
  return result.rows;
}

/**
 * List catalog assets for a given source within an authorized project
 */
async function listCatalogAssets({ projectId, sourceId }) {
  const query = `
    WITH distinct_assets AS (
      SELECT DISTINCT ON (ca.fq_name)
        ca.asset_id,
        ca.source_id,
        ca.project_id,
        ca.schema_id,
        ca.generated_table_id,
        ca.schema_name,
        ca.asset_name,
        ca.asset_type,
        ca.fq_name,
        ca.classification,
        ca.status,
        ca.file_size,
        ca.sheet_name,
        ca.column_count,
        ca.created_at,
        ca.updated_at,
        ds.source_name,
        ds.source_type,
        CASE 
          WHEN gt.status = 'POPULATED' THEN true
          ELSE false
        END as is_populated,
        COALESCE(gt.row_count, 0) as row_count,
        gt.source_file_name,
        CASE 
          WHEN gt.source_file_name ILIKE '%synthetic%' 
            OR gt.source_file_name ILIKE '%sdv%'
            OR s.data_source IN ('synthetic', 'faker')
            OR ds.source_name ILIKE '%synthetic%'
            OR ds.source_name ILIKE '%(sdv)%'
            OR ds.source_type = 'INTERNAL_PROJECT_DB'
          THEN true
          ELSE false
        END as is_synthetic
      FROM public.catalog_asset ca
      LEFT JOIN public.data_source ds ON ds.source_id = ca.source_id
      LEFT JOIN public.generated_tables gt 
        ON (gt.id = ca.generated_table_id OR (ca.generated_table_id IS NULL AND gt.schema_id = ca.schema_id))
      LEFT JOIN public.schemas s ON s.id = ca.schema_id
      WHERE ca.project_id = $1 
        AND ($2::uuid IS NULL OR ca.source_id = $2::uuid) 
        AND ca.status = 'ACTIVE'
      ORDER BY ca.fq_name, ca.updated_at DESC, ca.created_at DESC
    )
    SELECT * FROM distinct_assets
    ORDER BY created_at DESC, asset_name ASC;
  `;
  const result = await pool.query(query, [projectId, sourceId || null]);
  return result.rows;
}

/**
 * List catalog columns for a given asset within an authorized project
 */
async function listCatalogColumns({ projectId, assetId }) {
  const query = `
    SELECT 
      ac.column_id,
      ac.asset_id,
      ac.column_name,
      ac.data_type,
      ac.ordinal_position,
      ac.is_pk,
      ac.is_fk,
      ac.is_nullable,
      ac.classification,
      ac.created_at,
      ac.updated_at
    FROM public.asset_column ac
    JOIN public.catalog_asset ca ON ca.asset_id = ac.asset_id
    WHERE ca.project_id = $1 AND ac.asset_id = $2
    ORDER BY ac.ordinal_position ASC;
  `;
  const result = await pool.query(query, [projectId, assetId]);
  return result.rows;
}

/**
 * Execute a profile statistic query against the physical table of a verified catalog column
 */
async function runProfileStatistic({ projectId, columnId, statistic, userId = null, dbClient = null }) {
  // 1. Resolve column, asset, source, and physical table mapping
  const resolveQuery = `
    SELECT 
      ac.column_id,
      ac.column_name,
      ac.data_type,
      ca.asset_id,
      ca.asset_name,
      ca.asset_type,
      ca.schema_name as asset_schema_name,
      ca.source_id,
      ca.project_id,
      ca.created_by as asset_created_by,
      ds.source_type,
      ds.source_name,
      gt.id as generated_table_id,
      gt.physical_schema_name,
      gt.physical_table_name,
      gt.status as table_status,
      gt.row_count
    FROM public.asset_column ac
    JOIN public.catalog_asset ca ON ca.asset_id = ac.asset_id
    JOIN public.data_source ds ON ds.source_id = ca.source_id
    LEFT JOIN public.generated_tables gt 
      ON (gt.id = ca.generated_table_id OR (ca.generated_table_id IS NULL AND gt.schema_id = ca.schema_id))
    WHERE ac.column_id = $1 AND ca.project_id = $2;
  `;

  const metaRes = await pool.query(resolveQuery, [columnId, projectId]);
  if (!metaRes.rows.length) {
    throw new AppError('Catalog column not found in this project.', 404, 'COLUMN_NOT_FOUND');
  }

  const meta = metaRes.rows[0];

  // 2. Validate statistic compatibility with column data type
  const isNumeric = isNumericType(meta.data_type);
  if (['MIN', 'MAX', 'AVG'].includes(statistic) && !isNumeric) {
    throw new AppError(
      `Statistic '${statistic}' is only supported on numeric columns. Column '${meta.column_name}' is of type '${meta.data_type}'.`,
      400,
      'UNSUPPORTED_STATISTIC_FOR_DATA_TYPE'
    );
  }

  // 3. Validate physical table availability
  if (!meta.physical_schema_name || !meta.physical_table_name || meta.table_status !== 'POPULATED') {
    throw new AppError(
      `Asset '${meta.asset_name}' is not currently backed by a populated physical table in the database. Generate and populate tables first to profile.`,
      422,
      'SOURCE_TABLE_NOT_POPULATED'
    );
  }

  // 4. Build strictly sanitized and escaped SQL
  const safeSchema = escapeIdentifier(meta.physical_schema_name);
  const safeTable = escapeIdentifier(meta.physical_table_name);
  const safeColumn = escapeIdentifier(meta.column_name);

  let statSql = '';
  switch (statistic) {
    case 'NULL_COUNT':
      statSql = `(COUNT(*) - COUNT(${safeColumn}))::bigint`;
      break;
    case 'COUNT':
      statSql = `COUNT(${safeColumn})::bigint`;
      break;
    case 'DISTINCT_COUNT':
      statSql = `COUNT(DISTINCT ${safeColumn})::bigint`;
      break;
    case 'MIN':
      statSql = `MIN(${safeColumn})::numeric`;
      break;
    case 'MAX':
      statSql = `MAX(${safeColumn})::numeric`;
      break;
    case 'AVG':
      statSql = `ROUND(AVG(${safeColumn})::numeric, 4)`;
      break;
    default:
      throw new AppError(`Unsupported statistic: ${statistic}`, 400, 'INVALID_STATISTIC');
  }

  const sql = `
    SELECT 
      ${statSql
        
      } AS stat_result,
      COUNT(*)::bigint AS sample_size
    FROM ${safeSchema}.${safeTable};
  `;

  const client = dbClient || await pool.connect();
  const startTime = Date.now();

  try {
    // Enforce 5-second maximum query execution time
    await client.query('SET statement_timeout = 5000');
    const result = await client.query(sql);
    const durationMs = Date.now() - startTime;

    const row = result.rows[0] || {};
    let finalValue = row.stat_result;

    if (finalValue !== null && finalValue !== undefined) {
      if (['NULL_COUNT', 'COUNT', 'DISTINCT_COUNT'].includes(statistic)) {
        finalValue = Number(finalValue);
      } else if (['MIN', 'MAX', 'AVG'].includes(statistic)) {
        finalValue = Number(finalValue);
      }
    }

    let fullProfile = null;
    try {
      fullProfile = await profileAssetData({
        projectId,
        assetId: meta.asset_id,
        columnId: meta.column_id,
        targetColumnName: meta.column_name,
        statistic,
        targetResultValue: finalValue,
        dbClient: client
      });
    } catch (profileErr) {
      logger.warn({ profileErr: profileErr.message }, 'Failed to compute full asset profile along with statistic');
    }

    // Persist profiling run result to database (including profile_data)
    let savedRecord = null;
    const authorUserId = userId || meta.asset_created_by;
    if (authorUserId) {
      try {
        const insertSql = `
          INSERT INTO public.catalog_profiling_result (
            project_id, user_id, source_id, source_name,
            asset_id, asset_name, column_id, column_name,
            data_type, statistic, result_value, sample_size,
            execution_duration_ms, profile_data, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
          RETURNING result_id, created_at;
        `;
        const insertRes = await client.query(insertSql, [
          projectId,
          authorUserId,
          meta.source_id || null,
          meta.source_name || 'Uploaded Schema Files',
          meta.asset_id || null,
          meta.asset_name,
          meta.column_id || null,
          meta.column_name,
          meta.data_type,
          statistic,
          finalValue,
          Number(row.sample_size || 0),
          durationMs,
          fullProfile ? JSON.stringify(fullProfile) : null
        ]);
        savedRecord = insertRes.rows[0];
      } catch (insertErr) {
        // Fallback without profile_data column if necessary
        try {
          const fallbackSql = `
            INSERT INTO public.catalog_profiling_result (
              project_id, user_id, source_id, source_name,
              asset_id, asset_name, column_id, column_name,
              data_type, statistic, result_value, sample_size,
              execution_duration_ms, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
            RETURNING result_id, created_at;
          `;
          const fallbackRes = await client.query(fallbackSql, [
            projectId,
            authorUserId,
            meta.source_id || null,
            meta.source_name || 'Uploaded Schema Files',
            meta.asset_id || null,
            meta.asset_name,
            meta.column_id || null,
            meta.column_name,
            meta.data_type,
            statistic,
            finalValue,
            Number(row.sample_size || 0),
            durationMs
          ]);
          savedRecord = fallbackRes.rows[0];
        } catch (fallbackErr) {
          logger.warn({ fallbackErr }, 'Failed to persist profiling result row to database');
        }
      }
    }

    return {
      resultId: savedRecord?.result_id || null,
      statistic,
      columnName: meta.column_name,
      dataType: meta.data_type,
      assetName: meta.asset_name,
      sourceName: meta.source_name || 'Uploaded Schema Files',
      result: finalValue,
      sampleSize: Number(row.sample_size || 0),
      executionDurationMs: durationMs,
      createdAt: savedRecord?.created_at ? new Date(savedRecord.created_at).toISOString() : new Date().toISOString(),
      // Automated insights and visualizations without AI
      assetProfile: fullProfile,
      summary: fullProfile?.summary || null,
      columnProfiles: fullProfile?.columnProfiles || [],
      isPopulated: true,
      totalRows: fullProfile?.totalRows ?? Number(row.sample_size || 0),
      totalColumns: fullProfile?.totalColumns ?? 1,
      tableQuality: fullProfile?.tableQuality || null,
      numericSummaries: fullProfile?.numericSummaries || [],
      categoricalSummaries: fullProfile?.categoricalSummaries || [],
      dateSummaries: fullProfile?.dateSummaries || [],
      insights: fullProfile?.insights || [],
      charts: fullProfile?.charts || []
    };
  } catch (err) {
    logger.error({ err, columnId, statistic }, 'Failed to execute catalog profiling query');
    throw new AppError(`Profiling query execution failed: ${err.message}`, 500, 'PROFILING_EXECUTION_FAILED');
  } finally {
    if (!dbClient) {
      client.release();
    }
  }
}

/**
 * Retrieve profiling run history for a project in reverse chronological order
 */
async function listProfilingHistory({ projectId, dbClient = null }) {
  const query = `
    SELECT
      cpr.result_id,
      cpr.project_id,
      cpr.user_id,
      cpr.source_id,
      cpr.source_name,
      cpr.asset_id,
      cpr.asset_name,
      cpr.column_id,
      cpr.column_name,
      cpr.data_type,
      cpr.statistic,
      cpr.result_value,
      cpr.sample_size,
      cpr.execution_duration_ms,
      cpr.created_at
    FROM public.catalog_profiling_result cpr
    WHERE cpr.project_id = $1
    ORDER BY cpr.created_at DESC;
  `;
  const client = dbClient || pool;
  const result = await client.query(query, [projectId]);
  return result.rows.map(row => ({
    resultId: row.result_id,
    result_id: row.result_id,
    projectId: row.project_id,
    project_id: row.project_id,
    userId: row.user_id,
    user_id: row.user_id,
    sourceId: row.source_id,
    source_id: row.source_id,
    sourceName: row.source_name,
    source_name: row.source_name,
    assetId: row.asset_id,
    asset_id: row.asset_id,
    assetName: row.asset_name,
    asset_name: row.asset_name,
    columnId: row.column_id,
    column_id: row.column_id,
    columnName: row.column_name,
    column_name: row.column_name,
    dataType: row.data_type,
    data_type: row.data_type,
    statistic: row.statistic,
    result: row.result_value !== null ? Number(row.result_value) : null,
    result_value: row.result_value !== null ? Number(row.result_value) : null,
    sampleSize: Number(row.sample_size || 0),
    sample_size: Number(row.sample_size || 0),
    executionDurationMs: row.execution_duration_ms,
    execution_duration_ms: row.execution_duration_ms,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null
  }));
}

/**
 * Retrieve a specific profiling history run with its complete profile, insights, and charts
 */
async function getProfilingHistoryItem({ projectId, resultId, dbClient = null }) {
  const client = dbClient || pool;
  const query = `
    SELECT
      cpr.result_id,
      cpr.project_id,
      cpr.user_id,
      cpr.source_id,
      cpr.source_name,
      cpr.asset_id,
      cpr.asset_name,
      cpr.column_id,
      cpr.column_name,
      cpr.data_type,
      cpr.statistic,
      cpr.result_value,
      cpr.sample_size,
      cpr.execution_duration_ms,
      cpr.profile_data,
      cpr.created_at
    FROM public.catalog_profiling_result cpr
    WHERE cpr.result_id = $1 AND cpr.project_id = $2;
  `;
  const result = await client.query(query, [resultId, projectId]);

  if (!result.rows.length) {
    throw new AppError('Profiling history item not found.', 404, 'HISTORY_ITEM_NOT_FOUND');
  }

  const row = result.rows[0];
  let fullProfile = row.profile_data;
  if (typeof fullProfile === 'string') {
    try {
      fullProfile = JSON.parse(fullProfile);
    } catch {
      fullProfile = null;
    }
  }

  // If profile_data is not stored (or an older run), generate on the fly
  if (!fullProfile && row.asset_id) {
    try {
      fullProfile = await profileAssetData({
        projectId: row.project_id,
        assetId: row.asset_id,
        columnId: row.column_id,
        targetColumnName: row.column_name,
        statistic: row.statistic,
        targetResultValue: row.result_value !== null ? Number(row.result_value) : null,
        dbClient: client
      });
      if (fullProfile) {
        client.query(
          'UPDATE public.catalog_profiling_result SET profile_data = $1 WHERE result_id = $2',
          [JSON.stringify(fullProfile), row.result_id]
        ).catch(() => {});
      }
    } catch (calcErr) {
      logger.warn({ calcErr: calcErr.message }, 'Failed to compute profile on-the-fly for history item');
    }
  }

  return {
    resultId: row.result_id,
    result_id: row.result_id,
    projectId: row.project_id,
    project_id: row.project_id,
    userId: row.user_id,
    user_id: row.user_id,
    sourceId: row.source_id,
    source_id: row.source_id,
    sourceName: row.source_name || 'Uploaded Schema Files',
    source_name: row.source_name || 'Uploaded Schema Files',
    assetId: row.asset_id,
    asset_id: row.asset_id,
    assetName: row.asset_name,
    asset_name: row.asset_name,
    columnId: row.column_id,
    column_id: row.column_id,
    columnName: row.column_name,
    column_name: row.column_name,
    dataType: row.data_type,
    data_type: row.data_type,
    statistic: row.statistic,
    result: row.result_value !== null ? Number(row.result_value) : null,
    result_value: row.result_value !== null ? Number(row.result_value) : null,
    sampleSize: Number(row.sample_size || 0),
    sample_size: Number(row.sample_size || 0),
    executionDurationMs: row.execution_duration_ms,
    execution_duration_ms: row.execution_duration_ms,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    isHistorical: true,
    // Automated insights and visualizations
    assetProfile: fullProfile,
    summary: fullProfile?.summary || null,
    columnProfiles: fullProfile?.columnProfiles || [],
    isPopulated: true,
    totalRows: fullProfile?.totalRows ?? Number(row.sample_size || 0),
    totalColumns: fullProfile?.totalColumns ?? 1,
    tableQuality: fullProfile?.tableQuality || null,
    numericSummaries: fullProfile?.numericSummaries || [],
    categoricalSummaries: fullProfile?.categoricalSummaries || [],
    dateSummaries: fullProfile?.dateSummaries || [],
    insights: fullProfile?.insights || [],
    charts: fullProfile?.charts || []
  };
}

module.exports = {
  syncProjectSchemasToCatalog,
  listCatalogSources,
  listCatalogAssets,
  listCatalogColumns,
  runProfileStatistic,
  profileAssetData,
  listProfilingHistory,
  getProfilingHistoryItem
};


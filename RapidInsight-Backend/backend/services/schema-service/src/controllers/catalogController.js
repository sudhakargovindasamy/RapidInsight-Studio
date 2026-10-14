const AppError = require('../errors/AppError');
const { createSupabaseClient } = require('../config/supabase');
const getAccessTokenFromRequest = require('../utils/getAccessTokenFromRequest');
const { getProjectForEmployee } = require('../services/projectAccessService');
const {
  syncProjectSchemasToCatalog,
  listCatalogSources,
  listCatalogAssets,
  listCatalogColumns,
  runProfileStatistic,
  profileAssetData,
  listProfilingHistory,
  getProfilingHistoryItem
} = require('../services/catalogProfilingService');

function getSupabase(req) {
  const accessToken = getAccessTokenFromRequest(req);
  return createSupabaseClient(accessToken);
}

async function getSources(req, res, next) {
  try {
    const projectId = req.query.projectId || req.query.project_id;
    const supabase = getSupabase(req);

    // Enforce project authorization
    const project = await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const loadedOnly = req.query.loadedOnly === 'true' || req.query.loadedOnly === true || req.query.loaded_only === 'true';
    const sources = await listCatalogSources({ projectId, project, userId: req.user?.id, supabase, loadedOnly });
    return res.status(200).json({
      success: true,
      count: sources.length,
      data: sources,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function getAssets(req, res, next) {
  try {
    const projectId = req.query.projectId || req.query.project_id;
    const sourceId = req.query.sourceId || req.query.source_id;
    const supabase = getSupabase(req);

    // Enforce project authorization
    const project = await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    await syncProjectSchemasToCatalog({ project, projectId, userId: req.user?.id, supabase });

    const assets = await listCatalogAssets({ projectId, sourceId });
    return res.status(200).json({
      success: true,
      count: assets.length,
      data: assets,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function getColumns(req, res, next) {
  try {
    const projectId = req.query.projectId || req.query.project_id;
    const assetId = req.query.assetId || req.query.asset_id;
    const supabase = getSupabase(req);

    // Enforce project authorization
    await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const columns = await listCatalogColumns({ projectId, assetId });
    return res.status(200).json({
      success: true,
      count: columns.length,
      data: columns,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function profileStat(req, res, next) {
  try {
    const projectId = req.body.projectId || req.body.project_id;
    const assetId = req.body.assetId || req.body.asset_id;
    const columnId = req.body.columnId || req.body.column_id;
    const statistic = req.body.statistic;
    const supabase = getSupabase(req);

    // Enforce project authorization
    await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    let result;
    if (columnId && statistic) {
      result = await runProfileStatistic({
        projectId,
        columnId,
        statistic,
        userId: req.user?.id
      });
    } else if (assetId) {
      result = await profileAssetData({
        projectId,
        assetId,
        userId: req.user?.id
      });
    } else {
      throw new AppError('Either assetId or columnId and statistic must be provided.', 400, 'PARAM_REQUIRED');
    }

    return res.status(200).json({
      success: true,
      data: result,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function getProfilingHistory(req, res, next) {
  try {
    const projectId = req.query.projectId || req.query.project_id;
    const supabase = getSupabase(req);

    // Enforce project authorization
    await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const history = await listProfilingHistory({ projectId });
    return res.status(200).json({
      success: true,
      count: history.length,
      data: history,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function getProfilingHistoryItemHandler(req, res, next) {
  try {
    const { resultId } = req.params;
    const projectId = req.query.projectId || req.query.project_id;
    const supabase = getSupabase(req);

    if (!projectId) {
      throw new AppError('projectId query parameter is required.', 400, 'PARAM_REQUIRED');
    }
    if (!resultId) {
      throw new AppError('resultId parameter is required.', 400, 'PARAM_REQUIRED');
    }

    // Enforce project authorization
    await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const item = await getProfilingHistoryItem({ projectId, resultId });
    return res.status(200).json({
      success: true,
      data: item,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

const { registerAssetMetadata } = require('../services/assetRegistrationService');
const {
  ingestFileIntoAsset,
  ingestMockDataIntoAsset,
  ingestDatabaseIntoAsset
} = require('../services/assetIngestionService');

async function registerAsset(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projectId = req.body.projectId || req.body.project_id;
    const project = await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const result = await registerAssetMetadata({
      project,
      userId: req.user.id,
      payload: req.body
    });

    return res.status(201).json({
      success: true,
      message: `Asset "${result.assetName}" registered successfully with ${result.columnCount} columns.`,
      data: result,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function ingestFileHandler(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projectId = req.body.projectId || req.query.projectId;
    const assetId = req.params.assetId;

    if (!req.file) {
      throw new AppError('A valid data file is required for ingestion.', 400, 'FILE_REQUIRED');
    }

    const project = await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const result = await ingestFileIntoAsset({
      project,
      userId: req.user?.id,
      assetId,
      fileBuffer: req.file.buffer,
      originalFileName: req.file.originalname
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function ingestMockHandler(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projectId = req.body.projectId;
    const assetId = req.params.assetId;
    const rowCount = req.body.rowCount || 100;

    const project = await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const result = await ingestMockDataIntoAsset({
      project,
      userId: req.user?.id,
      assetId,
      rowCount
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function ingestDatabaseHandler(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const { projectId, connectionConfig, sourceSchema, sourceTable, columnMapping, limit } = req.body;
    const assetId = req.params.assetId;

    const project = await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const result = await ingestDatabaseIntoAsset({
      project,
      userId: req.user?.id,
      assetId,
      connectionConfig,
      sourceSchema: sourceSchema || 'public',
      sourceTable,
      columnMapping: columnMapping || {},
      limit: limit || 500
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: result.message,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getSources,
  getAssets,
  getColumns,
  profileStat,
  getProfilingHistory,
  getProfilingHistoryItemHandler,
  registerAsset,
  ingestFileHandler,
  ingestMockHandler,
  ingestDatabaseHandler
};


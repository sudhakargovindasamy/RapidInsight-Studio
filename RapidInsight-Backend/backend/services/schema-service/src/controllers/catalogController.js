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
  listProfilingHistory
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

    const sources = await listCatalogSources({ projectId, project, userId: req.user?.id, supabase });
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
    const columnId = req.body.columnId || req.body.column_id;
    const statistic = req.body.statistic;
    const supabase = getSupabase(req);

    // Enforce project authorization
    await getProjectForEmployee({ supabase, projectId, userId: req.user?.id });

    const result = await runProfileStatistic({
      projectId,
      columnId,
      statistic,
      userId: req.user?.id
    });

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

const { registerAssetMetadata } = require('../services/assetRegistrationService');

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

module.exports = {
  getSources,
  getAssets,
  getColumns,
  profileStat,
  getProfilingHistory,
  registerAsset
};


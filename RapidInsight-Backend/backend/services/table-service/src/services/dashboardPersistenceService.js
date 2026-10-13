const { supabaseAdmin } = require('../config/supabase');

const DASHBOARD_COLUMNS = [
  'id',
  'project_id',
  'created_by',
  'status',
  'config',
  'report_data',
  'report_status',
  'error_message',
  'generated_at',
  'created_at',
  'updated_at'
].join(', ');

async function upsertDashboard({
  supabase,
  projectId,
  userId,
  config = {},
  reportData = {},
  reportStatus,
  errorMessage = null,
  generatedAt = null
}) {
  const payload = {
    project_id: projectId,
    created_by: userId,
    status: 'active',
    config,
    report_data: reportData,
    report_status: reportStatus,
    error_message: errorMessage,
    generated_at: generatedAt,
    updated_at: new Date().toISOString()
  };

  const client = supabase || supabaseAdmin;
  const { data, error } = await client
    .from('dashboards')
    .upsert(payload, { onConflict: 'project_id' })
    .select(DASHBOARD_COLUMNS)
    .single();

  if (error) throw new Error(error.message || 'Failed to save dashboard report.');
  return data;
}

async function markDashboardGenerating({ supabase, projectId, userId, config }) {
  return upsertDashboard({
    supabase,
    projectId,
    userId,
    config,
    reportData: {},
    reportStatus: 'generating',
    errorMessage: null,
    generatedAt: null
  });
}

async function markDashboardReady({ supabase, projectId, userId, config, reportData }) {
  return upsertDashboard({
    supabase,
    projectId,
    userId,
    config,
    reportData,
    reportStatus: 'ready',
    errorMessage: null,
    generatedAt: new Date().toISOString()
  });
}

async function markDashboardFailed({ supabase, projectId, userId, config, errorMessage }) {
  return upsertDashboard({
    supabase,
    projectId,
    userId,
    config: config || {},
    reportData: {},
    reportStatus: 'failed',
    errorMessage: String(errorMessage || 'Report generation failed.').slice(0, 2000),
    generatedAt: null
  });
}

module.exports = {
  upsertDashboard,
  markDashboardGenerating,
  markDashboardReady,
  markDashboardFailed
};

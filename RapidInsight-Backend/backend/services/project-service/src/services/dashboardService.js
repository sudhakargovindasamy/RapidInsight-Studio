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

async function ensureDashboardForProject({ supabase, projectId, userId }) {
  const { data: existing, error: findError } = await supabase
    .from('dashboards')
    .select(DASHBOARD_COLUMNS)
    .eq('project_id', projectId)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  const { data: created, error: createError } = await supabase
    .from('dashboards')
    .insert({
      project_id: projectId,
      created_by: userId,
      status: 'active',
      config: {},
      report_data: {},
      report_status: 'pending',
      error_message: null,
      generated_at: null
    })
    .select(DASHBOARD_COLUMNS)
    .single();

  if (!createError) return created;

  const duplicate =
    createError.code === '23505' ||
    String(createError.message || '').toLowerCase().includes('duplicate');

  if (!duplicate) throw createError;

  const { data: raceWinner, error: raceError } = await supabase
    .from('dashboards')
    .select(DASHBOARD_COLUMNS)
    .eq('project_id', projectId)
    .single();

  if (raceError) throw raceError;
  return raceWinner;
}

module.exports = {
  DASHBOARD_COLUMNS,
  ensureDashboardForProject
};
async function upsertProjectDataModel({
  supabase,
  projectId,
  userId,
  status,
  modelJson,
  lastStep,
  errorMessage = null
}) {
  const { data, error } = await supabase
    .from('project_data_models')
    .upsert(
      {
        project_id: projectId,
        created_by: userId,
        status,
        model_json: modelJson || {},
        last_step: lastStep || null,
        error_message: errorMessage,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: 'project_id'
      }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to save project data model.');
  }

  return data;
}

async function updateProjectDataModelStatus({
  supabase,
  projectId,
  status,
  lastStep,
  errorMessage = null
}) {
  const { data, error } = await supabase
    .from('project_data_models')
    .update({
      status,
      last_step: lastStep || null,
      error_message: errorMessage,
      updated_at: new Date().toISOString()
    })
    .eq('project_id', projectId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to update project data model status.');
  }

  return data;
}

async function getProjectDataModel({
  supabase,
  projectId
}) {
  const { data, error } = await supabase
    .from('project_data_models')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to get project data model.');
  }

  return data || null;
}

module.exports = {
  upsertProjectDataModel,
  updateProjectDataModelStatus,
  getProjectDataModel
};

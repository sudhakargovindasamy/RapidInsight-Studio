async function getProjectForEmployee({ supabase, projectId, userId }) {
  if (!projectId) {
    const error = new Error('project_id is required.');
    error.statusCode = 400;
    throw error;
  }

  let query = supabase
    .from('projects')
    .select('id, organisation_id, created_by, name, status, physical_schema_name, schema_status, created_at, updated_at')
    .eq('id', projectId);

  if (userId) {
    query = query.eq('created_by', userId);
  }

  const { data: project, error } = await query.maybeSingle();

  if (error) throw error;

  if (!project) {
    const notFound = new Error('Project not found.');
    notFound.statusCode = 404;
    throw notFound;
  }

  if (userId && project.created_by !== userId) {
    const forbidden = new Error('Access denied to project.');
    forbidden.statusCode = 403;
    throw forbidden;
  }

  if (!project.physical_schema_name) {
    const invalid = new Error('Project physical schema is not ready.');
    invalid.statusCode = 409;
    throw invalid;
  }

  return project;
}

module.exports = { getProjectForEmployee };
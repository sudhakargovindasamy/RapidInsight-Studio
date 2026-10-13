const pool = require('../config/postgres');
const { quoteIdentifier, buildProjectSchemaName } = require('../utils/identifierNaming');

async function isSchemaInUse(schemaName, excludeProjectId) {
  const client = await pool.connect();
  try {
    const projCheck = await client.query(
      `SELECT id FROM public.projects WHERE physical_schema_name = $1 AND id <> $2 LIMIT 1`,
      [schemaName, excludeProjectId]
    );
    if (projCheck.rows.length > 0) return true;

    const tableCheck = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 LIMIT 1`,
      [schemaName]
    );
    if (tableCheck.rows.length > 0) return true;

    return false;
  } finally {
    client.release();
  }
}

async function createPhysicalProjectSchema(schemaName) {
  const client = await pool.connect();

  try {
    await client.query(`create schema if not exists ${quoteIdentifier(schemaName)}`);
  } finally {
    client.release();
  }
}

async function enrichProjects({ supabase, projects }) {
  if (!projects.length) return [];

  const organisationIds = [...new Set(projects.map((p) => p.organisation_id).filter(Boolean))];
  const creatorIds = [...new Set(projects.map((p) => p.created_by).filter(Boolean))];

  const { data: organisations, error: orgError } = await supabase
    .from('organisations')
    .select('id, name, normalized_name')
    .in('id', organisationIds.length ? organisationIds : ['00000000-0000-0000-0000-000000000000']);

  if (orgError) throw orgError;

  const { data: creators, error: creatorError } = await supabase
    .from('profiles')
    .select('auth_user_id, username, email')
    .in('auth_user_id', creatorIds.length ? creatorIds : ['00000000-0000-0000-0000-000000000000']);

  if (creatorError) throw creatorError;

  const orgMap = new Map((organisations || []).map((o) => [o.id, o]));
  const creatorMap = new Map((creators || []).map((c) => [c.auth_user_id, c]));

  return projects.map((project) => ({
    ...project,
    organisation: orgMap.get(project.organisation_id) || null,
    creator: creatorMap.get(project.created_by) || null
  }));
}

async function listAllProjects({ supabase, userId }) {
  let query = supabase
    .from('projects')
    .select('id, organisation_id, created_by, name, description, status, slug, physical_schema_name, schema_status, schema_created_at, created_at, updated_at')
    .order('created_at', { ascending: false });

  if (userId) {
    query = query.eq('created_by', userId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return enrichProjects({ supabase, projects: data || [] });
}

async function getProjectById({ supabase, projectId, userId }) {
  let query = supabase
    .from('projects')
    .select('id, organisation_id, created_by, name, description, status, slug, physical_schema_name, schema_status, schema_created_at, created_at, updated_at')
    .eq('id', projectId);

  if (userId) {
    query = query.eq('created_by', userId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  if (!data) {
    const notFound = new Error('Project not found.');
    notFound.statusCode = 404;
    throw notFound;
  }

  const enriched = await enrichProjects({ supabase, projects: [data] });
  return enriched[0];
}

async function createProject({ supabase, userId, organisation, name, description }) {
  const cleanName = String(name || '').trim();
  const cleanDescription = String(description || '').trim() || null;

  if (!cleanName) {
    const error = new Error('Project Name is required.');
    error.statusCode = 400;
    throw error;
  }

  if (cleanName.length > 120) {
    const error = new Error('Project Name must be 120 characters or less.');
    error.statusCode = 400;
    throw error;
  }

  const { data: project, error: insertError } = await supabase
    .from('projects')
    .insert({
      organisation_id: organisation.id,
      created_by: userId,
      name: cleanName,
      description: cleanDescription,
      status: 'active',
      schema_status: 'creating'
    })
    .select('id, organisation_id, created_by, name, description, status, slug, physical_schema_name, schema_status, schema_created_at, created_at, updated_at')
    .single();

  if (insertError) throw insertError;

  let physicalSchemaName = buildProjectSchemaName({
    organisationName: organisation.name,
    projectName: project.name
  });

  const inUse = await isSchemaInUse(physicalSchemaName, project.id);
  if (inUse) {
    const suffix = project.id.replace(/-/g, '').slice(0, 8);
    physicalSchemaName = `${physicalSchemaName.slice(0, 54)}_${suffix}`;
  }

  try {
    await createPhysicalProjectSchema(physicalSchemaName);

    const { data: updated, error: updateError } = await supabase
      .from('projects')
      .update({
        physical_schema_name: physicalSchemaName,
        schema_status: 'ready',
        schema_created_at: new Date().toISOString()
      })
      .eq('id', project.id)
      .select('id, organisation_id, created_by, name, description, status, slug, physical_schema_name, schema_status, schema_created_at, created_at, updated_at')
      .single();

    if (updateError) throw updateError;

    return updated;
  } catch (error) {
    await supabase.from('projects').delete().eq('id', project.id);
    throw error;
  }
}

module.exports = {
  listAllProjects,
  getProjectById,
  createProject
};
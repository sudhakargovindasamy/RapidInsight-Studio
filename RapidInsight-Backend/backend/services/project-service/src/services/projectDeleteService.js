const pool = require('../config/postgres');
const { quoteIdentifier } = require('../utils/identifierNaming');

function getDeletedCount({ data, count }) {
  if (typeof count === 'number') return count;
  if (Array.isArray(data)) return data.length;
  return 0;
}

async function getProjectMetadata({ supabase, projectId }) {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const notFound = new Error('Project not found.');
    notFound.statusCode = 404;
    throw notFound;
  }

  return data;
}

async function getSchemasForProject({ supabase, projectId }) {
  const { data, error } = await supabase
    .from('schemas')
    .select('id, storage_bucket, storage_path, seed_storage_path')
    .eq('project_id', projectId);

  if (error) throw error;

  return data || [];
}

async function deleteSchemaFiles({ supabase, schemas }) {
  let deletedCount = 0;

  for (const schema of schemas) {
    const paths = [schema.storage_path, schema.seed_storage_path].filter(Boolean);
    if (!schema.storage_bucket || !paths.length) continue;

    const { error } = await supabase.storage.from(schema.storage_bucket).remove(paths);

    if (error) {
      // A storage file that can't be removed shouldn't block the rest of the
      // project delete - it's an orphaned, harmless, recoverable object.
      console.warn(
        `Failed to delete storage files for schema ${schema.id}: ${error.message}`
      );
      continue;
    }

    deletedCount += paths.length;
  }

  return deletedCount;
}

async function deleteGeneratedTablesForProject({ supabase, projectId }) {
  const { data, error, count } = await supabase
    .from('generated_tables')
    .delete({ count: 'exact' })
    .eq('project_id', projectId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete generated table metadata.');
  }

  return getDeletedCount({ data, count });
}

async function deleteDashboardsForProject({ supabase, projectId }) {
  const { data, error, count } = await supabase
    .from('dashboards')
    .delete({ count: 'exact' })
    .eq('project_id', projectId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete project dashboard.');
  }

  return getDeletedCount({ data, count });
}

async function deleteDataModelsForProject({ supabase, projectId }) {
  const { data, error, count } = await supabase
    .from('project_data_models')
    .delete({ count: 'exact' })
    .eq('project_id', projectId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete project data model.');
  }

  return getDeletedCount({ data, count });
}

async function deleteSchemasForProject({ supabase, projectId }) {
  const { data, error, count } = await supabase
    .from('schemas')
    .delete({ count: 'exact' })
    .eq('project_id', projectId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete schema metadata.');
  }

  return getDeletedCount({ data, count });
}

async function dropPhysicalProjectSchema(physicalSchemaName) {
  if (!physicalSchemaName) return false;

  const client = await pool.connect();

  try {
    await client.query(`drop schema if exists ${quoteIdentifier(physicalSchemaName)} cascade`);
    return true;
  } finally {
    client.release();
  }
}

async function deleteProjectRow({ supabase, projectId }) {
  const { data, error, count } = await supabase
    .from('projects')
    .delete({ count: 'exact' })
    .eq('id', projectId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete project.');
  }

  const deletedCount = getDeletedCount({ data, count });

  if (deletedCount < 1) {
    const deletionError = new Error(
      'Project deletion failed. The project row still exists or delete permission is blocked.'
    );
    deletionError.statusCode = 500;
    throw deletionError;
  }

  return deletedCount;
}

async function assertProjectDeleted({ supabase, projectId }) {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    const verificationError = new Error(
      'Project deletion verification failed. Project metadata still exists after delete.'
    );
    verificationError.statusCode = 500;
    throw verificationError;
  }

  return true;
}

async function deleteProjectCompletely({ supabase, projectId }) {
  const project = await getProjectMetadata({ supabase, projectId });

  const schemas = await getSchemasForProject({ supabase, projectId });

  const storageFilesDeleted = await deleteSchemaFiles({ supabase, schemas });

  const generatedTablesDeleted = await deleteGeneratedTablesForProject({
    supabase,
    projectId
  });

  const dashboardsDeleted = await deleteDashboardsForProject({ supabase, projectId });

  const dataModelsDeleted = await deleteDataModelsForProject({ supabase, projectId });

  const schemasDeleted = await deleteSchemasForProject({ supabase, projectId });

  const physicalSchemaDropped = await dropPhysicalProjectSchema(project.physical_schema_name);

  const projectDeleted = await deleteProjectRow({ supabase, projectId });

  await assertProjectDeleted({ supabase, projectId });

  return {
    project_id: projectId,
    physical_schema_name: project.physical_schema_name || null,
    physical_schema_dropped: physicalSchemaDropped,
    storage_files_deleted: storageFilesDeleted,
    generated_tables_deleted: generatedTablesDeleted,
    dashboards_deleted: dashboardsDeleted,
    project_data_models_deleted: dataModelsDeleted,
    schemas_deleted: schemasDeleted,
    project_deleted: projectDeleted
  };
}

module.exports = {
  deleteProjectCompletely
};

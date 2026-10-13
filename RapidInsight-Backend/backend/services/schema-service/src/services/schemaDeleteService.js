const pool = require('../config/db');

function assertSafeIdentifier(identifier) {
  if (!identifier || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
}

function quoteIdentifier(identifier) {
  assertSafeIdentifier(identifier);
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualifiedIdentifier(schemaName, tableName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

function getDeletedCount({ data, count }) {
  if (typeof count === 'number') return count;
  if (Array.isArray(data)) return data.length;
  return 0;
}

async function getSchemaMetadata({ supabase, schemaId }) {
  const { data, error } = await supabase
    .from('schemas')
    .select('*')
    .eq('id', schemaId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const notFound = new Error('Schema not found.');
    notFound.statusCode = 404;
    throw notFound;
  }

  return data;
}

async function getGeneratedTableMetadata({ supabase, schemaId }) {
  const { data, error } = await supabase
    .from('generated_tables')
    .select('*')
    .eq('schema_id', schemaId)
    .maybeSingle();

  if (error) throw error;

  return data || null;
}

async function dropPhysicalTableIfExists({ generatedTable, schema }) {
  const schemaName =
    generatedTable?.physical_schema_name ||
    schema.physical_schema_name;

  const tableName =
    generatedTable?.physical_table_name ||
    schema.physical_table_name;

  if (!schemaName || !tableName) return false;

  const client = await pool.connect();

  try {
    await client.query(
      `drop table if exists ${quoteQualifiedIdentifier(schemaName, tableName)} cascade`
    );

    return true;
  } finally {
    client.release();
  }
}

async function deleteSchemaFile({ supabase, schema }) {
  if (!schema.storage_bucket || !schema.storage_path) return false;

  const { error } = await supabase.storage
    .from(schema.storage_bucket)
    .remove([schema.storage_path]);

  if (error) {
    throw new Error(error.message || 'Failed to delete schema file from storage.');
  }

  return true;
}

/*
 * Seed rows are derived data, so they die with the schema they describe.
 * Leaving them behind would also mean a re-upload of the same file could pick
 * up examples generated for a different version of it.
 */
async function deleteSeedRowsFile({ supabase, schema }) {
  if (!schema.storage_bucket || !schema.seed_storage_path) return false;

  const { error } = await supabase.storage
    .from(schema.storage_bucket)
    .remove([schema.seed_storage_path]);

  if (error) {
    // Losing the schema because a derived file could not be removed is the
    // wrong trade. The orphaned file is harmless and recoverable.
    console.warn(
      `Failed to delete seed rows file for schema ${schema.id}: ${error.message}`
    );

    return false;
  }

  return true;
}

async function deleteGeneratedTableMetadata({ supabase, schemaId }) {
  const { data, error, count } = await supabase
    .from('generated_tables')
    .delete({ count: 'exact' })
    .eq('schema_id', schemaId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete generated table metadata.');
  }

  return getDeletedCount({ data, count });
}

async function deleteProjectDataModelForProject({ supabase, projectId }) {
  if (!projectId) return 0;

  const { data, error, count } = await supabase
    .from('project_data_models')
    .delete({ count: 'exact' })
    .eq('project_id', projectId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete stale project data model.');
  }

  return getDeletedCount({ data, count });
}

async function deleteSchemaMetadata({ supabase, schemaId }) {
  const { data, error, count } = await supabase
    .from('schemas')
    .delete({ count: 'exact' })
    .eq('id', schemaId)
    .select('id');

  if (error) {
    throw new Error(error.message || 'Failed to delete schema metadata.');
  }

  const deletedCount = getDeletedCount({ data, count });

  if (deletedCount < 1) {
    const deletionError = new Error(
      'Schema metadata was not deleted. The schema row still exists or delete permission is blocked.'
    );
    deletionError.statusCode = 500;
    throw deletionError;
  }

  return deletedCount;
}

async function assertSchemaMetadataDeleted({ supabase, schemaId }) {
  const { data, error } = await supabase
    .from('schemas')
    .select('id')
    .eq('id', schemaId)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    const verificationError = new Error(
      'Schema deletion verification failed. Schema metadata still exists after delete.'
    );
    verificationError.statusCode = 500;
    throw verificationError;
  }

  return true;
}

async function deleteSchemaCompletely({ supabase, schemaId }) {
  const schema = await getSchemaMetadata({
    supabase,
    schemaId
  });

  const generatedTable = await getGeneratedTableMetadata({
    supabase,
    schemaId
  });

  const physicalTableDropped = await dropPhysicalTableIfExists({
    generatedTable,
    schema
  });

  const generatedTablesDeleted = await deleteGeneratedTableMetadata({
    supabase,
    schemaId
  });

  const fileDeleted = await deleteSchemaFile({
    supabase,
    schema
  });

  const seedFileDeleted = await deleteSeedRowsFile({
    supabase,
    schema
  });

  const projectDataModelsDeleted = await deleteProjectDataModelForProject({
    supabase,
    projectId: schema.project_id
  });

  const schemaMetadataDeleted = await deleteSchemaMetadata({
    supabase,
    schemaId
  });

  await assertSchemaMetadataDeleted({
    supabase,
    schemaId
  });

  return {
    schema_id: schemaId,
    project_id: schema.project_id,
    generated_table_id: generatedTable?.id || null,
    physical_table_dropped: physicalTableDropped,
    storage_file_deleted: fileDeleted,
    seed_rows_file_deleted: seedFileDeleted,
    generated_tables_deleted: generatedTablesDeleted,
    project_data_models_deleted: projectDataModelsDeleted,
    schema_metadata_deleted: schemaMetadataDeleted
  };
}

module.exports = {
  deleteSchemaCompletely
};
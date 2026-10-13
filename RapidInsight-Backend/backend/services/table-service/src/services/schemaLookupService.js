async function getSchemaBundle({ supabase, schemaId }) {
  const { data: schema, error } = await supabase
    .from('schemas')
    .select('id, project_id, user_id, original_file_name, display_name, storage_bucket, storage_path, file_type, status, field_count, table_status, generated_table_id, physical_schema_name, sanitized_table_name, created_at, updated_at')
    .eq('id', schemaId)
    .maybeSingle();

  if (error) throw error;

  if (!schema) {
    const notFound = new Error('Schema metadata not found.');
    notFound.statusCode = 404;
    throw notFound;
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, organisation_id, created_by, name, status, physical_schema_name, schema_status')
    .eq('id', schema.project_id)
    .maybeSingle();

  if (projectError) throw projectError;

  if (!project) {
    const notFound = new Error('Project not found for schema.');
    notFound.statusCode = 404;
    throw notFound;
  }

  const { data: fileData, error: downloadError } = await supabase.storage
    .from(schema.storage_bucket)
    .download(schema.storage_path);

  if (downloadError) throw downloadError;

  const schemaDefinition = JSON.parse(await fileData.text());

  return {
    schema,
    project,
    schemaDefinition
  };
}

async function getGeneratedTableById({ supabase, generatedTableId }) {
  const { data, error } = await supabase
    .from('generated_tables')
    .select('id, schema_id, project_id, created_by, physical_schema_name, physical_table_name, row_count, status, version, source_file_name, created_at, updated_at')
    .eq('id', generatedTableId)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const notFound = new Error('Generated table not found.');
    notFound.statusCode = 404;
    throw notFound;
  }

  return data;
}

module.exports = {
  getSchemaBundle,
  getGeneratedTableById
};
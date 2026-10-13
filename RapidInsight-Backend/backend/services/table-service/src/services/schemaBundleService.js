// Extracted out of projectGenerateTablesService.js so that both it and
// sqlKpiExecutionService.js can load a project's schema bundles without
// requiring each other - projectGenerateTablesService.js now calls into
// sqlKpiExecutionService.js for dashboard generation, so having the reverse
// require too would create a circular dependency.

async function fetchSchemasForProject({ supabase, projectId }) {
  const { data, error } = await supabase
    .from('schemas')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  return data || [];
}

async function downloadSchemaDefinition({ supabase, schema }) {
  const { data, error } = await supabase.storage
    .from(schema.storage_bucket || 'schemas')
    .download(schema.storage_path);

  if (error || !data) {
    throw new Error(error?.message || `Failed to download schema file ${schema.original_file_name}.`);
  }

  return JSON.parse(await data.text());
}

/*
 * The example rows SDV learns this table's shape from, written when the schema
 * was uploaded.
 *
 * Missing seeds are not an error here - a schema uploaded with "Use my data"
 * legitimately has none, and the caller decides whether this particular table
 * needed them.
 */
async function downloadSeedRows({ supabase, schema }) {
  if (!schema.seed_storage_path) return null;

  const { data, error } = await supabase.storage
    .from(schema.storage_bucket || 'schemas')
    .download(schema.seed_storage_path);

  if (error || !data) {
    console.warn(
      `Seed rows could not be read for ${schema.original_file_name}: ${error?.message || 'not found'}`
    );

    return null;
  }

  try {
    const parsed = JSON.parse(await data.text());

    return Array.isArray(parsed) ? { rows: parsed } : parsed;
  } catch (parseError) {
    console.warn(
      `Seed rows for ${schema.original_file_name} were not valid JSON: ${parseError.message}`
    );

    return null;
  }
}

async function loadSchemaBundles({ supabase, projectId }) {
  const schemas = await fetchSchemasForProject({
    supabase,
    projectId
  });

  if (!schemas.length) {
    const error = new Error('Please upload at least one schema before generating tables.');
    error.statusCode = 400;
    throw error;
  }

  const bundles = [];

  for (const schema of schemas) {
    const schemaDefinition = await downloadSchemaDefinition({
      supabase,
      schema
    });

    const seedRows = await downloadSeedRows({
      supabase,
      schema
    });

    bundles.push({
      schema,
      schemaDefinition,
      seedRows
    });
  }

  return bundles;
}

module.exports = {
  fetchSchemasForProject,
  downloadSchemaDefinition,
  downloadSeedRows,
  loadSchemaBundles
};

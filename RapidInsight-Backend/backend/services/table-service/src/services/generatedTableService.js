const pool = require('../config/postgres');
const { buildPhysicalTableName } = require('../utils/identifierNaming');
const { buildCreateTableSql } = require('./tableSqlBuilder');

async function buildTableFromSchema({ supabase, schema, project, schemaDefinition, userId }) {
  const { data: existing, error: existingError } = await supabase
    .from('generated_tables')
    .select('id, schema_id, project_id, created_by, physical_schema_name, physical_table_name, row_count, status, version, source_file_name, created_at, updated_at')
    .eq('schema_id', schema.id)
    .maybeSingle();

  if (existingError) throw existingError;

  if (existing) {
    return existing;
  }

  const physicalSchemaName = project.physical_schema_name || schema.physical_schema_name || 'public';
  const physicalTableName = buildPhysicalTableName({
    schemaId: schema.id,
    sourceName: schema.sanitized_table_name || schema.original_file_name
  });

  const createSql = buildCreateTableSql({
    schemaName: physicalSchemaName,
    tableName: physicalTableName,
    schemaDefinition
  });

  const client = await pool.connect();

  try {
    await client.query(createSql);
  } finally {
    client.release();
  }

  const { data: generatedTable, error: insertError } = await supabase
    .from('generated_tables')
    .insert({
      schema_id: schema.id,
      project_id: project.id,
      created_by: userId,
      physical_schema_name: physicalSchemaName,
      physical_table_name: physicalTableName,
      row_count: 0,
      status: 'CREATED',
      version: 1,
      source_file_name: schema.original_file_name
    })
    .select('id, schema_id, project_id, created_by, physical_schema_name, physical_table_name, row_count, status, version, source_file_name, created_at, updated_at')
    .single();

  if (insertError) throw insertError;

  await supabase
    .from('schemas')
    .update({
      table_status: 'BUILT',
      generated_table_id: generatedTable.id,
      physical_schema_name: physicalSchemaName
    })
    .eq('id', schema.id);

  return generatedTable;
}

module.exports = { buildTableFromSchema };
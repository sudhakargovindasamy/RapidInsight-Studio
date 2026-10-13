const axios = require('axios');
const createUserSupabaseClient = require('../config/createUserSupabaseClient');
const { insertRows } = require('./rowInsertService');
const { countRows } = require('./physicalTableService');

const DATAGEN_SERVICE_URL = process.env.DATAGEN_SERVICE_URL || 'http://localhost:3002';
const MAX_ROW_COUNT = 10000;
const DEFAULT_ROW_COUNT = 50;

function normalizeRowCount(value) {
  const parsed = Number(value || DEFAULT_ROW_COUNT);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_ROW_COUNT;
  }

  return Math.min(Math.floor(parsed), MAX_ROW_COUNT);
}

async function getGeneratedTableMetadata({ supabase, generatedTableId }) {
  const { data, error } = await supabase
    .from('generated_tables')
    .select('*')
    .eq('id', generatedTableId)
    .single();

  if (error || !data) {
    const notFoundError = new Error(error?.message || 'Generated table metadata not found');
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  return data;
}

async function getSchemaMetadata({ supabase, schemaId }) {
  const { data, error } = await supabase
    .from('schemas')
    .select('id, storage_bucket, storage_path, original_file_name, file_type, field_count, status')
    .eq('id', schemaId)
    .single();

  if (error || !data) {
    const notFoundError = new Error(error?.message || 'Schema metadata not found');
    notFoundError.statusCode = 404;
    throw notFoundError;
  }

  return data;
}

async function downloadSchemaDefinition({ supabase, schemaMetadata }) {
  const { data, error } = await supabase.storage
    .from(schemaMetadata.storage_bucket || 'schemas')
    .download(schemaMetadata.storage_path);

  if (error || !data) {
    throw new Error(error?.message || 'Failed to download schema definition');
  }

  const text = await data.text();
  return JSON.parse(text);
}

async function callDatagenService({ accessToken, userId, schemaDefinition, rowCount }) {
  const response = await axios.post(
    `${DATAGEN_SERVICE_URL}/datagen/generate`,
    { schemaDefinition, rowCount },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-user-id': userId,
        'x-user-email': '',
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY,
      },
      timeout: 60_000,
    }
  );

  const rows = response.data?.rows || response.data?.data || response.data?.generatedRows || [];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Datagen service returned no rows');
  }

  return rows;
}

async function updateGeneratedTableRowCount({ supabase, generatedTableId, rowCount }) {
  const { data, error } = await supabase
    .from('generated_tables')
    .update({
      row_count: rowCount,
      status: 'POPULATED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', generatedTableId)
    .select()
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to update generated table row count');
  }

  return data;
}

async function populateGeneratedTableRows({ accessToken, userId, generatedTableId, rowCount = DEFAULT_ROW_COUNT }) {
  if (!generatedTableId) {
    const error = new Error('generatedTableId is required');
    error.statusCode = 400;
    throw error;
  }

  const normalizedRowCount = normalizeRowCount(rowCount);
  const supabase = createUserSupabaseClient(accessToken);
  const generatedTable = await getGeneratedTableMetadata({ supabase, generatedTableId });

  const physicalSchemaName = generatedTable.physical_schema_name || 'public';
  const physicalTableName = generatedTable.physical_table_name || generatedTable.table_name || generatedTable.name;

  if (!physicalTableName) {
    throw new Error('Generated table has no physical table name');
  }

  if (!generatedTable.schema_id) {
    throw new Error('Generated table has no schema_id');
  }

  const schemaMetadata = await getSchemaMetadata({ supabase, schemaId: generatedTable.schema_id });
  const schemaDefinition = await downloadSchemaDefinition({ supabase, schemaMetadata });
  const rows = await callDatagenService({
    accessToken,
    userId,
    schemaDefinition,
    rowCount: normalizedRowCount,
  });

  const inserted = await insertRows({
    schemaName: physicalSchemaName,
    tableName: physicalTableName,
    generatedTableId,
    userId,
    schemaDefinition,
    rows,
  });

  const currentRowCount = await countRows({
    schemaName: physicalSchemaName,
    tableName: physicalTableName,
    generatedTableId,
    userId,
  });

  const updatedGeneratedTable = await updateGeneratedTableRowCount({
    supabase,
    generatedTableId,
    rowCount: currentRowCount,
  });

  return {
    generatedTableId,
    physicalSchemaName,
    physicalTableName,
    fullyQualifiedName: `${physicalSchemaName}.${physicalTableName}`,
    inserted,
    rowCount: currentRowCount,
    generatedTable: updatedGeneratedTable,
  };
}

module.exports = {
  populateGeneratedTableRows,
};

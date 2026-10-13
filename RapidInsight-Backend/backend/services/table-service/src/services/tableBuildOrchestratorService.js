const axios = require('axios');

const pool = require('../config/db');
const createUserSupabaseClient = require('../config/createUserSupabaseClient');

const {
  loadSchemaBundle,
  getRequesterProfile,
} = require('./schemaLookupService');

const {
  getGeneratedTableBySchema,
  getGeneratedTableByPhysicalName,
  createGeneratedTableMetadata,
  updateGeneratedTableRowCount,
  listGeneratedTables,
  getGeneratedTableById,
} = require('./generatedTableService');

const {
  createProjectSchemaIfNotExists,
  tableExists,
  createPhysicalTable,
  countRows,
} = require('./physicalTableService');

const { insertRows } = require('./rowInsertService');
const { readRows } = require('./rowReadService');

function createDuplicateTableError({ projectName, schemaName, tableName }) {
  const error = new Error(
    `A table named ${tableName} already exists. Build skipped. Please use the existing table or rename the file.`
  );

  error.statusCode = 409;
  error.payload = {
    status: 'DUPLICATE_TABLE',
    message: `A table named ${tableName} already exists. Build skipped. Please use the existing table or rename the file.`,
    schemaName,
    tableName,
    projectName,
    canOverwrite: false,
  };

  return error;
}

async function updateSchemaAsBuilt({
  accessToken,
  schemaId,
  generatedTableId,
  physicalSchemaName,
  physicalTableName,
  action = 'created',
}) {
  const supabase = createUserSupabaseClient(accessToken);

  const { error } = await supabase
    .from('schemas')
    .update({
      table_status: 'BUILT',
      generated_table_id: generatedTableId,
      physical_schema_name: physicalSchemaName,
      physical_table_name: physicalTableName,
      sanitized_table_name: physicalTableName,
      last_upload_action: action,
      updated_at: new Date().toISOString(),
    })
    .eq('id', schemaId);

  if (error) {
    throw new Error(error.message || 'Failed to update schema table status.');
  }
}

async function buildTableFromSchema({ accessToken, userId, schemaId }) {
  const {
    organisationId,
    project,
    schemaMetadata,
    schemaDefinition,
    physicalSchemaName,
    physicalTableName,
    fullyQualifiedName,
  } = await loadSchemaBundle({
    accessToken,
    userId,
    schemaId,
  });

  const existingBySchema = await getGeneratedTableBySchema({
    accessToken,
    schemaId,
    organisationId,
  });

  if (existingBySchema) {
    return {
      generatedTable: existingBySchema,
      alreadyBuilt: true,
      overwritten: false,
      overwriteMode: null,
      schemaEvolved: false,
      addedColumns: [],
      schemaName: existingBySchema.physical_schema_name || physicalSchemaName,
      tableName: existingBySchema.physical_table_name || physicalTableName,
      fullyQualifiedName:
        existingBySchema.fully_qualified_name ||
        `${existingBySchema.physical_schema_name || physicalSchemaName}.${existingBySchema.physical_table_name || physicalTableName}`,
      message: `Table ${existingBySchema.physical_table_name || physicalTableName} is already built.`,
    };
  }

  const existingByPhysicalName = await getGeneratedTableByPhysicalName({
    accessToken,
    organisationId,
    projectId: schemaMetadata.project_id,
    schemaName: physicalSchemaName,
    tableName: physicalTableName,
  });

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await createProjectSchemaIfNotExists({
      client,
      schemaName: physicalSchemaName,
    });

    const physicalExists = await tableExists({
      client,
      schemaName: physicalSchemaName,
      tableName: physicalTableName,
    });

    if (physicalExists || existingByPhysicalName) {
      throw createDuplicateTableError({
        projectName: project.name,
        schemaName: physicalSchemaName,
        tableName: physicalTableName,
      });
    }

    await createPhysicalTable({
      client,
      schemaName: physicalSchemaName,
      tableName: physicalTableName,
      schemaDefinition,
    });

    const generatedTable = await createGeneratedTableMetadata({
      accessToken,
      payload: {
        schema_id: schemaMetadata.id,
        project_id: schemaMetadata.project_id,
        organisation_id: schemaMetadata.organisation_id,
        created_by: userId,
        physical_schema_name: physicalSchemaName,
        physical_table_name: physicalTableName,
        sanitized_table_name: physicalTableName,
        fully_qualified_name: fullyQualifiedName,
        source_file_name: schemaMetadata.original_file_name,
        row_count: 0,
        status: 'CREATED',
        replaced_generated_table_id: null,
        version: 1,
      },
    });

    await updateSchemaAsBuilt({
      accessToken,
      schemaId,
      generatedTableId: generatedTable.id,
      physicalSchemaName,
      physicalTableName,
      action: 'created',
    });

    await client.query('COMMIT');

    return {
      generatedTable,
      alreadyBuilt: false,
      overwritten: false,
      overwriteMode: null,
      schemaEvolved: false,
      addedColumns: [],
      schemaName: physicalSchemaName,
      tableName: physicalTableName,
      fullyQualifiedName,
      message: `Table ${physicalTableName} built successfully.`,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function generateAndInsertRows({ accessToken, userId, schemaId, rowCount }) {
  const buildResult = await buildTableFromSchema({ accessToken, userId, schemaId });

  const {
    organisationId,
    schemaDefinition,
  } = await loadSchemaBundle({
    accessToken,
    userId,
    schemaId,
  });

  const generatedTable = buildResult.generatedTable;

  const schemaName =
    generatedTable.physical_schema_name ||
    buildResult.schemaName ||
    'public';

  const tableName =
    generatedTable.physical_table_name ||
    buildResult.tableName ||
    generatedTable.physical_table_name;

  const datagenUrl = process.env.DATAGEN_SERVICE_URL || 'http://localhost:3002';

  const response = await axios.post(
    `${datagenUrl}/datagen/generate`,
    {
      schemaDefinition,
      rowCount,
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'x-user-id': userId,
        'x-internal-service-key': process.env.INTERNAL_SERVICE_KEY,
      },
    }
  );

  const rows = response.data?.rows || response.data?.data || [];

  const insertedCount = await insertRows({
    schemaName,
    tableName,
    schemaDefinition,
    rows,
    generatedTableId: generatedTable.id,
    userId,
  });

  const totalRows = await countRows({
    schemaName,
    tableName,
    generatedTableId: generatedTable.id,
    userId,
  });

  const updatedGeneratedTable = await updateGeneratedTableRowCount({
    accessToken,
    generatedTableId: generatedTable.id,
    rowCount: totalRows,
    status: totalRows > 0 ? 'POPULATED' : generatedTable.status,
  });

  return {
    organisationId,
    generatedTable: updatedGeneratedTable,
    insertedCount,
    totalRows,
    schemaName,
    tableName,
    fullyQualifiedName: `${schemaName}.${tableName}`,
    schemaEvolved: buildResult.schemaEvolved,
    addedColumns: buildResult.addedColumns || [],
    message:
      insertedCount > 0
        ? `${buildResult.message} Generated and inserted ${insertedCount} rows.`
        : buildResult.message,
  };
}

async function loadOrganisationOnly({
  accessToken,
  userId,
}) {
  const profile = await getRequesterProfile({
    accessToken,
    userId,
  });

  if (!profile.organisation_id) {
    throw new Error('User organisation not found.');
  }

  return {
    profile,
    organisationId: profile.organisation_id,
  };
}

async function listTablesForUser({
  accessToken,
  userId,
  projectId,
}) {
  const { organisationId } = await loadOrganisationOnly({
    accessToken,
    userId,
  });

  return listGeneratedTables({
    accessToken,
    organisationId,
    projectId,
  });
}

async function getRowsForGeneratedTable({
  accessToken,
  userId,
  generatedTableId,
  page,
  pageSize,
  offset,
}) {
  const { organisationId } = await loadOrganisationOnly({
    accessToken,
    userId,
  });

  const generatedTable = await getGeneratedTableById({
    accessToken,
    generatedTableId,
    organisationId,
  });

  const schemaName = generatedTable.physical_schema_name || 'public';
  const tableName = generatedTable.physical_table_name;

  if (!tableName) {
    throw new Error('Generated table has no physical table name.');
  }

  const actualOffset = offset !== undefined ? offset : (page - 1) * pageSize;

  const result = await readRows({
    schemaName,
    tableName,
    userId,
    limit: pageSize,
    offset: actualOffset,
  });

  return {
    generatedTable,
    rows: result.rows,
    pagination: {
      page,
      pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pageSize) || 1,
    },
  };
}

async function getGeneratedTableForSchema({
  accessToken,
  userId,
  schemaId,
}) {
  const { organisationId } = await loadOrganisationOnly({
    accessToken,
    userId,
  });

  return getGeneratedTableBySchema({
    accessToken,
    schemaId,
    organisationId,
  });
}

module.exports = {
  buildTableFromSchema,
  generateAndInsertRows,
  listTablesForUser,
  getRowsForGeneratedTable,
  getGeneratedTableForSchema,
  findGeneratedTableBySchema: getGeneratedTableForSchema,
};

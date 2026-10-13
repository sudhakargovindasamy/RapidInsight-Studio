const crypto = require('crypto');

const env = require('../config/env');
const AppError = require('../errors/AppError');

const {
  createSupabaseClient,
  createSupabaseAdminClient
} = require('../config/supabase');

const getAccessTokenFromRequest = require(
  '../utils/getAccessTokenFromRequest'
);

const {
  normalizeIdentifier
} = require('../utils/identifierNaming');

const {
  getProjectForEmployee
} = require('../services/projectAccessService');

const {
  parseSchemaFile
} = require('../services/schemaParserService');

const {
  uploadSchemaDefinition,
  uploadRawDataFile
} = require('../services/schemaStorageService');

const {
  deleteSchemaCompletely
} = require('../services/schemaDeleteService');

const {
  startSeedGeneration,
  generateAndStoreSeedRows,
  shouldGenerateSeeds,
  isStaleGenerating
} = require('../services/seedGenerationService');

const {
  registerCatalogMetadata
} = require('../services/catalogIngestionService');

const pool = require('../config/db');
const {
  loadOrReplacePhysicalTable
} = require('../services/physicalTableLoaderService');

function getSupabase(req) {
  const accessToken = getAccessTokenFromRequest(req);

  return createSupabaseClient(accessToken);
}

async function uploadSchema(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(
        'Schema file is required.',
        400,
        'SCHEMA_FILE_REQUIRED'
      );
    }

    const supabase = getSupabase(req);

    const projectId =
      req.body.project_id || req.body.projectId;

    const project = await getProjectForEmployee({
      supabase,
      projectId,
      userId: req.user?.id
    });

    const {
      fileType,
      schemaDefinition,
      rows = []
    } = parseSchemaFile(req.file);

    const sanitizedTableName = normalizeIdentifier(
      req.file.originalname
    );

    const bucket = env.SCHEMA_STORAGE_BUCKET;
    const displayName = `${project.name} / ${req.file.originalname}`;

    // Atomically validate data, check duplicate fingerprint, and load/replace physical table
    const tableResult = await loadOrReplacePhysicalTable({
      pool,
      supabase,
      project,
      userId: req.user.id,
      schemaDefinition,
      rows,
      sanitizedTableName,
      originalFileName: req.file.originalname,
      fileType,
      bucket,
      displayName
    });

    const storagePath = `${req.user.id}/${project.id}/${tableResult.schemaId}/schema.json`;
    const dataStoragePath = `${req.user.id}/${project.id}/${tableResult.schemaId}/data.${fileType}`;

    // Upload backup definitions to storage asynchronously without failing response if storage has transient lag
    uploadSchemaDefinition({
      supabase,
      bucket,
      path: storagePath,
      schemaDefinition
    }).catch(err => logger.warn({ err: err.message }, 'Backup storage upload skipped'));

    if (rows.length > 0 && req.file.buffer) {
      uploadRawDataFile({
        supabase,
        bucket,
        path: dataStoragePath,
        buffer: req.file.buffer,
        contentType: req.file.mimetype || 'text/csv'
      }).then(() => {
        pool.query('UPDATE public.schemas SET data_storage_path = $1 WHERE id = $2', [dataStoragePath, tableResult.schemaId]).catch(() => {});
      }).catch(err => logger.warn({ err: err.message }, 'Backup raw data storage skipped'));
    }

    return res.status(201).json({
      success: true,
      message: tableResult.isUpdate
        ? `Table "${sanitizedTableName}" updated and replaced with ${tableResult.rowCount} rows.`
        : `Table "${sanitizedTableName}" created and loaded successfully with ${tableResult.rowCount} rows.`,
      requestId: req.id,
      data: {
        schema: {
          id: tableResult.schemaId,
          project_id: project.id,
          sanitized_table_name: sanitizedTableName,
          physical_table_name: tableResult.physicalTableName,
          physical_schema_name: tableResult.physicalSchemaName,
          table_status: 'BUILT',
          uploaded_row_count: tableResult.rowCount,
          generated_table_id: tableResult.generatedTableId,
          status: 'uploaded',
          is_update: tableResult.isUpdate
        },
        schemaDefinition,
        generatedTable: {
          id: tableResult.generatedTableId,
          physical_table_name: tableResult.physicalTableName,
          row_count: tableResult.rowCount,
          status: tableResult.status
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function listSchemas(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const projectId =
      req.query.project_id || req.query.projectId;

    if (projectId) {
      await getProjectForEmployee({
        supabase,
        projectId,
        userId: req.user?.id
      });
    }

    let query = supabase
      .from('schemas')
      .select('*')
      .order('created_at', {
        ascending: false
      });

    if (projectId) {
      query = query.eq('project_id', projectId);
    } else if (req.user?.id) {
      query = query.eq('user_id', req.user.id);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    const schemas = data || [];

    return res.status(200).json({
      success: true,
      count: schemas.length,
      data: schemas,
      schemas,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function getSchemaById(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const { data: schema, error } = await supabase
      .from('schemas')
      .select('*')
      .eq('id', req.params.schemaId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!schema) {
      throw new AppError(
        'Schema not found.',
        404,
        'SCHEMA_NOT_FOUND'
      );
    }

    if (req.user?.id && schema.user_id !== req.user.id) {
      await getProjectForEmployee({
        supabase,
        projectId: schema.project_id,
        userId: req.user.id
      });
    }

    const {
      data: fileData,
      error: downloadError
    } = await supabase.storage
      .from(schema.storage_bucket)
      .download(schema.storage_path);

    if (downloadError) {
      throw downloadError;
    }

    if (!fileData) {
      throw new AppError(
        'Schema definition file was not found.',
        404,
        'SCHEMA_FILE_NOT_FOUND'
      );
    }

    const fileText = await fileData.text();

    let schemaDefinition;

    try {
      schemaDefinition = JSON.parse(fileText);
    } catch (error) {
      throw new AppError(
        'The stored schema definition is invalid.',
        500,
        'INVALID_STORED_SCHEMA'
      );
    }

    return res.status(200).json({
      success: true,
      requestId: req.id,
      data: {
        schema,
        schemaDefinition
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function ensureSchemaVisibleToUser({
  supabase,
  schemaId,
  userId
}) {
  const { data: schema, error } = await supabase
    .from('schemas')
    .select('id, user_id, project_id')
    .eq('id', schemaId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!schema) {
    throw new AppError(
      'Schema not found.',
      404,
      'SCHEMA_NOT_FOUND'
    );
  }

  if (userId && schema.user_id !== userId) {
    await getProjectForEmployee({
      supabase,
      projectId: schema.project_id,
      userId
    });
  }

  return schema;
}

/*
 * Retry seed generation for one schema.
 *
 * A permanently failed schema would otherwise leave the Generate Tables button
 * disabled forever, because the gate waits for every schema to be accounted for.
 * This is the escape hatch, and it is per-schema: the rest of the project is
 * untouched.
 */
async function retrySeedRows(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const schemaId = req.params.schemaId;

    const { data: schema, error } = await supabase
      .from('schemas')
      .select('*')
      .eq('id', schemaId)
      .maybeSingle();

    if (error) throw error;

    if (!schema) {
      throw new AppError('Schema not found.', 404, 'SCHEMA_NOT_FOUND');
    }

    if (req.user?.id && schema.user_id !== req.user.id) {
      await getProjectForEmployee({
        supabase,
        projectId: schema.project_id,
        userId: req.user.id
      });
    }

    if (!shouldGenerateSeeds(schema.data_source)) {
      throw new AppError(
        'This schema was uploaded with its own data and does not need generated rows.',
        400,
        'SEEDS_NOT_REQUIRED'
      );
    }

    // A genuinely running job is left alone. One that has outlived any possible
    // real run is assumed dead - its process is gone and it will never finish on
    // its own - so a retry is allowed to take over.
    if (schema.seed_status === 'generating' && !isStaleGenerating(schema)) {
      throw new AppError(
        'Seed rows are already being generated for this schema.',
        409,
        'SEEDS_ALREADY_GENERATING'
      );
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from(schema.storage_bucket)
      .download(schema.storage_path);

    if (downloadError || !fileData) {
      throw new AppError(
        'The stored schema definition could not be read.',
        500,
        'SCHEMA_FILE_NOT_FOUND'
      );
    }

    const schemaDefinition = JSON.parse(await fileData.text());

    // Awaited here, unlike on upload. A retry is an explicit user action, so the
    // caller is waiting for an answer rather than being handed a background job.
    const result = await generateAndStoreSeedRows({
      schemaId,
      projectId: schema.project_id,
      userId: schema.user_id,
      userEmail: req.user.email,
      tableName: schema.sanitized_table_name,
      schemaDefinition
    });

    return res.status(result.status === 'ready' ? 200 : 502).json({
      success: result.status === 'ready',
      message:
        result.status === 'ready'
          ? `Generated ${result.rows} example rows.`
          : result.error,
      requestId: req.id,
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

/*
 * Whether a project is ready for Generate Tables.
 *
 * The button stays disabled until every schema is accounted for. Returning the
 * blocking schemas by name means the UI can say which ones are holding it up
 * instead of showing an unexplained disabled button.
 */
async function getProjectSeedStatus(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const projectId = req.query.project_id || req.query.projectId;

    if (!projectId) {
      throw new AppError('project_id is required.', 400, 'PROJECT_ID_REQUIRED');
    }

    await getProjectForEmployee({
      supabase,
      projectId,
      userId: req.user?.id
    });

    const { data, error } = await supabase
      .from('schemas')
      .select(
        'id, display_name, original_file_name, seed_status, seed_row_count, seed_error, seed_started_at'
      )
      .eq('project_id', projectId);

    if (error) throw error;

    /*
     * A job whose process died still reads as "generating" in the database.
     * Reporting that verbatim leaves the UI polling forever, so it is surfaced
     * as failed - which is what it is, and which gives the user a retry button
     * instead of an indefinite spinner.
     */
    const schemas = (data || []).map((schema) => {
      if (!isStaleGenerating(schema)) return schema;

      return {
        ...schema,
        seed_status: 'failed',
        seed_error:
          schema.seed_error ||
          'Generation stopped unexpectedly, most likely because the service restarted. Retry to run it again.'
      };
    });

    const pending = schemas.filter((schema) =>
      ['pending', 'generating'].includes(schema.seed_status)
    );

    const failed = schemas.filter((schema) => schema.seed_status === 'failed');

    return res.status(200).json({
      success: true,
      requestId: req.id,
      data: {
        total: schemas.length,
        ready: schemas.length - pending.length - failed.length,
        pending: pending.length,
        failed: failed.length,
        // False while anything is still working or has failed. A failed schema
        // must be retried or removed before the project can proceed.
        can_generate_tables:
          schemas.length > 0 && pending.length === 0 && failed.length === 0,
        schemas
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function deleteSchema(req, res, next) {
  try {
    const schemaId = req.params.schemaId;

    const userSupabase = getSupabase(req);

    await ensureSchemaVisibleToUser({
      supabase: userSupabase,
      schemaId,
      userId: req.user?.id
    });

    const adminSupabase =
      createSupabaseAdminClient();

    const result = await deleteSchemaCompletely({
      supabase: adminSupabase,
      schemaId
    });

    return res.status(200).json({
      success: true,
      message:
        'Schema and associated generated table/data deleted successfully.',
      requestId: req.id,
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

const {
  testAndDiscoverTables,
  importTablesAsSchemas
} = require('../services/dbConnectionService');

async function testDatabaseConnection(req, res, next) {
  try {
    const connectionConfig = req.body.connectionConfig || req.body;
    if (!connectionConfig) {
      throw new AppError('Connection configuration is required.', 400, 'CONNECTION_CONFIG_REQUIRED');
    }

    const result = await testAndDiscoverTables(connectionConfig);
    return res.status(200).json({
      success: true,
      message: 'Database connection successful.',
      data: result,
      tables: result.tables,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

async function importDatabaseTables(req, res, next) {
  try {
    const { projectId, connectionConfig, selectedTables } = req.body;
    if (!projectId) {
      throw new AppError('projectId is required.', 400, 'PROJECT_ID_REQUIRED');
    }
    if (!connectionConfig) {
      throw new AppError('connectionConfig is required.', 400, 'CONNECTION_CONFIG_REQUIRED');
    }
    if (!selectedTables || !Array.isArray(selectedTables) || selectedTables.length === 0) {
      throw new AppError('At least one table must be selected for import.', 400, 'NO_TABLES_SELECTED');
    }

    const supabase = getSupabase(req);
    const project = await getProjectForEmployee({
      supabase,
      projectId,
      userId: req.user?.id
    });

    const result = await importTablesAsSchemas({
      project,
      userId: req.user.id,
      userEmail: req.user.email,
      connectionConfig,
      selectedTables,
      supabase
    });

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${result.importedCount} tables.`,
      data: result,
      requestId: req.id
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  uploadSchema,
  listSchemas,
  getSchemaById,
  deleteSchema,
  retrySeedRows,
  getProjectSeedStatus,
  testDatabaseConnection,
  importDatabaseTables
};
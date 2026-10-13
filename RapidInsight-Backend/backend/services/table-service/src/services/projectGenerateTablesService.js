const pool = require('../config/postgres');
const Papa = require('papaparse');

const {
  quoteIdentifier
} = require('../utils/identifierNaming');

const {
  buildTableFromSchema
} = require('./generatedTableService');

const {
  insertRows
} = require('./rowService');

const {
  inferRelationships
} = require('./aiBlueprintClient');

const {
  loadSchemaBundles
} = require('./schemaBundleService');

const {
  generateRelationalRows,
  checkSdvStatus
} = require('./datagenClient');

const {
  validateBlueprintAgainstSchemas
} = require('./blueprintValidationService');

const {
  upsertProjectDataModel,
  updateProjectDataModelStatus,
  getProjectDataModel
} = require('./projectDataModelService');

const {
  generateDashboardReport
} = require('./analyticsDashboardService');

const {
  generateSqlDashboard
} = require('./sqlKpiExecutionService');

function quoteQualifiedName(schemaName, tableName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

/*
 * Splitting generation into steps means more provider calls in the same
 * window, and free-tier rate limits are per minute. Firing them back to back
 * is what pushes a run over the limit, so calls are spaced deliberately.
 * Set AI_STEP_DELAY_MS=0 to disable when running against a paid tier.
 */
const AI_STEP_DELAY_MS = (() => {
  const parsed = Number.parseInt(process.env.AI_STEP_DELAY_MS, 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3000;
})();

async function pauseBetweenAiSteps() {
  if (AI_STEP_DELAY_MS <= 0) return;

  await new Promise((resolve) => setTimeout(resolve, AI_STEP_DELAY_MS));
}

async function fetchProject({ supabase, projectId }) {
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

/*
 * Stops a run that cannot succeed, before any table is created.
 *
 * Without seed rows SDV has nothing to learn from, and datagen-service would
 * fail partway through - after the physical tables had already been built. The
 * message names the schemas so the user knows which ones to fix.
 */
function assertSeedRowsPresent(schemaBundles) {
  const missing = schemaBundles
    .filter((bundle) => bundle.schema.data_source !== 'uploaded')
    .filter((bundle) => !bundle.seedRows || !(bundle.seedRows.rows || []).length);

  if (!missing.length) return;

  const names = missing
    .map((bundle) => bundle.schema.original_file_name || bundle.schema.display_name)
    .join(', ');

  const error = new Error(
    `These schemas have no example rows yet: ${names}. ` +
      `Example rows are written when a schema is uploaded - retry seed generation ` +
      `for them, or re-upload the file.`
  );

  error.statusCode = 422;
  error.code = 'MISSING_SEED_ROWS';

  throw error;
}

function toAiSchemaInput(bundle) {
  return {
    schema_id: bundle.schema.id,
    original_file_name: bundle.schema.original_file_name,
    display_name: bundle.schema.display_name,
    sanitized_table_name: bundle.schema.sanitized_table_name,
    file_type: bundle.schema.file_type,
    field_count: bundle.schema.field_count,
    schemaDefinition: bundle.schemaDefinition
  };
}

function getBlueprintTableMap(blueprint) {
  const map = new Map();

  (blueprint.tables || []).forEach((table) => {
    map.set(table.schema_id, table);
  });

  return map;
}

function getDependencySchemaOrder({ blueprint, schemaBundles }) {
  const tableBySchemaId = getBlueprintTableMap(blueprint);
  const tableNameToSchemaId = new Map();

  (blueprint.tables || []).forEach((table) => {
    tableNameToSchemaId.set(table.table_name, table.schema_id);
  });

  const orderedSchemaIds = [];

  (blueprint.dependency_order || []).forEach((tableName) => {
    const schemaId = tableNameToSchemaId.get(tableName);

    if (schemaId && !orderedSchemaIds.includes(schemaId)) {
      orderedSchemaIds.push(schemaId);
    }
  });

  schemaBundles.forEach((bundle) => {
    if (!orderedSchemaIds.includes(bundle.schema.id)) {
      orderedSchemaIds.push(bundle.schema.id);
    }
  });

  return orderedSchemaIds
    .map((schemaId) => schemaBundles.find((bundle) => bundle.schema.id === schemaId))
    .filter(Boolean)
    .filter((bundle) => tableBySchemaId.has(bundle.schema.id));
}

async function buildPhysicalTables({
  supabase,
  project,
  schemaBundles,
  blueprint,
  userId
}) {
  const orderedBundles = getDependencySchemaOrder({
    blueprint,
    schemaBundles
  });

  const generatedTablesBySchemaId = new Map();

  for (const bundle of orderedBundles) {
    const generatedTable = await buildTableFromSchema({
      supabase,
      schema: bundle.schema,
      project,
      schemaDefinition: bundle.schemaDefinition,
      userId
    });

    generatedTablesBySchemaId.set(bundle.schema.id, generatedTable);
  }

  return generatedTablesBySchemaId;
}

async function clearGeneratedTableRows({ generatedTable }) {
  const schemaName = generatedTable.physical_schema_name || 'public';
  const tableName = generatedTable.physical_table_name;

  if (!tableName) return;

  await pool.query(
    `delete from ${quoteQualifiedName(schemaName, tableName)} where "__ris_generated_table_id" = $1`,
    [generatedTable.id]
  );
}

async function updateGeneratedTableRowCount({
  supabase,
  generatedTableId,
  rowCount,
  status
}) {
  const { data, error } = await supabase
    .from('generated_tables')
    .update({
      row_count: rowCount,
      status,
      updated_at: new Date().toISOString()
    })
    .eq('id', generatedTableId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message || 'Failed to update generated table row count.');
  }

  return data;
}

function partitionBundlesByDataSource(schemaBundles) {
  const uploaded = [];
  const generated = [];

  schemaBundles.forEach((bundle) => {
    if (bundle.schema.data_source === 'uploaded') {
      uploaded.push(bundle);
    } else {
      generated.push(bundle);
    }
  });

  return { uploaded, generated };
}

function buildBlueprintForDatagen({ blueprint, uploadedSchemaIds }) {
  const uploadedTableNames = new Set(
    (blueprint.tables || [])
      .filter((table) => uploadedSchemaIds.has(table.schema_id))
      .map((table) => table.table_name)
  );

  return {
    ...blueprint,
    tables: (blueprint.tables || []).filter((table) => !uploadedSchemaIds.has(table.schema_id)),
    relationships: (blueprint.relationships || []).filter(
      (relationship) =>
        !uploadedTableNames.has(relationship.from_table) &&
        !uploadedTableNames.has(relationship.to_table)
    ),
    dependency_order: (blueprint.dependency_order || []).filter(
      (tableName) => !uploadedTableNames.has(tableName)
    )
  };
}

async function loadUploadedRows({ supabase, schema }) {
  const { data, error } = await supabase.storage
    .from(schema.storage_bucket || 'schemas')
    .download(schema.data_storage_path);

  if (error || !data) {
    throw new Error(error?.message || `Failed to download uploaded data for ${schema.original_file_name}.`);
  }

  const text = await data.text();
  const storagePath = schema.data_storage_path || '';
  const isCsv = storagePath.endsWith('.csv') ||
    (schema.original_file_name || '').endsWith('.csv');

  let rows;
  if (isCsv) {
    const result = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (result.errors && result.errors.length) {
      throw new Error(`CSV parse error for ${schema.original_file_name}: ${result.errors[0].message}`);
    }
    rows = result.data || [];
  } else {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : (parsed.rows || []);
  }

  if (!rows.length) {
    throw new Error(`Uploaded data for ${schema.original_file_name} contains no rows.`);
  }

  return rows;
}

async function insertRelationalRows({
  supabase,
  accessToken,
  userId,
  userEmail,
  blueprint,
  schemaBundles,
  generatedTablesBySchemaId,
  rowCount,
  clearBeforeInsert = false
}) {
  const { uploaded, generated: datagenBundles } = partitionBundlesByDataSource(schemaBundles);

  const insertResults = [];
  const tableNameToBlueprint = new Map();

  (blueprint.tables || []).forEach((table) => {
    tableNameToBlueprint.set(table.table_name, table);
  });

  // 1. Process Uploaded Data
  for (const bundle of uploaded) {
    const tableBlueprint = (blueprint.tables || []).find((t) => t.schema_id === bundle.schema.id);
    if (!tableBlueprint) continue;

    const generatedTable = generatedTablesBySchemaId.get(bundle.schema.id);
    if (!generatedTable) continue;

    if (bundle.schema.data_storage_path) {
      if (clearBeforeInsert) {
        await clearGeneratedTableRows({ generatedTable });
      }

      const rows = await loadUploadedRows({ supabase, schema: bundle.schema });

      const inserted = await insertRows({
        generatedTable,
        schemaDefinition: bundle.schemaDefinition,
        rows,
        userId
      });

      const updatedTable = await updateGeneratedTableRowCount({
        supabase,
        generatedTableId: generatedTable.id,
        rowCount: inserted,
        status: inserted > 0 ? 'POPULATED' : 'CREATED'
      });

      insertResults.push({
        schema_id: bundle.schema.id,
        table_name: tableBlueprint.table_name,
        generated_table_id: generatedTable.id,
        rows_inserted: inserted,
        generatedTable: updatedTable
      });
    } else {
      // Direct database import or pre-populated physical table without storage file.
      // Data already exists in PostgreSQL, so preserve the existing physical rows.
      let count = Number(generatedTable.row_count) || 0;
      try {
        const schemaName = generatedTable.physical_schema_name || 'public';
        const tableName = generatedTable.physical_table_name;
        if (tableName) {
          const { rows: countRows } = await pool.query(
            `select count(*)::int as count from ${quoteQualifiedName(schemaName, tableName)}`
          );
          count = countRows[0]?.count ?? count;
        }
      } catch (err) {
        console.warn('Could not query physical table row count:', err.message);
      }

      const updatedTable = await updateGeneratedTableRowCount({
        supabase,
        generatedTableId: generatedTable.id,
        rowCount: count,
        status: count > 0 ? 'POPULATED' : 'CREATED'
      });

      insertResults.push({
        schema_id: bundle.schema.id,
        table_name: tableBlueprint.table_name,
        generated_table_id: generatedTable.id,
        rows_inserted: count,
        generatedTable: updatedTable
      });
    }
  }

  // 2. Process Datagen Data
  if (datagenBundles.length > 0) {
    const uploadedSchemaIds = new Set(uploaded.map((bundle) => bundle.schema.id));
    const modifiedBlueprint = buildBlueprintForDatagen({ blueprint, uploadedSchemaIds });

    const schemasForDatagen = datagenBundles.map((bundle) => ({
      schema_id: bundle.schema.id,
      schemaDefinition: bundle.schemaDefinition
    }));

    // Keyed by schema_id, which is how datagen-service looks them up per table.
    const seedRowsBySchemaId = {};

    datagenBundles.forEach((bundle) => {
      if (bundle.seedRows) {
        seedRowsBySchemaId[bundle.schema.id] = bundle.seedRows;
      }
    });

    const generated = await generateRelationalRows({
      blueprint: modifiedBlueprint,
      schemas: schemasForDatagen,
      rowCount,
      seedRows: seedRowsBySchemaId,
      userId,
      userEmail,
      accessToken
    });

    if (!generated || !generated.tables) {
      throw new Error('Datagen service returned invalid relational data.');
    }

    const dependencyOrder = generated.dependency_order || modifiedBlueprint.dependency_order || [];

    for (const tableName of dependencyOrder) {
      const tableData = generated.tables[tableName];

      if (!tableData) continue;

      const tableBlueprint = tableNameToBlueprint.get(tableName);

      if (!tableBlueprint) {
        throw new Error(`Generated rows returned unknown table "${tableName}".`);
      }

      const generatedTable = generatedTablesBySchemaId.get(tableBlueprint.schema_id);

      if (!generatedTable) {
        throw new Error(`Generated table metadata not found for schema "${tableBlueprint.schema_id}".`);
      }

      const bundle = datagenBundles.find((item) => item.schema.id === tableBlueprint.schema_id);

      if (!bundle) {
        throw new Error(`Schema bundle not found for schema "${tableBlueprint.schema_id}".`);
      }

      if (clearBeforeInsert) {
        await clearGeneratedTableRows({ generatedTable });
      }

      const rows = tableData.rows || [];

      const inserted = await insertRows({
        generatedTable,
        schemaDefinition: bundle.schemaDefinition,
        rows,
        userId
      });

      const updatedTable = await updateGeneratedTableRowCount({
        supabase,
        generatedTableId: generatedTable.id,
        rowCount: inserted,
        status: inserted > 0 ? 'POPULATED' : 'CREATED'
      });

      insertResults.push({
        schema_id: tableBlueprint.schema_id,
        table_name: tableName,
        generated_table_id: generatedTable.id,
        rows_inserted: inserted,
        generatedTable: updatedTable
      });
    }
  }

  return insertResults;
}

/*
 * A re-click of "Generate Tables" on a project that already has a saved
 * data model, physical tables, and inserted data does not need any of that
 * redone - only the KPI/dashboard step actually needs to change (new
 * requested KPIs). This mirrors retryDataInsertForProject's own
 * generated_tables existence check, but is stricter: that function only
 * confirms a table row exists (since its whole job is inserting data into
 * it), while this one also requires the table to already have data, since
 * data insertion itself is one of the steps being skipped here.
 *
 * Returns null (meaning "run the full pipeline") whenever anything doesn't
 * check out, rather than guessing - a resume should either be a clean
 * skip or not happen at all.
 */
async function detectResumableState({ supabase, projectId }) {
  const dataModel = await getProjectDataModel({ supabase, projectId });

  if (!dataModel?.model_json || !Array.isArray(dataModel.model_json.tables) || !dataModel.model_json.tables.length) {
    return null;
  }

  const blueprint = dataModel.model_json;

  const { data: generatedTables, error } = await supabase
    .from('generated_tables')
    .select('*')
    .eq('project_id', projectId);

  if (error) throw error;

  const generatedTablesBySchemaId = new Map();
  (generatedTables || []).forEach((table) => {
    if (table.schema_id) generatedTablesBySchemaId.set(table.schema_id, table);
  });

  const allTablesExistWithData = blueprint.tables.every((table) => {
    const generatedTable = generatedTablesBySchemaId.get(table.schema_id);
    return Boolean(generatedTable) && Number(generatedTable.row_count) > 0;
  });

  if (!allTablesExistWithData) return null;

  try {
    const schemaBundles = await loadSchemaBundles({ supabase, projectId });
    return { blueprint, schemaBundles, generatedTablesBySchemaId };
  } catch (error) {
    // Schemas were removed/changed since the model was saved. Fall back to
    // the full pipeline, which hits this same call and surfaces the error
    // through the normal path instead of a second, resume-specific one.
    return null;
  }
}

async function generateTablesForProject({
  supabase,
  accessToken,
  userId,
  userEmail,
  projectId,
  rowCount = 100,
  customKpis = []
}) {
  let blueprint = null;
  // Declared out here so the catch block can fall back to it when a later
  // step fails after step 1 already succeeded.
  let relationshipModel = null;

  try {
    const project = await fetchProject({
      supabase,
      projectId
    });

    const resumableState = await detectResumableState({ supabase, projectId });

    if (resumableState) {
      blueprint = resumableState.blueprint;

      const requestedKpis = Array.isArray(customKpis)
        ? customKpis.filter((kpi) => String(kpi || '').trim())
        : [];

      console.info('Reusing existing data model, tables, and data - regenerating only the KPI dashboard', {
        projectId
      });

      let dashboard = null;
      let dashboardError = null;

      try {
        dashboard = await generateSqlDashboard({
          supabase,
          projectId,
          userId,
          userEmail,
          accessToken,
          blueprint,
          schemaBundles: resumableState.schemaBundles,
          generatedTablesBySchemaId: resumableState.generatedTablesBySchemaId,
          customKpis: requestedKpis
        });
      } catch (error) {
        dashboardError = error.message || 'Report generation failed.';
        console.error('Dashboard report generation failed:', error);
      }

      const finalModel = await updateProjectDataModelStatus({
        supabase,
        projectId,
        status: 'data_inserted',
        lastStep: dashboardError ? 'report_failed' : 'done',
        errorMessage: null
      });

      return {
        project,
        model: finalModel,
        blueprint,
        insertedTables: [],
        dashboard,
        dashboardError
      };
    }

    await upsertProjectDataModel({
      supabase,
      projectId,
      userId,
      status: 'draft',
      modelJson: {},
      lastStep: 'inferring_relationships'
    });

    const schemaBundles = await loadSchemaBundles({
      supabase,
      projectId
    });

    /*
     * Both checks run before anything is created.
     *
     * The expensive part of this flow is the AI steps and the physical tables.
     * Discovering afterwards that SDV is unreachable, or that a schema has no
     * example rows, means the user waited minutes to be told something we could
     * have known at the start - and leaves half-built tables behind.
     */
    assertSeedRowsPresent(schemaBundles);

    const needsDatagen = schemaBundles.some(
      (bundle) => bundle.schema.data_source !== 'uploaded'
    );

    if (needsDatagen) {
      const sdvStatus = await checkSdvStatus();

      if (!sdvStatus.reachable) {
        const error = new Error(
          sdvStatus.message ||
            'The data generation service is not reachable. Start sdv-service and try again.'
        );

        error.statusCode = 503;
        error.code = 'SDV_UNAVAILABLE';

        throw error;
      }
    }

    const aiSchemas = schemaBundles.map(toAiSchemaInput);

    /*
     * Step 1: keys and relationships only.
     *
     * Asking one call to infer the data model, triage KPI feasibility, and
     * format the whole dashboard contract spends most of a smaller model's
     * attention on output shape, and the relationships suffer for it. This
     * call does one job.
     *
     * The result is persisted before anything else runs, which is what lets
     * the Schema Playground draw a diagram while the remaining steps are
     * still working.
     */
    relationshipModel = await inferRelationships({
      project,
      schemas: aiSchemas,
      userId,
      userEmail,
      accessToken
    });

    /*
     * status is the coarse lifecycle stage and is constrained by the database
     * to draft, validating, validated, tables_created, data_inserted, failed.
     * Progress within a stage belongs in last_step, which is unconstrained and
     * is what the UI reads. Step 1 has produced a model but validated nothing,
     * so the stage is still draft.
     */
    await upsertProjectDataModel({
      supabase,
      projectId,
      userId,
      status: 'draft',
      modelJson: relationshipModel,
      lastStep: 'relationships_done'
    });

    await pauseBetweenAiSteps();

    /*
     * The KPI/dashboard step now runs separately, after tables and data
     * exist (generateSqlDashboard, called further down) - it needs real
     * physical tables to write SQL against, unlike the old plan-based step
     * which only needed the schema/relationship model. blueprint.tables and
     * .relationships come straight from step 1; there is no more one-shot
     * "propose your own dashboard" call to fall back to.
     */
    const requestedKpis = Array.isArray(customKpis)
      ? customKpis.filter((kpi) => String(kpi || '').trim())
      : [];

    blueprint = {
      tables: relationshipModel.tables,
      relationships: relationshipModel.relationships || [],
      requested_analysis: [],
      custom_kpis: requestedKpis
    };

    await upsertProjectDataModel({
      supabase,
      projectId,
      userId,
      status: 'validating',
      modelJson: blueprint,
      lastStep: 'validating_blueprint'
    });

    // Enforce deterministic row counts based on table_type
    blueprint.tables.forEach(table => {
      let count = 50;
      if (table.table_type === 'fact') count = 500;
      else if (table.table_type === 'dimension') count = 50;
      else if (table.table_type === 'reference') count = 10;
      else if (table.table_type === 'bridge') count = 200;

      if (!blueprint.data_generation_rules) blueprint.data_generation_rules = [];
      let rule = blueprint.data_generation_rules.find(r => r.table_name === table.table_name);
      if (rule) {
        rule.row_count = count;
      } else {
        blueprint.data_generation_rules.push({ table_name: table.table_name, row_count: count });
      }
    });

    validateBlueprintAgainstSchemas({
      blueprint,
      schemaBundles
    });

    /*
     * Validation also normalizes AI output, including foreign-key
     * generation strategies and dependency order. Persist that repaired
     * blueprint so retries use the validated version.
     */
    await upsertProjectDataModel({
      supabase,
      projectId,
      userId,
      status: 'validated',
      modelJson: blueprint,
      lastStep: 'creating_tables',
      errorMessage: null
    });

    const generatedTablesBySchemaId = await buildPhysicalTables({
      supabase,
      project,
      schemaBundles,
      blueprint,
      userId
    });

    await updateProjectDataModelStatus({
      supabase,
      projectId,
      status: 'tables_created',
      lastStep: 'generating_data'
    });

    const insertResults = await insertRelationalRows({
      supabase,
      accessToken,
      userId,
      userEmail,
      blueprint,
      schemaBundles,
      generatedTablesBySchemaId,
      rowCount,
      clearBeforeInsert: true
    });

    let dashboard = null;
    let dashboardError = null;

    try {
      dashboard = await generateSqlDashboard({
        supabase,
        projectId,
        userId,
        userEmail,
        accessToken,
        blueprint,
        schemaBundles,
        generatedTablesBySchemaId,
        customKpis: requestedKpis
      });
    } catch (error) {
      dashboardError = error.message || 'Report generation failed.';
      console.error('Dashboard report generation failed:', error);
    }

    const finalModel = await updateProjectDataModelStatus({
      supabase,
      projectId,
      status: 'data_inserted',
      lastStep: dashboardError ? 'report_failed' : 'done',
      errorMessage: null
    });

    return {
      project,
      model: finalModel,
      blueprint,
      insertedTables: insertResults,
      dashboard,
      dashboardError
    };
  } catch (error) {
    /*
     * Falling back to {} here would erase the step 1 relationships whenever a
     * later step fails, taking the Schema Playground diagram down with it.
     * Keep the most complete model produced so far: the blueprint if it got
     * that far, otherwise the relationships on their own.
     */
    await upsertProjectDataModel({
      supabase,
      projectId,
      userId,
      status: 'failed',
      modelJson: blueprint || relationshipModel || {},
      lastStep: error.lastStep || 'failed',
      errorMessage: error.message || 'Generate tables failed.'
    });

    throw error;
  }
}

async function retryDataInsertForProject({
  supabase,
  accessToken,
  userId,
  userEmail,
  projectId,
  rowCount = 100
}) {
  const project = await fetchProject({
    supabase,
    projectId
  });

  const dataModel = await getProjectDataModel({
    supabase,
    projectId
  });

  if (!dataModel || !dataModel.model_json || !Array.isArray(dataModel.model_json.tables)) {
    const error = new Error('No valid saved data model found. Please restart Generate Tables.');
    error.statusCode = 400;
    throw error;
  }

  const blueprint = dataModel.model_json;

  await updateProjectDataModelStatus({
    supabase,
    projectId,
    status: 'tables_created',
    lastStep: 'generating_data',
    errorMessage: null
  });

  const schemaBundles = await loadSchemaBundles({
    supabase,
    projectId
  });

  // Same pre-flight as the full run. A retry that fails for a missing sidecar
  // after clearing the existing rows would leave the project emptier than it
  // started.
  assertSeedRowsPresent(schemaBundles);

  const needsDatagen = schemaBundles.some(
    (bundle) => bundle.schema.data_source !== 'uploaded'
  );

  if (needsDatagen) {
    const sdvStatus = await checkSdvStatus();

    if (!sdvStatus.reachable) {
      const sdvError = new Error(
        sdvStatus.message ||
          'The data generation service is not reachable. Start sdv-service and try again.'
      );

      sdvError.statusCode = 503;
      sdvError.code = 'SDV_UNAVAILABLE';

      throw sdvError;
    }
  }

  validateBlueprintAgainstSchemas({
    blueprint,
    schemaBundles
  });

  const { data: generatedTables, error } = await supabase
    .from('generated_tables')
    .select('*')
    .eq('project_id', projectId);

  if (error) throw error;

  const generatedTablesBySchemaId = new Map();

  (generatedTables || []).forEach((table) => {
    if (table.schema_id) {
      generatedTablesBySchemaId.set(table.schema_id, table);
    }
  });

  for (const table of blueprint.tables || []) {
    if (!generatedTablesBySchemaId.has(table.schema_id)) {
      const missingError = new Error(
        `Generated table does not exist for schema "${table.schema_id}". Please restart Generate Tables.`
      );
      missingError.statusCode = 400;
      throw missingError;
    }
  }

  try {
    const insertResults = await insertRelationalRows({
      supabase,
      accessToken,
      userId,
      userEmail,
      blueprint,
      schemaBundles,
      generatedTablesBySchemaId,
      rowCount,
      clearBeforeInsert: true
    });

    let dashboard = null;
    let dashboardError = null;

    try {
      const customKpis = blueprint.custom_kpis || [];
      if (customKpis.length) {
        dashboard = await generateSqlDashboard({
          supabase,
          projectId,
          userId,
          userEmail,
          accessToken,
          blueprint,
          schemaBundles,
          generatedTablesBySchemaId,
          customKpis
        });
      } else if (blueprint.dashboard?.kpis?.length) {
        dashboard = await generateDashboardReport({
          supabase,
          projectId,
          userId,
          userEmail,
          accessToken,
          blueprint,
          schemaBundles,
          generatedTablesBySchemaId
        });
      }
    } catch (error) {
      dashboardError = error.message || 'Report generation failed.';
      console.error('Dashboard report generation failed after retry:', error);
    }

    const finalModel = await updateProjectDataModelStatus({
      supabase,
      projectId,
      status: 'data_inserted',
      lastStep: dashboardError ? 'report_failed' : 'done',
      errorMessage: null
    });

    return {
      project,
      model: finalModel,
      blueprint,
      insertedTables: insertResults,
      dashboard,
      dashboardError
    };
  } catch (error) {
    await updateProjectDataModelStatus({
      supabase,
      projectId,
      status: 'failed',
      lastStep: 'inserting_data',
      errorMessage: error.message || 'Retry data insert failed.'
    });

    throw error;
  }
}

module.exports = {
  generateTablesForProject,
  retryDataInsertForProject
};

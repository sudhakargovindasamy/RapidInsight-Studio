const { createSupabaseClient } = require('../config/supabase');
const getAccessTokenFromRequest = require('../utils/getAccessTokenFromRequest');
const { getPagination } = require('../utils/pagination');

const {
  getSchemaBundle,
  getGeneratedTableById
} = require('../services/schemaLookupService');

const {
  buildTableFromSchema
} = require('../services/generatedTableService');

const {
  generateRows
} = require('../services/datagenClient');

const {
  insertRows,
  readRows
} = require('../services/rowService');

const {
  generateTablesForProject,
  retryDataInsertForProject
} = require('../services/projectGenerateTablesService');

const {
  getProjectDataModel
} = require('../services/projectDataModelService');

function getSupabase(req) {
  return createSupabaseClient(getAccessTokenFromRequest(req));
}
function getRequestUser(req) {
  if (!req.user?.id) {
    const error = new Error(
      'Authenticated user context is missing.'
    );

    error.statusCode = 401;
    error.code = 'USER_CONTEXT_MISSING';
    error.details = {
      hasUserIdHeader: Boolean(
        req.headers['x-user-id']
      ),
      userContextCreated: Boolean(req.user)
    };

    throw error;
  }

  return {
    id: req.user.id,
    email: req.user.email || null
  };
}
async function listTables(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projectId = req.query.project_id || req.query.projectId;

    if (projectId) {
      let projectQuery = supabase
        .from('projects')
        .select('id, created_by')
        .eq('id', projectId);

      if (req.user?.id) {
        projectQuery = projectQuery.eq('created_by', req.user.id);
      }

      const { data: project, error: projectError } = await projectQuery.maybeSingle();
      if (projectError) throw projectError;
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found.' });
      }
    }

    let query = supabase
      .from('generated_tables')
      .select('*')
      .order('created_at', { ascending: false });

    if (projectId) {
      query = query.eq('project_id', projectId);
    } else if (req.user?.id) {
      query = query.eq('created_by', req.user.id);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({
      success: true,
      count: data?.length || 0,
      data: data || []
    });
  } catch (error) {
    next(error);
  }
}

async function buildTable(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const { schema, project, schemaDefinition } = await getSchemaBundle({
      supabase,
      schemaId: req.params.schemaId
    });

    const generatedTable = await buildTableFromSchema({
      supabase,
      schema,
      project,
      schemaDefinition,
      userId: req.user.id
    });

    return res.status(201).json({
      success: true,
      message: 'Table built successfully.',
      data: generatedTable
    });
  } catch (error) {
    next(error);
  }
}

async function generateAndInsertData(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const accessToken = getAccessTokenFromRequest(req);
    const rowCount = Number(req.body.rowCount || req.body.rows || 100);

    const { schema, project, schemaDefinition } = await getSchemaBundle({
      supabase,
      schemaId: req.params.schemaId
    });

    const generatedTable = await buildTableFromSchema({
      supabase,
      schema,
      project,
      schemaDefinition,
      userId: req.user.id
    });

    const rows = await generateRows({
      schemaDefinition,
      rowCount,
      userId: req.user.id,
      userEmail: req.user.email,
      accessToken
    });

    const inserted = await insertRows({
      generatedTable,
      schemaDefinition,
      rows,
      userId: req.user.id
    });

    const newRowCount = Number(generatedTable.row_count || 0) + inserted;

    const { data: updated, error: updateError } = await supabase
      .from('generated_tables')
      .update({
        row_count: newRowCount,
        status: 'POPULATED',
        updated_at: new Date().toISOString()
      })
      .eq('id', generatedTable.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    return res.json({
      success: true,
      rows_inserted: inserted,
      data: updated
    });
  } catch (error) {
    next(error);
  }
}

async function getGeneratedTableBySchema(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const { data, error } = await supabase
      .from('generated_tables')
      .select('*')
      .eq('schema_id', req.params.schemaId)
      .maybeSingle();

    if (error) throw error;

    return res.json({
      success: true,
      data: data || null
    });
  } catch (error) {
    next(error);
  }
}

async function populateGeneratedTable(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const accessToken = getAccessTokenFromRequest(req);
    const rowCount = Number(req.body.rowCount || req.body.rows || 100);

    const generatedTable = await getGeneratedTableById({
      supabase,
      generatedTableId: req.params.generatedTableId
    });

    const { schemaDefinition } = await getSchemaBundle({
      supabase,
      schemaId: generatedTable.schema_id
    });

    const rows = await generateRows({
      schemaDefinition,
      rowCount,
      userId: req.user.id,
      userEmail: req.user.email,
      accessToken
    });

    const inserted = await insertRows({
      generatedTable,
      schemaDefinition,
      rows,
      userId: req.user.id
    });

    const newRowCount = Number(generatedTable.row_count || 0) + inserted;

    const { data: updated, error: updateError } = await supabase
      .from('generated_tables')
      .update({
        row_count: newRowCount,
        status: 'POPULATED',
        updated_at: new Date().toISOString()
      })
      .eq('id', generatedTable.id)
      .select('*')
      .single();

    if (updateError) throw updateError;

    return res.json({
      success: true,
      rows_inserted: inserted,
      data: updated
    });
  } catch (error) {
    next(error);
  }
}

async function getRows(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const { page, pageSize, offset } = getPagination(req.query);

    const generatedTable = await getGeneratedTableById({
      supabase,
      generatedTableId: req.params.generatedTableId
    });

    const result = await readRows({
      generatedTable,
      pageSize,
      offset
    });

    return res.json({
      success: true,
      page,
      pageSize,
      total: result.total,
      data: result.rows,
      generatedTable
    });
  } catch (error) {
    next(error);
  }
}
async function generateTablesForProjectHandler(
  req,
  res,
  next
) {
  try {
    const user = getRequestUser(req);
    const supabase = getSupabase(req);
    const accessToken =
      getAccessTokenFromRequest(req);

    const rowCount = Number(
      req.body?.rowCount ||
      req.body?.rows ||
      100
    );

    const customKpis = req.body?.custom_kpis || req.body?.customKpis || req.body?.custom_metrics || [];

    const projectId = req.params.projectId;

    if (!projectId) {
      const error = new Error(
        'Project ID is required.'
      );

      error.statusCode = 400;
      error.code = 'PROJECT_ID_REQUIRED';

      throw error;
    }

    let projectQuery = supabase
      .from('projects')
      .select('id, created_by')
      .eq('id', projectId);

    if (user?.id) {
      projectQuery = projectQuery.eq('created_by', user.id);
    }

    const { data: project, error: projectError } = await projectQuery.maybeSingle();
    if (projectError) throw projectError;
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const result = await generateTablesForProject({
      supabase,
      accessToken,
      userId: user.id,
      userEmail: user.email,
      projectId,
      rowCount,
      customKpis
    });

    return res.status(201).json({
      success: true,
      message:
        'Generate Tables completed successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}


async function retryDataInsertHandler(
  req,
  res,
  next
) {
  try {
    const user = getRequestUser(req);
    const supabase = getSupabase(req);
    const accessToken =
      getAccessTokenFromRequest(req);

    const rowCount = Number(
      req.body?.rowCount ||
      req.body?.rows ||
      100
    );

    const projectId = req.params.projectId;

    if (!projectId) {
      const error = new Error(
        'Project ID is required.'
      );

      error.statusCode = 400;
      error.code = 'PROJECT_ID_REQUIRED';

      throw error;
    }

    let retryProjectQuery = supabase
      .from('projects')
      .select('id, created_by')
      .eq('id', projectId);

    if (user?.id) {
      retryProjectQuery = retryProjectQuery.eq('created_by', user.id);
    }

    const { data: retryProject, error: retryProjectError } = await retryProjectQuery.maybeSingle();
    if (retryProjectError) throw retryProjectError;
    if (!retryProject) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const result = await retryDataInsertForProject({
      supabase,
      accessToken,
      userId: user.id,
      userEmail: user.email,
      projectId,
      rowCount
    });

    return res.json({
      success: true,
      message:
        'Retry Data Insert completed successfully.',
      data: result
    });
  } catch (error) {
    return next(error);
  }
}

async function getProjectDataModelHandler(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projectId = req.params.projectId;

    let projectQuery = supabase
      .from('projects')
      .select('id, created_by')
      .eq('id', projectId);

    if (req.user?.id) {
      projectQuery = projectQuery.eq('created_by', req.user.id);
    }

    const { data: project, error: projectError } = await projectQuery.maybeSingle();
    if (projectError) throw projectError;
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    const dataModel = await getProjectDataModel({
      supabase,
      projectId
    });

    return res.json({
      success: true,
      data: dataModel
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listTables,
  buildTable,
  generateAndInsertData,
  getGeneratedTableBySchema,
  populateGeneratedTable,
  getRows,
  generateTablesForProjectHandler,
  retryDataInsertHandler,
  getProjectDataModelHandler
};
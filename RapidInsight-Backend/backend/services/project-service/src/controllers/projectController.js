const { createSupabaseClient, createSupabaseAdminClient } = require('../config/supabase');
const getAccessTokenFromRequest = require('../utils/getAccessTokenFromRequest');
const { findOrCreateCustomerOrganisation } = require('../services/customerService');
const {
  DASHBOARD_COLUMNS,
  ensureDashboardForProject
} = require('../services/dashboardService');
const { listAllProjects, getProjectById, createProject } = require('../services/projectService');
const { deleteProjectCompletely } = require('../services/projectDeleteService');

function getSupabase(req) {
  return createSupabaseClient(getAccessTokenFromRequest(req));
}

async function getMe(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, auth_user_id, username, email, created_at, updated_at')
      .eq('auth_user_id', req.user.id)
      .maybeSingle();

    if (error) throw error;

    if (!profile) {
      return res.status(404).json({ success: false, message: 'Profile not found.' });
    }

    return res.json({
      success: true,
      user: req.user,
      profile
    });
  } catch (error) {
    next(error);
  }
}

async function listProjects(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projects = await listAllProjects({ supabase, userId: req.user?.id });

    return res.json({
      success: true,
      count: projects.length,
      data: projects
    });
  } catch (error) {
    next(error);
  }
}

async function getProject(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const project = await getProjectById({ supabase, projectId: req.params.projectId, userId: req.user?.id });

    const { data: dashboard, error: dashboardError } = await supabase
      .from('dashboards')
      .select(DASHBOARD_COLUMNS)
      .eq('project_id', project.id)
      .maybeSingle();

    if (dashboardError) throw dashboardError;

    return res.json({
      success: true,
      data: {
        ...project,
        dashboard: dashboard || null
      }
    });
  } catch (error) {
    next(error);
  }
}

async function createProjectHandler(req, res, next) {
  try {
    const supabase = getSupabase(req);

    const projectName = req.body.name || req.body.projectName;
    const customerName = req.body.customerName || req.body.organisationName;
    const description = req.body.description;

    const organisation = await findOrCreateCustomerOrganisation({
      supabase,
      customerName,
      userId: req.user.id
    });

    const project = await createProject({
      supabase,
      userId: req.user.id,
      organisation,
      name: projectName,
      description
    });

    const dashboard = await ensureDashboardForProject({
      supabase,
      projectId: project.id,
      userId: req.user.id
    });

    return res.status(201).json({
      success: true,
      message: 'Project created successfully.',
      data: {
        ...project,
        organisation,
        dashboard
      }
    });
  } catch (error) {
    next(error);
  }
}

async function getProjectDashboard(req, res, next) {
  try {
    const supabase = getSupabase(req);
    const projectId = req.params.projectId;

    const project = await getProjectById({ supabase, projectId, userId: req.user?.id });

    const dashboard = await ensureDashboardForProject({
      supabase,
      projectId,
      userId: project.created_by || req.user.id
    });

    const { data: schemas, error: schemasError } = await supabase
      .from('schemas')
      .select('id, project_id, user_id, original_file_name, display_name, file_type, status, field_count, table_status, generated_table_id, physical_schema_name, sanitized_table_name, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (schemasError) throw schemasError;

    const { data: generatedTables, error: tablesError } = await supabase
      .from('generated_tables')
      .select('id, schema_id, project_id, created_by, physical_schema_name, physical_table_name, row_count, status, version, source_file_name, created_at, updated_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (tablesError) throw tablesError;

    const totalRows = (generatedTables || []).reduce(
      (sum, table) => sum + Number(table.row_count || 0),
      0
    );

    return res.json({
      success: true,
      data: {
        dashboard,
        project,
        summary: {
          totalSchemas: schemas?.length || 0,
          totalTables: generatedTables?.length || 0,
          totalRows
        },
        schemas: schemas || [],
        generatedTables: generatedTables || []
      }
    });
  } catch (error) {
    next(error);
  }
}

async function deleteProjectHandler(req, res, next) {
  try {
    const projectId = req.params.projectId;
    const userSupabase = getSupabase(req);

    // Confirms the project exists and is visible to this user (RLS-scoped),
    // doubling as the authorization check before the admin-privileged delete.
    await getProjectById({ supabase: userSupabase, projectId, userId: req.user?.id });

    const adminSupabase = createSupabaseAdminClient();

    const result = await deleteProjectCompletely({
      supabase: adminSupabase,
      projectId
    });

    return res.status(200).json({
      success: true,
      message: 'Project and all associated data deleted successfully.',
      data: result
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getMe,
  listProjects,
  getProject,
  createProjectHandler,
  getProjectDashboard,
  deleteProjectHandler
};
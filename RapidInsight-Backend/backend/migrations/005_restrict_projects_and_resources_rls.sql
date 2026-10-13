-- Migration 005: Restrict projects and resources to authorized users via RLS
-- Fixes cross-user data leakage where any authenticated user could read all projects,
-- schemas, generated tables, dashboards, and data models.

-- 1. Ensure helper functions enforce strict project access by project creator
CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.created_by = auth.uid()
  );
$function$;

CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.created_by = auth.uid()
  );
$function$;

-- 2. Projects Table RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS projects_select_all_authenticated ON public.projects;
DROP POLICY IF EXISTS projects_select_authorized ON public.projects;
CREATE POLICY projects_select_authorized ON public.projects
FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.user_has_project_access(id));

DROP POLICY IF EXISTS projects_delete_creator ON public.projects;
CREATE POLICY projects_delete_creator ON public.projects
FOR DELETE TO authenticated
USING (created_by = auth.uid());

-- 3. Schemas Table RLS
ALTER TABLE public.schemas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schemas_select_all_authenticated ON public.schemas;
DROP POLICY IF EXISTS schemas_select_authorized ON public.schemas;
CREATE POLICY schemas_select_authorized ON public.schemas
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.user_has_project_access(project_id));

DROP POLICY IF EXISTS schemas_delete_authorized ON public.schemas;
CREATE POLICY schemas_delete_authorized ON public.schemas
FOR DELETE TO authenticated
USING (user_id = auth.uid() OR public.user_has_project_access(project_id));

-- 4. Generated Tables Table RLS
ALTER TABLE public.generated_tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_tables_select_all_authenticated ON public.generated_tables;
DROP POLICY IF EXISTS generated_tables_select_authorized ON public.generated_tables;
CREATE POLICY generated_tables_select_authorized ON public.generated_tables
FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.user_has_project_access(project_id));

DROP POLICY IF EXISTS generated_tables_insert_authenticated ON public.generated_tables;
DROP POLICY IF EXISTS generated_tables_insert_authorized ON public.generated_tables;
CREATE POLICY generated_tables_insert_authorized ON public.generated_tables
FOR INSERT TO authenticated
WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS generated_tables_update_authenticated ON public.generated_tables;
DROP POLICY IF EXISTS generated_tables_update_authorized ON public.generated_tables;
CREATE POLICY generated_tables_update_authorized ON public.generated_tables
FOR UPDATE TO authenticated
USING (public.user_has_project_access(project_id))
WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS generated_tables_delete_authorized ON public.generated_tables;
CREATE POLICY generated_tables_delete_authorized ON public.generated_tables
FOR DELETE TO authenticated
USING (public.user_has_project_access(project_id));

-- 5. Dashboards Table RLS
ALTER TABLE public.dashboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboards_select_all_authenticated ON public.dashboards;
DROP POLICY IF EXISTS dashboards_select_authorized ON public.dashboards;
CREATE POLICY dashboards_select_authorized ON public.dashboards
FOR SELECT TO authenticated
USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS dashboards_insert_authenticated ON public.dashboards;
DROP POLICY IF EXISTS dashboards_insert_authorized ON public.dashboards;
CREATE POLICY dashboards_insert_authorized ON public.dashboards
FOR INSERT TO authenticated
WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS dashboards_update_authenticated ON public.dashboards;
DROP POLICY IF EXISTS dashboards_update_authorized ON public.dashboards;
CREATE POLICY dashboards_update_authorized ON public.dashboards
FOR UPDATE TO authenticated
USING (public.user_has_project_access(project_id))
WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS dashboards_delete_authenticated ON public.dashboards;
DROP POLICY IF EXISTS dashboards_delete_authorized ON public.dashboards;
CREATE POLICY dashboards_delete_authorized ON public.dashboards
FOR DELETE TO authenticated
USING (public.user_has_project_access(project_id));

-- 6. Project Data Models Table RLS
ALTER TABLE public.project_data_models ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own project data models" ON public.project_data_models;
DROP POLICY IF EXISTS project_data_models_select_authorized ON public.project_data_models;
CREATE POLICY project_data_models_select_authorized ON public.project_data_models
FOR SELECT TO authenticated
USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Users can insert own project data models" ON public.project_data_models;
DROP POLICY IF EXISTS project_data_models_insert_authorized ON public.project_data_models;
CREATE POLICY project_data_models_insert_authorized ON public.project_data_models
FOR INSERT TO authenticated
WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Users can update own project data models" ON public.project_data_models;
DROP POLICY IF EXISTS project_data_models_update_authorized ON public.project_data_models;
CREATE POLICY project_data_models_update_authorized ON public.project_data_models
FOR UPDATE TO authenticated
USING (public.user_has_project_access(project_id))
WITH CHECK (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS "Users can delete own project data models" ON public.project_data_models;
DROP POLICY IF EXISTS project_data_models_delete_authorized ON public.project_data_models;
CREATE POLICY project_data_models_delete_authorized ON public.project_data_models
FOR DELETE TO authenticated
USING (public.user_has_project_access(project_id));


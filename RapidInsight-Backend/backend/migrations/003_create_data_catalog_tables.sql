-- Migration: 003_create_data_catalog_tables.sql
-- Description: Creates data_source, catalog_asset, and asset_column tables with hardened RLS and narrow-boundary consistency triggers.

-- 1. Pre-Flight Validation Block (Checks all 3 tables for incompatible drift)
DO $$
DECLARE
    v_missing TEXT;
BEGIN
    -- Check data_source if it pre-exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'data_source') THEN
        SELECT string_agg(col, ', ') INTO v_missing
        FROM unnest(ARRAY['source_id', 'project_id', 'organisation_id', 'source_name', 'source_type', 'status', 'created_by']) AS col
        WHERE col NOT IN (
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'data_source'
        );
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'Incompatible pre-existing table public.data_source detected. Missing columns: %', v_missing;
        END IF;
    END IF;

    -- Check catalog_asset if it pre-exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'catalog_asset') THEN
        SELECT string_agg(col, ', ') INTO v_missing
        FROM unnest(ARRAY['asset_id', 'source_id', 'project_id', 'schema_name', 'asset_name', 'asset_type', 'fq_name', 'status', 'created_by']) AS col
        WHERE col NOT IN (
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'catalog_asset'
        );
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'Incompatible pre-existing table public.catalog_asset detected. Missing columns: %', v_missing;
        END IF;
    END IF;

    -- Check asset_column if it pre-exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'asset_column') THEN
        SELECT string_agg(col, ', ') INTO v_missing
        FROM unnest(ARRAY['column_id', 'asset_id', 'column_name', 'data_type', 'ordinal_position', 'is_pk', 'is_nullable']) AS col
        WHERE col NOT IN (
            SELECT column_name FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = 'asset_column'
        );
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION 'Incompatible pre-existing table public.asset_column detected. Missing columns: %', v_missing;
        END IF;
    END IF;
END $$;

-- 2. Hardened Helper Functions (SECURITY DEFINER with fixed search_path)
CREATE OR REPLACE FUNCTION public.user_has_project_access(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id
      AND (
        p.created_by = auth.uid()
        OR p.organisation_id IN (
          SELECT o.id FROM public.organisations o WHERE o.created_by = auth.uid()
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.user_has_project_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_project_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_project_access(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.created_by = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_project_creator(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_creator(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_creator(UUID) TO service_role;

-- 3. DATA_SOURCE Table
CREATE TABLE IF NOT EXISTS public.data_source (
    source_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES public.organisations(id) ON DELETE CASCADE,
    source_name TEXT NOT NULL CHECK (char_length(trim(source_name)) >= 1 AND char_length(source_name) <= 128),
    source_type TEXT NOT NULL CHECK (source_type IN ('INTERNAL_PROJECT_DB', 'FILE_UPLOAD', 'EXTERNAL_POSTGRESQL')),
    environment TEXT NOT NULL DEFAULT 'development' CHECK (environment IN ('development', 'staging', 'production')),
    host TEXT CHECK (host IS NULL OR char_length(trim(host)) >= 1),
    port INTEGER CHECK (port IS NULL OR (port >= 1 AND port <= 65535)),
    database_name TEXT CHECK (database_name IS NULL OR char_length(trim(database_name)) >= 1),
    auth_type TEXT NOT NULL DEFAULT 'NONE' CHECK (auth_type IN ('NONE', 'SECRET_REF', 'SERVICE_ROLE')),
    credential_secret_ref TEXT CHECK (credential_secret_ref IS NULL OR char_length(trim(credential_secret_ref)) >= 1),
    owner_team TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'ERROR', 'DEPRECATED')),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_data_source_project_name UNIQUE (project_id, source_name),
    CONSTRAINT uq_data_source_id_project UNIQUE (source_id, project_id)
);

-- Trigger: Reliably derive and validate organisation_id from project_id before NOT NULL check
CREATE OR REPLACE FUNCTION public.sync_data_source_organisation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    SELECT organisation_id INTO v_org_id FROM public.projects WHERE id = NEW.project_id;
    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Referenced project (%) does not exist or has no organisation', NEW.project_id;
    END IF;
    IF NEW.organisation_id IS NOT NULL AND NEW.organisation_id <> v_org_id THEN
        RAISE EXCEPTION 'data_source organisation_id (%) does not match project organisation_id (%)', NEW.organisation_id, v_org_id;
    END IF;
    NEW.organisation_id := v_org_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_data_source_sync_organisation ON public.data_source;
CREATE TRIGGER trg_data_source_sync_organisation
BEFORE INSERT OR UPDATE ON public.data_source
FOR EACH ROW EXECUTE FUNCTION public.sync_data_source_organisation();

-- 4. CATALOG_ASSET Table
CREATE TABLE IF NOT EXISTS public.catalog_asset (
    asset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    schema_id UUID REFERENCES public.schemas(id) ON DELETE SET NULL,
    generated_table_id UUID REFERENCES public.generated_tables(id) ON DELETE SET NULL,
    schema_name TEXT NOT NULL CHECK (char_length(trim(schema_name)) >= 1),
    asset_name TEXT NOT NULL CHECK (char_length(trim(asset_name)) >= 1),
    asset_type TEXT NOT NULL DEFAULT 'TABLE' CHECK (asset_type IN ('TABLE', 'VIEW', 'FILE_SCHEMA')),
    fq_name TEXT NOT NULL CHECK (char_length(trim(fq_name)) >= 1),
    owner_steward TEXT,
    classification TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'DRAFT', 'DEPRECATED')),
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_catalog_asset_source FOREIGN KEY (source_id, project_id) REFERENCES public.data_source(source_id, project_id) ON DELETE CASCADE,
    CONSTRAINT uq_catalog_asset_source_fqname UNIQUE (source_id, fq_name),
    CONSTRAINT uq_catalog_asset_id_project UNIQUE (asset_id, project_id)
);

-- Trigger: Validate schema_id and generated_table_id belong to same project
CREATE OR REPLACE FUNCTION public.check_catalog_asset_project_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.schema_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.schemas s WHERE s.id = NEW.schema_id AND s.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'catalog_asset schema_id (%) does not belong to project_id (%)', NEW.schema_id, NEW.project_id;
    END IF;

    IF NEW.generated_table_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.generated_tables gt WHERE gt.id = NEW.generated_table_id AND gt.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'catalog_asset generated_table_id (%) does not belong to project_id (%)', NEW.generated_table_id, NEW.project_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_catalog_asset_project_consistency ON public.catalog_asset;
CREATE TRIGGER trg_catalog_asset_project_consistency
BEFORE INSERT OR UPDATE ON public.catalog_asset
FOR EACH ROW EXECUTE FUNCTION public.check_catalog_asset_project_consistency();

-- 5. ASSET_COLUMN Table
CREATE TABLE IF NOT EXISTS public.asset_column (
    column_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id UUID NOT NULL REFERENCES public.catalog_asset(asset_id) ON DELETE CASCADE,
    column_name TEXT NOT NULL CHECK (char_length(trim(column_name)) >= 1),
    data_type TEXT NOT NULL CHECK (char_length(trim(data_type)) >= 1),
    ordinal_position INTEGER NOT NULL CHECK (ordinal_position >= 0),
    is_pk BOOLEAN NOT NULL DEFAULT false,
    is_nullable BOOLEAN NOT NULL DEFAULT true,
    classification TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (classification IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_asset_column_asset_name UNIQUE (asset_id, column_name),
    CONSTRAINT uq_asset_column_asset_position UNIQUE (asset_id, ordinal_position)
);

-- 6. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_data_source_project_id ON public.data_source(project_id);
CREATE INDEX IF NOT EXISTS idx_data_source_org_id ON public.data_source(organisation_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_project_id ON public.catalog_asset(project_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_source_id ON public.catalog_asset(source_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_schema_id ON public.catalog_asset(schema_id);
CREATE INDEX IF NOT EXISTS idx_catalog_asset_generated_table_id ON public.catalog_asset(generated_table_id);
CREATE INDEX IF NOT EXISTS idx_asset_column_asset_id ON public.asset_column(asset_id);

-- 7. Enable Row Level Security (RLS)
ALTER TABLE public.data_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_column ENABLE ROW LEVEL SECURITY;

-- 8. Strict Tenant-Isolated RLS Policies
-- DATA_SOURCE Policies
DROP POLICY IF EXISTS data_source_select ON public.data_source;
CREATE POLICY data_source_select ON public.data_source
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS data_source_insert ON public.data_source;
CREATE POLICY data_source_insert ON public.data_source
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS data_source_update ON public.data_source;
CREATE POLICY data_source_update ON public.data_source
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS data_source_delete ON public.data_source;
CREATE POLICY data_source_delete ON public.data_source
  FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

-- CATALOG_ASSET Policies
DROP POLICY IF EXISTS catalog_asset_select ON public.catalog_asset;
CREATE POLICY catalog_asset_select ON public.catalog_asset
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_asset_insert ON public.catalog_asset;
CREATE POLICY catalog_asset_insert ON public.catalog_asset
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_asset_update ON public.catalog_asset;
CREATE POLICY catalog_asset_update ON public.catalog_asset
  FOR UPDATE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_asset_delete ON public.catalog_asset;
CREATE POLICY catalog_asset_delete ON public.catalog_asset
  FOR DELETE TO authenticated
  USING ((created_by = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));

-- ASSET_COLUMN Policies
DROP POLICY IF EXISTS asset_column_select ON public.asset_column;
CREATE POLICY asset_column_select ON public.asset_column
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND public.user_has_project_access(ca.project_id)
  ));

DROP POLICY IF EXISTS asset_column_insert ON public.asset_column;
CREATE POLICY asset_column_insert ON public.asset_column
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND public.user_has_project_access(ca.project_id)
  ));

DROP POLICY IF EXISTS asset_column_update ON public.asset_column;
CREATE POLICY asset_column_update ON public.asset_column
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND (ca.created_by = auth.uid() OR public.is_project_creator(ca.project_id))
      AND public.user_has_project_access(ca.project_id)
  ));

DROP POLICY IF EXISTS asset_column_delete ON public.asset_column;
CREATE POLICY asset_column_delete ON public.asset_column
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalog_asset ca
    WHERE ca.asset_id = asset_column.asset_id
      AND (ca.created_by = auth.uid() OR public.is_project_creator(ca.project_id))
      AND public.user_has_project_access(ca.project_id)
  ));


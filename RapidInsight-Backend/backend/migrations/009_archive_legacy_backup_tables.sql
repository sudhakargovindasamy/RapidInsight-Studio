-- Migration: 009_archive_legacy_backup_tables.sql
-- Description: Move legacy snapshot tables from public schema to dedicated archive schema
--              with strict least-privilege security permissions.
-- Safety: Preserves all 24 historical rows without dropping any data. Fully repeat-safe (idempotent).
-- Author: RapidInsightStudio Architecture Team
-- Date: October 15, 2026

BEGIN;

-- 1. Ensure dedicated archive schema exists
CREATE SCHEMA IF NOT EXISTS archive;

-- 2. Move legacy snapshot tables to archive schema if they currently exist in public schema
-- Uses defensive catalog checks to skip tables already moved, ensuring repeat-safety.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'if_before_project_schema') THEN
    ALTER TABLE public.if_before_project_schema SET SCHEMA archive;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backup_profiles_before_project_schema') THEN
    ALTER TABLE public.backup_profiles_before_project_schema SET SCHEMA archive;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backup_projects_before_project_schema') THEN
    ALTER TABLE public.backup_projects_before_project_schema SET SCHEMA archive;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backup_schemas_before_project_schema') THEN
    ALTER TABLE public.backup_schemas_before_project_schema SET SCHEMA archive;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'backup_generated_tables_before_project_schema') THEN
    ALTER TABLE public.backup_generated_tables_before_project_schema SET SCHEMA archive;
  END IF;
END $$;

-- 3. Lock down schema-level privileges (Least Privilege Principle)
-- Strip public and unauthenticated access from the archive schema namespace
REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA archive TO postgres, service_role;

-- 4. Lock down table-level privileges
-- Revoke broad public privileges inherited from the public schema
DO $$
DECLARE
  tbl text;
  backup_tables text[] := ARRAY[
    'if_before_project_schema',
    'backup_profiles_before_project_schema',
    'backup_projects_before_project_schema',
    'backup_schemas_before_project_schema',
    'backup_generated_tables_before_project_schema'
  ];
BEGIN
  FOREACH tbl IN ARRAY backup_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'archive' AND tablename = tbl) THEN
      EXECUTE format('REVOKE ALL ON TABLE archive.%I FROM PUBLIC, anon, authenticated;', tbl);
      EXECUTE format('GRANT SELECT ON TABLE archive.%I TO postgres, service_role;', tbl);
    END IF;
  END LOOP;
END $$;

-- 5. Lock down default privileges for any future objects created in archive schema
-- Note: Applies to objects created by the migrating role (e.g. postgres)
ALTER DEFAULT PRIVILEGES IN SCHEMA archive REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA archive GRANT SELECT ON TABLES TO postgres, service_role;

-- 6. Document the archive schema and operational requirements
COMMENT ON SCHEMA archive IS
  'Cold storage schema for legacy snapshot tables predating multi-tenant project schemas. Note: Administrators must independently verify that PostgREST exposed-schemas (pgrst.db_schemas) omits archive to ensure zero HTTP API exposure.';

COMMIT;

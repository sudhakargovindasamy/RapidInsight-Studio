-- Migration: 010_optimize_dashboards_indexes.sql
-- Description: Drop redundant duplicate indexes on public.dashboards(project_id).
-- Safety: Preserves dashboards_project_id_unique which enforces the 1:1 business constraint. Fully repeat-safe.
-- Author: RapidInsightStudio Architecture Team
-- Date: October 15, 2026

BEGIN;

-- 1. Drop redundant duplicate unique index on project_id
-- (dashboards_project_id_unique is preserved and continues enforcing the UNIQUE constraint)
DROP INDEX IF EXISTS public.dashboards_project_id_unique_idx;

-- 2. Drop redundant duplicate non-unique btree index on project_id
DROP INDEX IF EXISTS public.dashboards_project_id_idx;

COMMIT;


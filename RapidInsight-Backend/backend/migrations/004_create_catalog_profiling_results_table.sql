-- Migration: 004_create_catalog_profiling_results_table.sql
-- Description: Create persistent table for catalog profiling run history and statistics

CREATE TABLE IF NOT EXISTS public.catalog_profiling_result (
    result_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source_id UUID REFERENCES public.data_source(source_id) ON DELETE SET NULL,
    source_name TEXT NOT NULL,
    asset_id UUID REFERENCES public.catalog_asset(asset_id) ON DELETE SET NULL,
    asset_name TEXT NOT NULL,
    column_id UUID REFERENCES public.asset_column(column_id) ON DELETE SET NULL,
    column_name TEXT NOT NULL,
    data_type TEXT NOT NULL,
    statistic TEXT NOT NULL CHECK (statistic IN ('NULL_COUNT', 'COUNT', 'DISTINCT_COUNT', 'MIN', 'MAX', 'AVG')),
    result_value NUMERIC,
    sample_size BIGINT NOT NULL DEFAULT 0,
    execution_duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast retrieval by project ordered by date
CREATE INDEX IF NOT EXISTS idx_catalog_profiling_result_project_created
ON public.catalog_profiling_result(project_id, created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.catalog_profiling_result ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS catalog_profiling_result_select ON public.catalog_profiling_result;
CREATE POLICY catalog_profiling_result_select ON public.catalog_profiling_result
  FOR SELECT TO authenticated
  USING (public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_profiling_result_insert ON public.catalog_profiling_result;
CREATE POLICY catalog_profiling_result_insert ON public.catalog_profiling_result
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.user_has_project_access(project_id));

DROP POLICY IF EXISTS catalog_profiling_result_delete ON public.catalog_profiling_result;
CREATE POLICY catalog_profiling_result_delete ON public.catalog_profiling_result
  FOR DELETE TO authenticated
  USING ((user_id = auth.uid() OR public.is_project_creator(project_id)) AND public.user_has_project_access(project_id));


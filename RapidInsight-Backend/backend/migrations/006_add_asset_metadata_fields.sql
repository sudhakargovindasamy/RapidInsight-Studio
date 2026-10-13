-- Migration: 006_add_asset_metadata_fields.sql
-- Description: Adds file_size, sheet_name, column_count, and mime_type to catalog_asset and schemas tables.

ALTER TABLE public.catalog_asset ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.catalog_asset ADD COLUMN IF NOT EXISTS sheet_name TEXT;
ALTER TABLE public.catalog_asset ADD COLUMN IF NOT EXISTS column_count INTEGER;
ALTER TABLE public.catalog_asset ADD COLUMN IF NOT EXISTS mime_type TEXT;

ALTER TABLE public.schemas ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.schemas ADD COLUMN IF NOT EXISTS sheet_name TEXT;
ALTER TABLE public.schemas ADD COLUMN IF NOT EXISTS mime_type TEXT;


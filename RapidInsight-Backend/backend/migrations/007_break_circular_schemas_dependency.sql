-- Migration: 007_break_circular_schemas_dependency.sql
-- Description: Break circular foreign key constraint between public.schemas and public.generated_tables,
--              and install an AFTER DELETE trigger to maintain referential integrity without cyclic DDL.
-- Safety: Fully repeat-safe (idempotent). Transactional. Preserves schemas.generated_table_id.
-- Author: RapidInsightStudio Architecture Team
-- Date: October 15, 2026

BEGIN;

-- 1. Drop the circular foreign key constraint from schemas to generated_tables
-- Note: The column 'generated_table_id' is preserved intact for application and UI backward-compatibility.
ALTER TABLE public.schemas
  DROP CONSTRAINT IF EXISTS schemas_generated_table_id_fkey;

-- 2. Create the cleanup trigger function to nullify stale references upon deletion of generated tables
-- SECURITY DEFINER and explicit search_path prevents search_path manipulation.
CREATE OR REPLACE FUNCTION public.trg_fn_nullify_schema_generated_table_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Clear the logical pointer in public.schemas if it references the deleted generated table
  UPDATE public.schemas
  SET generated_table_id = NULL
  WHERE generated_table_id = OLD.id;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.trg_fn_nullify_schema_generated_table_id() IS
  'Trigger function ensuring schemas.generated_table_id is set to NULL when the referenced generated_tables row is deleted.';

-- 3. Install the AFTER DELETE trigger on generated_tables
DROP TRIGGER IF EXISTS trg_nullify_schema_generated_table_id ON public.generated_tables;
CREATE TRIGGER trg_nullify_schema_generated_table_id
  AFTER DELETE ON public.generated_tables
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_nullify_schema_generated_table_id();

-- 4. Document the architectural relationship in the database catalog
COMMENT ON COLUMN public.schemas.generated_table_id IS
  'Logical tracker ID for generated table. Unidirectional database foreign key is owned by generated_tables.schema_id; nullification on delete maintained by trg_nullify_schema_generated_table_id.';

COMMIT;

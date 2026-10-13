-- Seed rows for SDV training.
--
-- Every schema uploaded with "Generate mock data" gets a set of LLM-written
-- example rows at upload time. These columns track that work: where the rows
-- live, whether they are ready, and why they failed if they did.
--
-- Run once against the project database. Safe to re-run.

alter table schemas
  add column if not exists seed_storage_path text,
  add column if not exists seed_row_count integer,
  add column if not exists seed_error text,
  add column if not exists seed_generated_at timestamptz,

  -- sha256 of the schema definition the seeds were generated from. Section 7 of
  -- docs/sdv-migration-plan.md: caches are keyed by file contents, not filename,
  -- so this is what tells us the stored seeds no longer match the schema.
  add column if not exists seed_fingerprint text,

  add column if not exists seed_status text not null default 'pending';

-- not_required covers schemas uploaded with "Use my data". They already have
-- real rows, so they never need seeds - but the Generate Tables button checks
-- that every schema is accounted for, and a null would be ambiguous.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'schemas_seed_status_check'
  ) then
    alter table schemas
      add constraint schemas_seed_status_check
      check (seed_status in ('pending', 'generating', 'ready', 'failed', 'not_required'));
  end if;
end $$;

-- Existing rows predate this feature. Anything uploaded with real data never
-- needs seeds; anything else has not had them generated yet.
update schemas
   set seed_status = case
                       when data_source = 'uploaded' then 'not_required'
                       else 'pending'
                     end
 where seed_status is null
    or seed_status = 'pending';

-- The Generate Tables gate asks "is every schema in this project ready?", which
-- is a per-project scan of this column.
create index if not exists schemas_seed_status_idx
  on schemas (project_id, seed_status);
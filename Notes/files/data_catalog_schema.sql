-- ============================================================
-- DATA CATALOG SCHEMA — Postgres / Supabase
-- Phase 1: Register | Phase 2: Catalog & Monitor | Phase 3: Profiling & Stats
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- PHASE 1: REGISTER THE ASSET ----------

create table data_source (
  source_id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_type text not null check (source_type in
    ('oracle','postgres','sqlserver','mysql','snowflake','bigquery','s3','redshift')),
  environment text check (environment in ('prod','staging','dev')),
  host text,
  port int,
  auth_type text check (auth_type in ('basic','iam','oauth','service_account')),
  vault_secret_ref text,
  owner_team text,
  status text not null default 'active' check (status in ('active','inactive','pending')),
  created_at timestamptz not null default now()
);

create table discovery_job (
  job_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references data_source(source_id) on delete cascade,
  schedule_cron text,
  last_run_at timestamptz,
  last_status text check (last_status in ('success','failed','running')),
  assets_discovered int default 0,
  created_at timestamptz not null default now()
);

-- ---------- PHASE 2: CATALOG AND MONITOR ----------

create table catalog_asset (
  asset_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references data_source(source_id) on delete cascade,
  schema_name text,
  asset_name text not null,
  asset_type text check (asset_type in ('table','view','topic','file','api')),
  fq_name text not null,
  owner text,
  steward text,
  classification text check (classification in ('public','internal','confidential','pii','sensitive')),
  status text not null default 'active' check (status in ('active','deprecated','archived')),
  updated_at timestamptz not null default now(),
  unique (source_id, fq_name)
);

create table asset_column (
  column_id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references catalog_asset(asset_id) on delete cascade,
  column_name text not null,
  data_type text,
  ordinal_position int,
  is_pk boolean default false,
  nullable boolean default true,
  classification text check (classification in ('public','internal','confidential','pii','sensitive')),
  unique (asset_id, column_name)
);

create table monitor_check (
  monitor_id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references catalog_asset(asset_id) on delete cascade,
  check_type text check (check_type in ('freshness','volume','schema_drift','availability')),
  threshold_expr text,
  schedule_cron text,
  last_status text check (last_status in ('ok','warn','fail')),
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create table monitor_alert (
  alert_id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references monitor_check(monitor_id) on delete restrict,
  severity text check (severity in ('low','medium','high','critical')),
  message text,
  triggered_at timestamptz not null default now(),
  resolved_at timestamptz,
  status text not null default 'open' check (status in ('open','acknowledged','resolved'))
);

create table lineage (
  lineage_id uuid primary key default gen_random_uuid(),
  source_asset_id uuid not null references catalog_asset(asset_id) on delete cascade,
  target_asset_id uuid not null references catalog_asset(asset_id) on delete cascade,
  transform_job text,
  transform_type text check (transform_type in ('etl','elt','view','stream','manual')),
  created_at timestamptz not null default now(),
  check (source_asset_id <> target_asset_id)
);

-- ---------- PHASE 3: PROFILING AND STATS ----------

create table profiling_job (
  profiling_job_id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references catalog_asset(asset_id) on delete cascade,
  schedule_cron text,
  engine text check (engine in ('native_sql','spark','python')),
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table profile_run (
  run_id uuid primary key default gen_random_uuid(),
  profiling_job_id uuid not null references profiling_job(profiling_job_id) on delete cascade,
  row_count bigint,
  size_bytes bigint,
  duration_ms int,
  status text check (status in ('success','failed','running')),
  run_at timestamptz not null default now()
);

create table column_profile_stat (
  stat_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references profile_run(run_id) on delete cascade,
  column_id uuid not null references asset_column(column_id) on delete cascade,
  null_count bigint,
  null_pct numeric(5,2),
  distinct_count bigint,
  min_value text,
  max_value text,
  mean_value numeric,
  top_values_json jsonb
);

create table data_quality_rule (
  rule_id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references catalog_asset(asset_id) on delete cascade,
  column_id uuid references asset_column(column_id) on delete cascade,
  rule_type text check (rule_type in ('uniqueness','completeness','validity','consistency','accuracy','custom')),
  rule_expression text,
  threshold numeric,
  severity text check (severity in ('low','medium','high','critical')),
  created_at timestamptz not null default now()
);

create table data_quality_result (
  result_id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references data_quality_rule(rule_id) on delete cascade,
  run_id uuid references profile_run(run_id) on delete set null,
  passed_count bigint,
  failed_count bigint,
  pass_rate numeric(5,2),
  status text check (status in ('pass','fail','warn')),
  evaluated_at timestamptz not null default now()
);

-- ---------- INDEXES ----------

create index idx_catalog_asset_source on catalog_asset(source_id);
create index idx_asset_column_asset on asset_column(asset_id);
create index idx_monitor_check_asset on monitor_check(asset_id);
create index idx_monitor_alert_monitor on monitor_alert(monitor_id);
create index idx_lineage_source on lineage(source_asset_id);
create index idx_lineage_target on lineage(target_asset_id);
create index idx_profile_run_job on profile_run(profiling_job_id);
create index idx_column_profile_stat_run on column_profile_stat(run_id);
create index idx_column_profile_stat_column on column_profile_stat(column_id);
create index idx_dq_rule_asset on data_quality_rule(asset_id);
create index idx_dq_result_rule on data_quality_result(rule_id);

-- ---------- ROW LEVEL SECURITY (Supabase stubs) ----------
-- Enable RLS on every table, then add policies matching your auth model.
-- Example shown for catalog_asset; repeat the pattern for the rest.

alter table data_source enable row level security;
alter table discovery_job enable row level security;
alter table catalog_asset enable row level security;
alter table asset_column enable row level security;
alter table monitor_check enable row level security;
alter table monitor_alert enable row level security;
alter table lineage enable row level security;
alter table profiling_job enable row level security;
alter table profile_run enable row level security;
alter table column_profile_stat enable row level security;
alter table data_quality_rule enable row level security;
alter table data_quality_result enable row level security;

create policy "Authenticated users can read catalog_asset"
  on catalog_asset for select
  using (auth.role() = 'authenticated');

-- Add insert/update/delete policies scoped to your team/role model, e.g.:
-- create policy "Owners can update their assets"
--   on catalog_asset for update
--   using (owner = auth.jwt() ->> 'email');

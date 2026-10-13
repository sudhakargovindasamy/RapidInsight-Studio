-- When the current seed-generation attempt began.
--
-- Seed generation lives only in the memory of the process that started it. If
-- that process restarts mid-job, the row keeps saying 'generating' and nothing
-- is left alive to ever move it off that value - the UI then waits forever on a
-- job that no longer exists.
--
-- This timestamp is what makes that state detectable: a row that has been
-- 'generating' for longer than any real run could take is treated as abandoned
-- and can be retried.
--
-- Run once against the project database. Safe to re-run.

alter table schemas
  add column if not exists seed_started_at timestamptz;

-- Rows already stuck in 'generating' when this ships have no start time, and no
-- job behind them either - the deploy that applies this migration is itself the
-- restart that killed them. Fail them now so they are retryable rather than
-- invisible.
update schemas
   set seed_status = 'failed',
       seed_error  = 'Generation was interrupted before this fix was deployed. Retry to run it again.'
 where seed_status = 'generating'
   and seed_started_at is null;

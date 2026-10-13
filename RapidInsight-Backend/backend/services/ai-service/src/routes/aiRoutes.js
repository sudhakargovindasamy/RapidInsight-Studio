const express = require('express');
const verifyInternalRequest = require('../middlewares/verifyInternalRequest');

const {
  generateDataModelBlueprint,
  inferRelationships,
  planKpis,
  planSqlKpis,
  repairSqlKpi,
  buildDashboardSpec,
  writeInsights,
  seedRows
} = require('../controllers/aiController');

const router = express.Router();

router.use(verifyInternalRequest);

// Example rows for one uploaded schema, used to train an SDV model. Called by
// schema-service at upload time rather than during Generate Tables: this is the
// slowest call in the pipeline, and running it per-upload keeps it off the
// critical path of the button click.
router.post('/seed-rows', seedRows);

// Step 1 of the multi-step pipeline: keys and relationships only. The one-shot
// blueprint endpoint stays in place so the existing flow keeps working while
// the remaining steps are built.
router.post('/relationships', inferRelationships);

// Step 3: map requested KPIs onto the confirmed data model from step 1.
router.post('/kpi-plan', planKpis);

// Experimental alternative to /kpi-plan: the model writes SQL directly
// instead of a structured plan. table-service validates and executes it
// (sqlPlanValidator.js) - never trust this route's output as safe on its own.
router.post('/sql-kpi-plan', planSqlKpis);

// Fixes one query that table-service's SQL safety validator rejected -
// a different failure than the structural check /sql-kpi-plan retries on.
router.post('/sql-kpi-repair', repairSqlKpi);

// Step 4: format step 3's plans into the strict dashboard contract.
router.post('/dashboard-spec', buildDashboardSpec);

// Step 6: describe results that step 5 has already computed. Step 5 runs SQL
// in table-service and needs no AI call of its own.
router.post('/insights', writeInsights);

router.post('/data-model-blueprint', generateDataModelBlueprint);

module.exports = router;

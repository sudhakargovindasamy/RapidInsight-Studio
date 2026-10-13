const {
  getAiProvider
} = require('../providers/aiClientFactory');

const {
  buildDashboardSpecPrompt,
  buildDashboardSpecRepairPrompt
} = require('../prompts/dashboardSpecPrompt');

const {
  parseStrictJson
} = require('../utils/safeJsonParser');

const {
  validateDashboardSpecResponse
} = require('../validators/dashboardSpecResponseValidator');

const {
  validateSourceSchemas
} = require('../validators/blueprintResponseValidator');

const MAX_DASHBOARD_SPEC_ATTEMPTS = 3;

// At temperature 0 an identical prompt reproduces an identical response, so a
// repair attempt must change the input: it carries the rejected JSON plus the
// reason, and nudges temperature up to escape a stuck answer.
const REPAIR_TEMPERATURES = [0, 0.2, 0.4];

const REPAIRABLE_STATUS_CODES = new Set([
  422, // strict dashboard validation rejected the response
  502  // response was not valid JSON
]);

// Mirrors the dashboard contract's own limits, enforced downstream by
// analyticsPlanValidator.
const MAX_DASHBOARD_KPIS = 6;
const MAX_DASHBOARD_CHARTS = 6;

function capPlansToDashboardLimits(executablePlans) {
  const kept = [];
  const dropped = [];

  let kpiCount = 0;
  let chartCount = 0;

  executablePlans.forEach((plan) => {
    const isChart = Boolean(plan.group_by_column);

    if (isChart && chartCount < MAX_DASHBOARD_CHARTS) {
      chartCount += 1;
      kept.push(plan);
      return;
    }

    if (!isChart && kpiCount < MAX_DASHBOARD_KPIS) {
      kpiCount += 1;
      kept.push(plan);
      return;
    }

    dropped.push(plan);
  });

  if (dropped.length) {
    console.warn(
      `Dashboard limit reached, ${dropped.length} planned metric(s) left out`,
      { dropped: dropped.map((plan) => plan.request) }
    );
  }

  return kept;
}

// The prompt asks for bare column names, but a model occasionally qualifies
// one with its table anyway ("items.item_name" instead of "item_name").
// table-service's query builder looks columns up by bare name and would
// reject a qualified one, so it is stripped here rather than trusted from the
// prompt alone.
function stripQualifier(value) {
  if (typeof value !== 'string') return value;

  const dotIndex = value.lastIndexOf('.');

  return dotIndex === -1 ? value : value.slice(dotIndex + 1);
}

function stripTableQualifiers(spec) {
  const dashboard = spec?.dashboard;

  if (!dashboard) return;

  (dashboard.kpis || []).forEach((kpi) => {
    if (kpi.column) kpi.column = stripQualifier(kpi.column);
    if (kpi.ratio?.column) kpi.ratio.column = stripQualifier(kpi.ratio.column);
  });

  (dashboard.charts || []).forEach((chart) => {
    if (chart.column) chart.column = stripQualifier(chart.column);
    if (chart.group_by) chart.group_by = stripQualifier(chart.group_by);
    if (chart.ratio?.column) chart.ratio.column = stripQualifier(chart.ratio.column);
  });
}

// Nothing to format, so nothing to ask the provider. Returning the empty shell
// keeps the caller's contract identical whether or not any metric survived
// planning, and saves a pointless request against the rate limit.
function buildEmptyDashboard() {
  return {
    dashboard: {
      version: 1,
      title: 'Generated Dashboard',
      subtitle: 'No requested metric could be answered with the uploaded data',
      domain: 'data_analytics',
      kpis: [],
      charts: [],
      layout: {
        kpi_columns: 4,
        chart_columns: 2
      }
    }
  };
}

/**
 * Step 4 of the multi-step generation pipeline.
 *
 * Translates step 3's plans into the strict dashboard contract. Every
 * analytical choice is already fixed, so this call only formats, and the
 * validator rejects any spec that drifts from the plan it came from.
 */
async function generateDashboardSpec(input) {
  if (!input || !Array.isArray(input.schemas) || input.schemas.length === 0) {
    const error = new Error('schemas are required to build a dashboard spec.');
    error.statusCode = 400;
    throw error;
  }

  const relationshipModel = input.relationship_model || input.relationshipModel;

  if (!relationshipModel || !Array.isArray(relationshipModel.tables)) {
    const error = new Error(
      'relationship_model with tables is required to build a dashboard spec.'
    );

    error.statusCode = 400;
    throw error;
  }

  const plans = input.plans || input.kpi_plans || input.kpiPlans;

  if (!Array.isArray(plans)) {
    const error = new Error(
      'plans are required to build a dashboard spec. Run KPI planning first.'
    );

    error.statusCode = 400;
    throw error;
  }

  validateSourceSchemas(input.schemas);

  const executablePlans = plans.filter(
    (plan) => plan && plan.status === 'executable'
  );

  if (!executablePlans.length) {
    console.warn('No executable KPI plans, returning an empty dashboard', {
      totalPlans: plans.length
    });

    return buildEmptyDashboard();
  }

  /*
   * The dashboard contract allows at most 6 KPIs and 6 charts. Sending more
   * would fail validation downstream with a message that says nothing about
   * why, so the excess is dropped here and logged. Dropping silently would
   * reintroduce the missing-metric problem the split was meant to solve.
   */
  const cappedPlans = capPlansToDashboardLimits(executablePlans);

  const basePrompt = buildDashboardSpecPrompt({ plans: cappedPlans });
  const provider = getAiProvider();

  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= MAX_DASHBOARD_SPEC_ATTEMPTS; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : buildDashboardSpecRepairPrompt(basePrompt, lastError.message, lastResponse);

    const rawResult = await provider.generateDataModelBlueprint({
      prompt,
      input,
      temperature:
        REPAIR_TEMPERATURES[attempt - 1] ??
        REPAIR_TEMPERATURES[REPAIR_TEMPERATURES.length - 1]
    });

    lastResponse = rawResult;

    try {
      const spec =
        typeof rawResult === 'string'
          ? parseStrictJson(rawResult)
          : rawResult;

      stripTableQualifiers(spec);

      validateDashboardSpecResponse(
        spec,
        relationshipModel,
        cappedPlans,
        input.schemas
      );

      if (attempt > 1) {
        console.warn('Dashboard spec accepted after repair attempts', {
          attempts: attempt
        });
      }

      return spec;
    } catch (error) {
      if (!REPAIRABLE_STATUS_CODES.has(error.statusCode)) {
        throw error;
      }

      lastError = error;

      console.warn('Dashboard spec rejected, requesting repair', {
        attempt,
        maxAttempts: MAX_DASHBOARD_SPEC_ATTEMPTS,
        statusCode: error.statusCode,
        reason: error.message
      });
    }
  }

  lastError.message = `${lastError.message} (unresolved after ${MAX_DASHBOARD_SPEC_ATTEMPTS} attempts)`;

  throw lastError;
}

module.exports = {
  generateDashboardSpec
};

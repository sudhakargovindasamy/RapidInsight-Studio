const {
  validateBlueprintResponse,
  logBlueprint,
} = require("./blueprintResponseValidator");

const {
  splitPlansByShape,
} = require("../prompts/dashboardSpecPrompt");

// Step 4 validation.
//
// Two separate concerns:
//
// 1. Contract compliance. Delegated to the existing blueprint validator by
//    assembling a full blueprint from the step 1 model plus this dashboard, so
//    the strict rules that already guard the one-shot response apply here
//    unchanged. Nothing about "is this dashboard well formed" is reimplemented.
//
// 2. Faithfulness to the plan. Step 3 decided the tables, columns, operations,
//    and limits. If step 4 quietly substitutes a different column, the user
//    silently gets a different metric than the one that was planned and
//    explained to them, which is the exact failure the split was meant to
//    remove. The blueprint validator cannot catch this, because the swapped
//    value is usually still a valid column.

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = 422;
    throw error;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

// The formatting step sometimes qualifies a column with its table
// ("items.item_name" instead of "item_name") even though nothing in the
// prompt asks it to. That is still the same column, so compare on the part
// after the last dot rather than rejecting a plan that matches in substance.
function unqualify(value) {
  const normalized = normalize(value);
  const dotIndex = normalized.lastIndexOf(".");

  return dotIndex === -1 ? normalized : normalized.slice(dotIndex + 1);
}

function sameColumn(specValue, planValue) {
  const specIsEmpty = specValue === null || specValue === undefined;
  const planIsEmpty = planValue === null || planValue === undefined || planValue === "";

  if (specIsEmpty && planIsEmpty) return true;
  if (specIsEmpty !== planIsEmpty) return false;

  return unqualify(specValue) === unqualify(planValue);
}

function assertMatchesPlan(item, plan, kind, index) {
  const path = `dashboard.${kind}s[${index}]`;
  const label = `"${plan.request}"`;

  assert(
    normalize(item.table_name) === normalize(plan.base_table),
    `${path} uses table "${item.table_name}" but the plan for ${label} chose "${plan.base_table}".`
  );

  assert(
    normalize(item.operation) === normalize(plan.operation),
    `${path} uses operation "${item.operation}" but the plan for ${label} chose "${plan.operation}".`
  );

  assert(
    sameColumn(item.column, plan.measure_column),
    `${path} measures "${item.column}" but the plan for ${label} chose "${plan.measure_column}".`
  );

  if (plan.ratio_column) {
    assert(
      isObject(item.ratio),
      `${path} is missing the ratio the plan for ${label} requires.`
    );

    assert(
      sameColumn(item.ratio.column, plan.ratio_column),
      `${path} divides by "${item.ratio?.column}" but the plan for ${label} chose "${plan.ratio_column}".`
    );
  } else {
    assert(
      item.ratio === undefined || item.ratio === null,
      `${path} adds a ratio the plan for ${label} did not ask for.`
    );
  }

  if (plan.difference_column) {
    assert(
      isObject(item.difference),
      `${path} is missing the difference the plan for ${label} requires.`
    );

    assert(
      sameColumn(item.difference.column, plan.difference_column),
      `${path} subtracts "${item.difference.column}" but the plan for ${label} chose "${plan.difference_column}".`
    );

    // The plan leaves difference_table null for a same-table subtraction, and
    // the spec omits it for the same case, so both collapse to the base table
    // before comparison.
    const planDifferenceTable = normalize(plan.difference_table || plan.base_table);
    const specDifferenceTable = normalize(item.difference.table || item.table_name);

    assert(
      specDifferenceTable === planDifferenceTable,
      `${path} subtracts a column on "${specDifferenceTable}" but the plan for ${label} chose "${planDifferenceTable}".`
    );

    const planAsPercentage = plan.difference_as_percentage === true;
    const specAsPercentage = item.difference.as_percentage === true;

    assert(
      specAsPercentage === planAsPercentage,
      planAsPercentage
        ? `${path} drops the percentage the plan for ${label} asked for.`
        : `${path} turns the difference into a percentage, which the plan for ${label} did not ask for.`
    );

    if (planAsPercentage) {
      // Only KPIs carry a format; charts have no such property.
      if (item.format !== null && item.format !== undefined) {
        assert(
          normalize(item.format) === "percentage",
          `${path} formats a difference percentage as "${item.format}", but it must be "percentage".`
        );
      }

      // The percentage always runs as summed difference over summed measure,
      // so any other operation here would describe a query that never runs.
      assert(
        normalize(item.difference.operation) === "sum",
        `${path} uses difference operation "${item.difference.operation}", but a difference percentage is always computed with "sum".`
      );
    }
  } else {
    assert(
      item.difference === undefined || item.difference === null,
      `${path} adds a difference the plan for ${label} did not ask for.`
    );
  }

  if (kind === "chart") {
    assert(
      unqualify(item.group_by) === unqualify(plan.group_by_column),
      `${path} groups by "${item.group_by}" but the plan for ${label} chose "${plan.group_by_column}".`
    );

    assert(
      normalize(item.group_by_table) === normalize(plan.group_by_table),
      `${path} groups by table "${item.group_by_table}" but the plan for ${label} chose "${plan.group_by_table}".`
    );

    if (plan.limit) {
      assert(
        item.limit === plan.limit,
        `${path} returns ${item.limit} rows but the plan for ${label} chose ${plan.limit}.`
      );
    }

    if (plan.sort_direction) {
      assert(
        normalize(item.sort) === normalize(plan.sort_direction),
        `${path} sorts "${item.sort}" but the plan for ${label} chose "${plan.sort_direction}".`
      );
    }
  }
}

/**
 * @param {object} response      the model's { dashboard: {...} } reply
 * @param {object} relationshipModel  step 1 tables and relationships
 * @param {Array}  plans         step 3 plans, including unsupported ones
 * @param {Array}  schemas       the uploaded schemas
 */
function validateDashboardSpecResponse(response, relationshipModel, plans, schemas) {
  logBlueprint("RAW DASHBOARD SPEC RESPONSE", response);

  assert(isObject(response), "Dashboard spec response must be a JSON object.");

  Object.keys(response).forEach((property) => {
    assert(
      property === "dashboard",
      `dashboardSpec.${property} is not allowed. Return only dashboard.`
    );
  });

  const dashboard = response.dashboard;

  assert(isObject(dashboard), "dashboardSpec.dashboard must be an object.");
  assert(Array.isArray(dashboard.kpis), "dashboardSpec.dashboard.kpis must be an array.");
  assert(Array.isArray(dashboard.charts), "dashboardSpec.dashboard.charts must be an array.");

  const executablePlans = (plans || []).filter(
    (plan) => plan.status === "executable"
  );

  const { kpiPlans, chartPlans } = splitPlansByShape(executablePlans);

  // A missing object means a planned metric was silently dropped between the
  // plan the user was shown and the dashboard they receive.
  assert(
    dashboard.kpis.length === kpiPlans.length,
    `dashboardSpec.dashboard.kpis must contain one KPI per planned single-number metric (expected ${kpiPlans.length}, got ${dashboard.kpis.length}).`
  );

  assert(
    dashboard.charts.length === chartPlans.length,
    `dashboardSpec.dashboard.charts must contain one chart per planned breakdown metric (expected ${chartPlans.length}, got ${dashboard.charts.length}).`
  );

  dashboard.kpis.forEach((kpi, index) => {
    assertMatchesPlan(kpi, kpiPlans[index], "kpi", index);
  });

  dashboard.charts.forEach((chart, index) => {
    assertMatchesPlan(chart, chartPlans[index], "chart", index);
  });

  /*
   * Reuse the one-shot contract rules rather than restating them. The
   * assembled blueprint carries an empty requested_analysis because the
   * step 3 plan already records feasibility, and the dashboard-to-analysis
   * linkage the blueprint validator enforces only applies to that flow.
   */
  validateBlueprintResponse(
    {
      tables: relationshipModel.tables,
      relationships: relationshipModel.relationships || [],
      requested_analysis: [],
      dashboard
    },
    schemas
  );

  logBlueprint("VALIDATED DASHBOARD SPEC", response);

  return true;
}

module.exports = {
  validateDashboardSpecResponse,
};

// Step 4 of the multi-step pipeline: turn settled KPI plans into the strict
// dashboard contract the query builder consumes.
//
// Every analytical decision was already made in step 3. This step only
// translates, which is why the prompt is mostly a format specification rather
// than guidance: there is nothing left to reason about, and a small model
// formats far more reliably when it is not also deciding.
//
// A plan carries slightly more than the contract holds (business_value, the
// original request text), so those are dropped here rather than smuggled into
// fields the validator would reject.

function describePlan(plan, index) {
  const lines = [
    `PLAN ${index + 1}`,
    `  request        : ${plan.request}`,
    `  base_table     : ${plan.base_table}`,
    `  operation      : ${plan.operation}`,
    `  measure_column : ${plan.measure_column === null || plan.measure_column === undefined ? "null (counting rows)" : plan.measure_column}`
  ];

  if (plan.group_by_column) {
    lines.push(`  group_by       : ${plan.group_by_table}.${plan.group_by_column}`);
  } else {
    lines.push("  group_by       : none (single number)");
  }

  if (plan.ratio_column) {
    lines.push(`  ratio_column   : ${plan.ratio_column} (divide the measure by this)`);
  }

  if (plan.difference_column) {
    const differenceTable = plan.difference_table || plan.base_table;

    lines.push(
      `  difference     : ${differenceTable}.${plan.difference_column} (subtract this from the measure)`
    );

    if (plan.difference_as_percentage === true) {
      lines.push("  difference_as  : percentage of the measure");
    }
  }

  if (plan.sort_direction) {
    lines.push(`  sort           : ${plan.sort_direction}`);
  }

  if (plan.limit) {
    lines.push(`  limit          : ${plan.limit}`);
  }

  return lines.join("\n");
}

// A plan with no dimension is a single number, which belongs in the KPI row.
// A plan grouped by something is a comparison, which belongs in a chart. The
// split is decided here rather than by the model so it stays predictable.
function splitPlansByShape(plans) {
  const kpiPlans = [];
  const chartPlans = [];

  plans.forEach((plan) => {
    if (plan.group_by_column) {
      chartPlans.push(plan);
    } else {
      kpiPlans.push(plan);
    }
  });

  return { kpiPlans, chartPlans };
}

function buildDashboardSpecPrompt({ plans } = {}) {
  const executablePlans = (plans || []).filter(
    (plan) => plan.status === "executable"
  );

  const { kpiPlans, chartPlans } = splitPlansByShape(executablePlans);

  const kpiSection = kpiPlans.length
    ? kpiPlans.map(describePlan).join("\n\n")
    : "(none)";

  const chartSection = chartPlans.length
    ? chartPlans.map(describePlan).join("\n\n")
    : "(none)";

  return `You are a formatting tool. Convert the finished analysis plans below into dashboard JSON.

Every decision is already made. Do not change any table, column, operation, or limit. Do not add plans of your own. Do not drop any plan.

Every column and group_by value must be the bare column name only, exactly as it appears in a plan above (for example "item_name"). Never prefix it with a table name (never "items.item_name").

PLANS THAT BECOME KPIs (single numbers, no breakdown)

${kpiSection}

PLANS THAT BECOME CHARTS (broken down by a dimension)

${chartSection}

KPI OBJECT FORMAT

Every KPI must use exactly these properties and no others:

{
  "id": "kpi_short_name",
  "name": "Readable Name",
  "operation": "sum",
  "table_name": "the plan's base_table",
  "column": "the plan's measure_column, or null when operation is count",
  "format": "number | decimal | currency | percentage"
}

CHART OBJECT FORMAT

Every chart must use exactly these properties and no others:

{
  "id": "chart_short_name",
  "name": "Readable Name",
  "type": "bar | line | pie | doughnut",
  "operation": "sum",
  "table_name": "the plan's base_table",
  "column": "the plan's measure_column, or null when operation is count",
  "group_by": "the plan's group_by_column",
  "group_by_table": "the plan's group_by_table",
  "sort": "asc | desc",
  "limit": 10,
  "time_bucket": null
}

RATIO MEASURES

When a plan has a ratio_column, add this property to that KPI or chart:

  "ratio": { "operation": "sum", "column": "the plan's ratio_column", "scale": 100 }

Use scale 100 when the result is a percentage such as a margin or a rate. Otherwise use scale 1.

DIFFERENCE MEASURES

When a plan has a difference line, add this property to that KPI or chart:

  "difference": { "operation": "sum", "column": "the difference column", "table": "the difference table", "as_percentage": true }

- Copy the column name from the plan's difference line, bare, with no table prefix.
- Set "table" to the table named in the plan's difference line. Omit "table" entirely when it is the same as the object's table_name.
- Set "as_percentage": true only when the plan says "difference_as : percentage of the measure". Otherwise omit the property.
- When "as_percentage" is true, "operation" must be "sum", whatever the plan's own operation says. The percentage is always computed as the summed difference over the summed measure, so writing anything else here would describe a calculation that does not run.
- When "as_percentage" is not set, "operation" is the same operation as the KPI or chart itself.
- Never put both "ratio" and "difference" on the same object.

ID RULES

- Every id must be lowercase snake_case, at most 63 characters.
- KPI ids must start with kpi_.
- Chart ids must start with chart_.
- Every id must be unique across both lists.

NAME RULES

- Base the name on the plan's request text, shortened to a few words in title case.
- Never put a number, value, or result in the name.

FORMAT RULES

- Use "currency" for money such as revenue, sales, cost, or profit.
- Use "percentage" only when the plan has a ratio_column with scale 100, or a difference with as_percentage true. Both of those must use "percentage".
- Use "decimal" for averages that are not money, including a difference between two dates, which is a number of days.
- Use "number" for counts and quantities.
- Never use "percentage" with a plain sum or count.

CHART TYPE RULES

- Use "bar" when comparing a dimension such as products, categories, or regions.
- Use "line" only when the dimension is a date.
- Use "pie" or "doughnut" only for a share of a whole with few categories.
- Never use any other chart type.

TIME BUCKET RULES

- Set time_bucket to "day", "month", or "year" only when group_by is a date column.
- Otherwise time_bucket must be null.

FORBIDDEN

Never include value, values, data, result, results, or any calculated number. The backend runs the queries and fills the numbers in later. You only describe how each one is built.

OUTPUT FORMAT

Return exactly one valid JSON object with this shape and no other properties:

{
  "dashboard": {
    "version": 1,
    "title": "Short Dashboard Title",
    "subtitle": "One short line describing the dashboard",
    "domain": "data_analytics",
    "kpis": [],
    "charts": [],
    "layout": { "kpi_columns": 4, "chart_columns": 2 }
  }
}

Return exactly ${kpiPlans.length} KPI object${kpiPlans.length === 1 ? "" : "s"} and ${chartPlans.length} chart object${chartPlans.length === 1 ? "" : "s"}, one per plan above, in the same order.
Return only the JSON object. No markdown, no explanation, no SQL.`;
}

function buildDashboardSpecRepairPrompt(basePrompt, errorMessage, rejectedResponse) {
  const rejected =
    typeof rejectedResponse === "string"
      ? rejectedResponse
      : JSON.stringify(rejectedResponse, null, 2);

  return `${basePrompt}

PREVIOUS ATTEMPT WAS REJECTED

You returned this JSON:

${rejected}

It was rejected for this reason:

${errorMessage}

Fix only what the rejection reason describes. Keep every other object exactly as it was. Return the complete corrected JSON object.`;
}

module.exports = {
  buildDashboardSpecPrompt,
  buildDashboardSpecRepairPrompt,
  splitPlansByShape,
};

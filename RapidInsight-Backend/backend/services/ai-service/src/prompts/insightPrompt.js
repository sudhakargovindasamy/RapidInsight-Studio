// Step 6 of the multi-step pipeline: written interpretation of results that
// have already been computed.
//
// This is the only step that sees real numbers. Every earlier step reasons
// about schema and intent, so nothing before this point can say whether a
// result is high, concentrated, lopsided, or unremarkable. The one-shot
// blueprint never had this information at all, which is why its dashboards
// arrived with no narrative.
//
// Values are rounded and chart series truncated before they reach the model:
// a long tail of near-identical rows crowds out the part worth commenting on,
// and the exact decimals are already on screen.

const MAX_CHART_POINTS = 12;

function formatNumber(value) {
  if (value === null || value === undefined) return "no value";

  const number = Number(value);

  if (!Number.isFinite(number)) return String(value);

  // Whole numbers read better without trailing zeros; fractions rarely need
  // more than two decimals to support a sentence about them.
  if (Number.isInteger(number)) return number.toLocaleString("en-US");

  return number.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatWithUnit(value, format) {
  const rendered = formatNumber(value);

  if (rendered === "no value") return rendered;

  if (format === "currency") return `${rendered} (currency)`;
  if (format === "percentage") return `${rendered}%`;

  return rendered;
}

function describeKpi(kpi, index) {
  const lines = [
    `KPI ${index + 1}: ${kpi.title}`,
    `  id    : ${kpi.id}`,
    `  value : ${formatWithUnit(kpi.value, kpi.format)}`
  ];

  if (kpi.measure_label) {
    lines.push(`  measures: ${kpi.measure_label}`);
  }

  return lines.join("\n");
}

function describeChart(chart, index) {
  const labels = Array.isArray(chart.labels) ? chart.labels : [];
  const values = Array.isArray(chart.values) ? chart.values : [];

  const shown = Math.min(labels.length, MAX_CHART_POINTS);

  const rows = [];

  for (let i = 0; i < shown; i += 1) {
    rows.push(`    ${labels[i]}: ${formatWithUnit(values[i], chart.format)}`);
  }

  if (labels.length > shown) {
    rows.push(`    ... and ${labels.length - shown} more`);
  }

  const lines = [
    `CHART ${index + 1}: ${chart.title}`,
    `  id   : ${chart.id}`,
    `  type : ${chart.type}`
  ];

  if (chart.measure_label) {
    lines.push(`  measures: ${chart.measure_label}${chart.group_label ? ` by ${chart.group_label}` : ""}`);
  }

  lines.push("  results:");
  lines.push(rows.length ? rows.join("\n") : "    (no rows returned)");

  return lines.join("\n");
}

function buildInsightPrompt({ kpis = [], charts = [], maxInsights = 4 } = {}) {
  const kpiSection = kpis.length
    ? kpis.map(describeKpi).join("\n\n")
    : "(none)";

  const chartSection = charts.length
    ? charts.map(describeChart).join("\n\n")
    : "(none)";

  return `You are a business analyst writing the summary that sits at the top of a dashboard. Below are the real results that have already been calculated.

KPI RESULTS

${kpiSection}

CHART RESULTS

${chartSection}

YOUR TASK

Write up to ${maxInsights} short observations about what these numbers show.

Write about what the numbers actually say. Good observations point out things a reader would want to act on:

- Concentration: a few entries account for most of the total.
- Gaps: the top result is far ahead of, or far behind, the rest.
- Balance: results are evenly spread, so no single entry drives the outcome.
- Outliers: one entry behaves very differently from the others.
- Scale: a value is notably large or small relative to a related value.

RULES

- Use only the numbers above. Never invent a figure, a percentage, a date, or a trend.
- Only describe change over time if a chart is actually grouped by a date. Otherwise you have one snapshot, not a trend.
- Refer to entries by the exact labels shown above.
- When you cite a number, cite it as shown. Rounding for readability is fine.
- Never recommend an action that the data does not support.
- Never restate a KPI without saying something about it. "Total revenue is 5,000,000" is not an observation; "revenue is concentrated in three products" is.
- If the results are unremarkable, write fewer observations. Two useful ones beat four padded ones.
- If a chart returned no rows, say the data appears empty rather than inventing a finding.
- Write plainly. No jargon, no filler, no marketing language.

OUTPUT FORMAT

Return exactly one valid JSON object with this shape and no other properties:

{
  "insights": [
    {
      "id": "insight_short_name",
      "title": "A short heading of a few words",
      "description": "One or two plain sentences about what the numbers show."
    }
  ]
}

Every id must be lowercase snake_case, start with insight_, and be unique.
Return between 0 and ${maxInsights} insight objects.
Return only the JSON object. No markdown, no explanation, no SQL.`;
}

function buildInsightRepairPrompt(basePrompt, errorMessage, rejectedResponse) {
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

Fix only what the rejection reason describes. Keep every other insight exactly as it was. Return the complete corrected JSON object.`;
}

module.exports = {
  buildInsightPrompt,
  buildInsightRepairPrompt,
  MAX_CHART_POINTS,
};

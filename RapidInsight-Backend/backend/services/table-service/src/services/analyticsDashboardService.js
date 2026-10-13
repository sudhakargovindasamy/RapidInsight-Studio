const pool = require('../config/postgres');
const { validateAnalyticsPlan } = require('./analyticsPlanValidator');
const { buildKpiQuery, buildChartQuery } = require('./analyticsQueryBuilder');
const { buildKpiLabels, buildChartLabels } = require('./analyticsLabelBuilder');
const {
  markDashboardGenerating,
  markDashboardReady,
  markDashboardFailed
} = require('./dashboardPersistenceService');
const { writeInsights } = require('./aiBlueprintClient');

function normalizeValue(value) {
  if (value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

// Charts have no format field in the blueprint contract, so it is derived from
// the shape of the measure instead.
function resolveChartFormat(chart) {
  if (chart.ratio && Number(chart.ratio.scale) === 100) return 'percentage';

  if (chart.difference) {
    if (chart.difference.as_percentage) return 'percentage';
    if (chart.difference.is_date_difference) return 'decimal';
  }

  return null;
}

async function generateDashboardReport({
  supabase,
  projectId,
  userId,
  // Needed to authenticate the step 6 insight call to ai-service.
  userEmail,
  accessToken,
  blueprint,
  schemaBundles,
  generatedTablesBySchemaId
}) {
  let validated = null;

  try {
    validated = validateAnalyticsPlan({
      blueprint,
      schemaBundles,
      generatedTablesBySchemaId
    });

    await markDashboardGenerating({
      supabase,
      projectId,
      userId,
      config: validated.config
    });

    const kpis = [];
    for (const metric of validated.kpis) {
      const query = buildKpiQuery(metric);
      const result = await pool.query(query.text, query.values);
      // The blueprint supplies "name", never title/description.
      const labels = buildKpiLabels(metric);

      kpis.push({
        id: metric.id,
        title: metric.title || labels.title,
        description: metric.description || labels.description,
        measure_label: labels.measureLabel,
        format: metric.format,
        value: normalizeValue(result.rows[0]?.value)
      });
    }

    const charts = [];
    for (const chart of validated.charts) {
      const query = buildChartQuery(chart);
      const result = await pool.query(query.text, query.values);
      const labels = buildChartLabels(chart);

      charts.push({
        id: chart.id,
        title: chart.title || labels.title,
        description: chart.description || labels.description,
        type: chart.type,
        // Axis and tooltip captions, so a reader knows what the numbers mean.
        measure_label: labels.measureLabel,
        group_label: labels.groupLabel,
        // Charts carry no format in the contract, so the measure supplies one:
        // a percent-scaled ratio and a difference percentage both read as
        // percentages, and a date difference is a decimal day count. Anything
        // else renders as a plain number.
        format: chart.format || resolveChartFormat(chart),
        labels: result.rows.map((row) => String(row.label)),
        values: result.rows.map((row) => normalizeValue(row.value))
      });
    }

    /*
     * Step 6: the written summary.
     *
     * This is the first point in the pipeline where real values exist, so it
     * is the only place an observation about them can be made. Everything
     * earlier reasons about schema and intent alone.
     *
     * A dashboard with working numbers and no commentary is still useful, so
     * a failure here is logged and swallowed rather than discarding the
     * results that already computed successfully.
     */
    let insights = validated.config.insights || [];

    if (kpis.length || charts.length) {
      try {
        const generated = await writeInsights({
          kpis,
          charts,
          userId,
          userEmail,
          accessToken
        });

        if (Array.isArray(generated?.insights) && generated.insights.length) {
          insights = generated.insights;
        }
      } catch (error) {
        console.error('Insight generation failed, continuing without it:', error.message);
      }
    }

    if (!kpis.length && !charts.length) {
      const errorMsg = 'No KPI or chart metrics could be computed from the dashboard plan.';
      await markDashboardFailed({
        supabase,
        projectId,
        userId,
        config: validated.config,
        errorMessage: errorMsg
      });
      const error = new Error(errorMsg);
      error.statusCode = 422;
      throw error;
    }

    const reportData = {
      version: 1,
      generated_at: new Date().toISOString(),
      kpis,
      charts,
      insights
    };

    return markDashboardReady({
      supabase,
      projectId,
      userId,
      config: validated.config,
      reportData
    });
  } catch (error) {
    try {
      await markDashboardFailed({
        supabase,
        projectId,
        userId,
        config: validated?.config || blueprint?.dashboard || {},
        errorMessage: error.message
      });
    } catch (persistenceError) {
      console.error('Failed to save dashboard failure state:', persistenceError);
    }

    throw error;
  }
}

module.exports = {
  generateDashboardReport
};

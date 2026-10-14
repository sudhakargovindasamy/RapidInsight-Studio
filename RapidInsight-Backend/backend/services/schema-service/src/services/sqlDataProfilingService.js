const pool = require('../config/db');
const AppError = require('../errors/AppError');
const logger = require('../config/logger');

const NUMERIC_SQL_TYPES = new Set([
  'number',
  'integer',
  'bigint',
  'smallint',
  'decimal',
  'numeric',
  'real',
  'double precision',
  'float',
  'int',
  'int2',
  'int4',
  'int8',
  'float4',
  'float8'
]);

const DATE_SQL_TYPES = new Set([
  'date',
  'timestamp',
  'timestamptz',
  'timestamp with time zone',
  'timestamp without time zone',
  'time'
]);

function isNumeric(type) {
  return NUMERIC_SQL_TYPES.has(String(type || '').trim().toLowerCase());
}

function isDate(type) {
  const norm = String(type || '').trim().toLowerCase();
  return DATE_SQL_TYPES.has(norm) || norm.includes('timestamp') || norm.includes('date');
}

function isText(type) {
  const norm = String(type || '').trim().toLowerCase();
  return !isNumeric(norm) && !isDate(norm) && norm !== 'boolean' && norm !== 'bool';
}

function escapeIdentifier(id) {
  return `"${String(id || '').replace(/"/g, '""')}"`;
}

/**
 * Resolves a catalog asset to its verified physical PostgreSQL schema and table name.
 */
async function resolveAssetPhysicalTable({ projectId, assetId, client = pool }) {
  const query = `
    SELECT 
      ca.asset_id,
      ca.asset_name,
      ca.schema_name as asset_schema_name,
      ca.source_id,
      ca.project_id,
      ca.created_by as asset_created_by,
      ds.source_name,
      ds.source_type,
      COALESCE(gt.physical_schema_name, s.physical_schema_name, p.physical_schema_name, 'public') as physical_schema_name,
      COALESCE(gt.physical_table_name, s.physical_table_name) as physical_table_name,
      COALESCE(gt.row_count, s.uploaded_row_count, 0) as row_count,
      COALESCE(gt.status, s.table_status) as table_status
    FROM public.catalog_asset ca
    JOIN public.projects p ON p.id = ca.project_id
    LEFT JOIN public.data_source ds ON ds.source_id = ca.source_id
    LEFT JOIN public.generated_tables gt 
      ON (gt.id = ca.generated_table_id OR (ca.generated_table_id IS NULL AND gt.schema_id = ca.schema_id))
    LEFT JOIN public.schemas s ON s.id = ca.schema_id
    WHERE ca.asset_id = $1 AND ca.project_id = $2 AND ca.status = 'ACTIVE'
    LIMIT 1;
  `;

  const { rows } = await client.query(query, [assetId, projectId]);
  if (!rows.length) {
    throw new AppError('Catalog asset not found or does not belong to this project.', 404, 'ASSET_NOT_FOUND');
  }

  const asset = rows[0];

  // Check physical table existence in PostgreSQL information_schema
  const physSchema = asset.physical_schema_name || 'public';
  const physTable = asset.physical_table_name;

  let tableExists = false;
  let actualDbRowCount = 0;

  if (physTable) {
    const existsRes = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [physSchema, physTable]
    );
    tableExists = existsRes.rows.length > 0;

    if (tableExists) {
      const countRes = await client.query(
        `SELECT count(*)::bigint as cnt FROM ${escapeIdentifier(physSchema)}.${escapeIdentifier(physTable)}`
      );
      actualDbRowCount = Number(countRes.rows[0]?.cnt || 0);
    }
  }

  const isPopulated = tableExists && actualDbRowCount > 0;

  return {
    ...asset,
    physicalSchema: physSchema,
    physicalTable: physTable,
    physicalSchemaName: physSchema,
    physicalTableName: physTable,
    rowCount: actualDbRowCount,
    actualDbRowCount,
    isPopulated,
    tableExists
  };
}

/**
 * Retrieves registered asset columns verified against physical database columns.
 */
async function getVerifiedColumns({ assetId, physicalSchema, physicalTable, client = pool }) {
  // 1. Registered columns from catalog
  const { rows: registeredCols } = await client.query(
    `SELECT column_id, column_name, data_type, ordinal_position, is_pk, is_nullable
     FROM public.asset_column
     WHERE asset_id = $1
     ORDER BY ordinal_position ASC;`,
    [assetId]
  );

  // 2. Physical columns from information_schema
  const { rows: physicalCols } = await client.query(
    `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
       AND column_name NOT LIKE '__ris_%';`,
    [physicalSchema, physicalTable]
  );

  const physicalMap = new Map(physicalCols.map(c => [c.column_name.toLowerCase(), c.data_type]));

  return registeredCols
    .filter(rc => physicalMap.has(rc.column_name.toLowerCase()))
    .map(rc => ({
      column_id: rc.column_id,
      column_name: rc.column_name,
      data_type: rc.data_type || physicalMap.get(rc.column_name.toLowerCase()) || 'string',
      is_pk: Boolean(rc.is_pk),
      is_nullable: rc.is_nullable !== false
    }));
}

/**
 * Executes deterministic SQL profiling queries against the verified physical table.
 * Strictly without any AI/LLM models or external services.
 */
async function executeTableProfiling({ client, physicalSchema, physicalTable, columns, targetColumnName = null }) {
  const safeSchema = escapeIdentifier(physicalSchema);
  const safeTable = escapeIdentifier(physicalTable);

  // 1. Table-level row count and null counts aggregate query
  const nullSelects = columns.map(c => {
    const sc = escapeIdentifier(c.column_name);
    return `(COUNT(*) - COUNT(${sc}))::bigint AS ${escapeIdentifier('null_' + c.column_name)}`;
  });

  const textCols = columns.filter(c => isText(c.data_type));
  const emptySelects = textCols.map(c => {
    const sc = escapeIdentifier(c.column_name);
    return `SUM(CASE WHEN TRIM(${sc}::text) = '' THEN 1 ELSE 0 END)::bigint AS ${escapeIdentifier('empty_' + c.column_name)}`;
  });

  const allSelects = ['COUNT(*)::bigint AS total_rows', ...nullSelects, ...emptySelects];
  const summarySql = `SELECT ${allSelects.join(', ')} FROM ${safeSchema}.${safeTable};`;

  const summaryRes = await client.query(summarySql);
  const summaryRow = summaryRes.rows[0] || {};
  const totalRows = Number(summaryRow.total_rows || 0);

  if (totalRows === 0) {
    return {
      totalRows: 0,
      tableQuality: { totalRows: 0, overallCompleteness: 0, nullMetrics: [] },
      numericSummaries: [],
      categoricalSummaries: [],
      dateSummaries: []
    };
  }

  // Build null and empty metrics
  let totalCells = totalRows * columns.length;
  let totalNullCells = 0;

  const nullMetrics = columns.map(c => {
    const nullCount = Number(summaryRow['null_' + c.column_name] || 0);
    const emptyCount = isText(c.data_type) ? Number(summaryRow['empty_' + c.column_name] || 0) : 0;
    totalNullCells += nullCount;
    const completenessPct = totalRows > 0 ? Number(((totalRows - nullCount) * 100 / totalRows).toFixed(2)) : 0;

    return {
      columnName: c.column_name,
      dataType: c.data_type,
      isPk: c.is_pk,
      nullCount,
      emptyCount,
      completenessPct
    };
  });

  const overallCompleteness = totalCells > 0 ? Number(((totalCells - totalNullCells) * 100 / totalCells).toFixed(2)) : 0;

  // Primary key duplicate check
  const pkCol = columns.find(c => c.is_pk);
  let pkIntegrity = null;
  if (pkCol) {
    const pkSafe = escapeIdentifier(pkCol.column_name);
    const pkSql = `
      SELECT 
        (COUNT(${pkSafe}) - COUNT(DISTINCT ${pkSafe}))::bigint as duplicate_keys,
        COUNT(DISTINCT ${pkSafe})::bigint as distinct_keys
      FROM ${safeSchema}.${safeTable}
      WHERE ${pkSafe} IS NOT NULL;
    `;
    const pkRes = await client.query(pkSql);
    const pkRow = pkRes.rows[0] || {};
    pkIntegrity = {
      columnName: pkCol.column_name,
      duplicateKeys: Number(pkRow.duplicate_keys || 0),
      distinctKeys: Number(pkRow.distinct_keys || 0)
    };
  }

  // 2. Numeric Columns Statistical Analysis
  const numericCols = columns.filter(c => isNumeric(c.data_type)).slice(0, 8);
  const numericSummaries = [];

  for (const nc of numericCols) {
    const sc = escapeIdentifier(nc.column_name);
    const numStatSql = `
      SELECT 
        COUNT(${sc})::bigint AS count_val,
        MIN(${sc})::numeric AS min_val,
        MAX(${sc})::numeric AS max_val,
        ROUND(AVG(${sc})::numeric, 4) AS avg_val,
        ROUND(STDDEV(${sc})::numeric, 4) AS stddev_val,
        ROUND(SUM(${sc})::numeric, 2) AS sum_val,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY ${sc}) AS median_val,
        percentile_cont(0.25) WITHIN GROUP (ORDER BY ${sc}) AS q1_val,
        percentile_cont(0.75) WITHIN GROUP (ORDER BY ${sc}) AS q3_val
      FROM ${safeSchema}.${safeTable}
      WHERE ${sc} IS NOT NULL;
    `;

    const statRes = await client.query(numStatSql);
    const row = statRes.rows[0] || {};

    const count = Number(row.count_val || 0);
    const min = row.min_val != null ? Number(row.min_val) : null;
    const max = row.max_val != null ? Number(row.max_val) : null;
    const avg = row.avg_val != null ? Number(row.avg_val) : null;
    const stddev = row.stddev_val != null ? Number(row.stddev_val) : null;
    const sum = row.sum_val != null ? Number(row.sum_val) : null;
    const median = row.median_val != null ? Number(row.median_val) : null;
    const q1 = row.q1_val != null ? Number(row.q1_val) : null;
    const q3 = row.q3_val != null ? Number(row.q3_val) : null;

    // Outlier count via IQR rule: [q1 - 1.5*IQR, q3 + 1.5*IQR]
    let outlierCount = 0;
    let lowerBound = null;
    let upperBound = null;

    if (q1 !== null && q3 !== null && min !== null && max !== null) {
      const iqr = q3 - q1;
      lowerBound = Number((q1 - 1.5 * iqr).toFixed(2));
      upperBound = Number((q3 + 1.5 * iqr).toFixed(2));

      const outSql = `
        SELECT COUNT(*)::bigint AS outlier_count
        FROM ${safeSchema}.${safeTable}
        WHERE ${sc} < $1 OR ${sc} > $2;
      `;
      const outRes = await client.query(outSql, [lowerBound, upperBound]);
      outlierCount = Number(outRes.rows[0]?.outlier_count || 0);
    }

    // Histogram / Distribution 5-bucket query
    const histogramBuckets = [];
    if (min !== null && max !== null && min < max && count >= 5) {
      const histSql = `
        SELECT 
          WIDTH_BUCKET(${sc}, $1, $2, 5) AS bucket,
          COUNT(*)::bigint AS frequency
        FROM ${safeSchema}.${safeTable}
        WHERE ${sc} IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket ASC;
      `;
      const histRes = await client.query(histSql, [min, max]);
      const step = (max - min) / 5;

      const freqMap = new Map();
      histRes.rows.forEach(r => freqMap.set(Number(r.bucket), Number(r.frequency)));

      for (let b = 1; b <= 5; b++) {
        const bStart = (min + (b - 1) * step).toFixed(1);
        const bEnd = (min + b * step).toFixed(1);
        histogramBuckets.push({
          label: `${bStart} - ${bEnd}`,
          count: freqMap.get(b) || 0
        });
      }
    }

    numericSummaries.push({
      columnName: nc.column_name,
      dataType: nc.data_type,
      count,
      min,
      max,
      avg,
      median,
      stddev,
      sum,
      q1,
      q3,
      outlierCount,
      lowerBound,
      upperBound,
      histogramBuckets
    });
  }

  // 3. Categorical & Text Columns Frequency Analysis
  const allCatCols = columns.filter(c => isText(c.data_type));
  let catCols = allCatCols.slice(0, 8);
  if (targetColumnName) {
    const targetMatch = allCatCols.find(c => c.column_name.toLowerCase() === targetColumnName.toLowerCase());
    if (targetMatch && !catCols.some(c => c.column_name.toLowerCase() === targetColumnName.toLowerCase())) {
      catCols = [targetMatch, ...catCols];
    }
  }
  const categoricalSummaries = [];

  for (const cc of catCols) {
    const sc = escapeIdentifier(cc.column_name);
    // Distinct count
    const distRes = await client.query(
      `SELECT COUNT(DISTINCT ${sc})::bigint AS dist_cnt FROM ${safeSchema}.${safeTable} WHERE ${sc} IS NOT NULL;`
    );
    const distinctCount = Number(distRes.rows[0]?.dist_cnt || 0);

    // All distinct values up to 200
    const freqSql = `
      SELECT 
        COALESCE(NULLIF(TRIM(${sc}::text), ''), '(blank)') AS cat_val,
        COUNT(*)::bigint AS count
      FROM ${safeSchema}.${safeTable}
      WHERE ${sc} IS NOT NULL
      GROUP BY 1
      ORDER BY count DESC
      LIMIT 200;
    `;
    const freqRes = await client.query(freqSql);
    const allValues = freqRes.rows.map(r => ({
      value: String(r.cat_val),
      count: Number(r.count),
      percentage: totalRows > 0 ? Number((Number(r.count) * 100 / totalRows).toFixed(1)) : 0
    }));

    const topValues = allValues.slice(0, 8);
    const isHighCardinality = totalRows > 15 && (distinctCount / totalRows) > 0.8;

    categoricalSummaries.push({
      columnName: cc.column_name,
      dataType: cc.data_type,
      distinctCount,
      isHighCardinality,
      topValues,
      allValues
    });
  }

  // 4. Date & Temporal Columns Analysis
  const dateCols = columns.filter(c => isDate(c.data_type)).slice(0, 4);
  const dateSummaries = [];

  for (const dc of dateCols) {
    const sc = escapeIdentifier(dc.column_name);
    const dateSql = `
      SELECT 
        MIN(${sc})::text AS min_date,
        MAX(${sc})::text AS max_date,
        COUNT(${sc})::bigint AS non_null_count
      FROM ${safeSchema}.${safeTable};
    `;
    const dateRes = await client.query(dateSql);
    const row = dateRes.rows[0] || {};

    const minDate = row.min_date ? row.min_date.split('T')[0] : null;
    const maxDate = row.max_date ? row.max_date.split('T')[0] : null;
    const nonNullCount = Number(row.non_null_count || 0);

    // Grouping by month / period
    const trendSql = `
      SELECT 
        DATE_TRUNC('month', ${sc}::timestamp)::date::text AS period,
        COUNT(*)::bigint AS count
      FROM ${safeSchema}.${safeTable}
      WHERE ${sc} IS NOT NULL
      GROUP BY period
      ORDER BY period ASC
      LIMIT 12;
    `;
    let timeBuckets = [];
    try {
      const trendRes = await client.query(trendSql);
      timeBuckets = trendRes.rows.map(r => ({
        period: r.period ? r.period.slice(0, 7) : 'Unknown',
        count: Number(r.count)
      }));
    } catch {
      // If date casting fails on exotic string format, continue gracefully
    }

    dateSummaries.push({
      columnName: dc.column_name,
      dataType: dc.data_type,
      minDate,
      maxDate,
      nonNullCount,
      timeBuckets
    });
  }

  return {
    totalRows,
    tableQuality: {
      totalRows,
      overallCompleteness,
      pkIntegrity,
      nullMetrics
    },
    numericSummaries,
    categoricalSummaries,
    dateSummaries
  };
}

/**
 * Deterministic, rule-based analytical insights generator.
 * Zero AI or LLMs: purely derived from SQL statistical calculations.
 */
function generateRuleBasedInsights({ totalRows, tableQuality, numericSummaries, categoricalSummaries, dateSummaries, assetName }) {
  const insights = [];

  // 1. Table-level Completeness & Quality
  if (tableQuality.overallCompleteness === 100) {
    insights.push({
      category: 'Completeness',
      severity: 'success',
      column: 'Overall Table',
      text: `Table "${assetName}" achieves 100% data completeness with zero missing or null values across all ${totalRows.toLocaleString()} rows.`
    });
  } else if (tableQuality.overallCompleteness < 80) {
    insights.push({
      category: 'Completeness',
      severity: 'warning',
      column: 'Overall Table',
      text: `Overall completeness is ${tableQuality.overallCompleteness}%. Over 20% of expected data cells across this table are null.`
    });
  }

  // 2. Column Nulls & Missingness
  tableQuality.nullMetrics.forEach(nm => {
    if (nm.nullCount > 0) {
      const pct = (100 - nm.completenessPct).toFixed(1);
      insights.push({
        category: 'Missingness',
        severity: pct > 20 ? 'warning' : 'info',
        column: nm.columnName,
        text: `Column "${nm.columnName}" contains ${nm.nullCount.toLocaleString()} missing values (${pct}% of table).`
      });
    }
    if (nm.emptyCount > 0) {
      insights.push({
        category: 'Data Quality',
        severity: 'info',
        column: nm.columnName,
        text: `Column "${nm.columnName}" has ${nm.emptyCount.toLocaleString()} blank or empty text entries.`
      });
    }
  });

  // 3. Primary Key Uniqueness & Integrity
  if (tableQuality.pkIntegrity) {
    const { columnName, duplicateKeys } = tableQuality.pkIntegrity;
    if (duplicateKeys === 0) {
      insights.push({
        category: 'Integrity',
        severity: 'success',
        column: columnName,
        text: `Primary key "${columnName}" satisfies complete uniqueness with 0 duplicate values across ${totalRows.toLocaleString()} rows.`
      });
    } else {
      insights.push({
        category: 'Integrity',
        severity: 'danger',
        column: columnName,
        text: `Uniqueness Violation: Primary key "${columnName}" contains ${duplicateKeys.toLocaleString()} duplicate key values.`
      });
    }
  }

  // 4. Numeric Column Insights
  numericSummaries.forEach(ns => {
    if (ns.count > 0 && ns.min !== null && ns.max !== null) {
      insights.push({
        category: 'Distribution',
        severity: 'info',
        column: ns.columnName,
        text: `Column "${ns.columnName}" averages ${ns.avg?.toLocaleString()} (median: ${ns.median?.toLocaleString()}), ranging from ${ns.min.toLocaleString()} to ${ns.max.toLocaleString()}.`
      });

      if (ns.outlierCount > 0) {
        insights.push({
          category: 'Outliers',
          severity: 'warning',
          column: ns.columnName,
          text: `Detected ${ns.outlierCount.toLocaleString()} statistical outlier(s) in "${ns.columnName}" outside the 1.5× IQR threshold [${ns.lowerBound}, ${ns.upperBound}].`
        });
      }
    }
  });

  // 5. Categorical Column Insights
  categoricalSummaries.forEach(cs => {
    if (cs.topValues.length > 0) {
      const top = cs.topValues[0];
      insights.push({
        category: 'Categorical',
        severity: 'info',
        column: cs.columnName,
        text: `Column "${cs.columnName}" has ${cs.distinctCount} distinct values. Most frequent is "${top.value}" (${top.count.toLocaleString()} occurrences, ${top.percentage}%).`
      });

      if (cs.isHighCardinality) {
        insights.push({
          category: 'Cardinality',
          severity: 'info',
          column: cs.columnName,
          text: `Column "${cs.columnName}" displays high cardinality (${cs.distinctCount} unique out of ${totalRows.toLocaleString()} rows), typical of identifiers or text keys.`
        });
      }
    }
  });

  // 6. Temporal / Date Insights
  dateSummaries.forEach(ds => {
    if (ds.minDate && ds.maxDate) {
      insights.push({
        category: 'Timeline',
        severity: 'info',
        column: ds.columnName,
        text: `Temporal column "${ds.columnName}" spans from ${ds.minDate} to ${ds.maxDate}.`
      });

      if (ds.timeBuckets.length > 1) {
        const maxPeriod = [...ds.timeBuckets].sort((a, b) => b.count - a.count)[0];
        insights.push({
          category: 'Timeline',
          severity: 'info',
          column: ds.columnName,
          text: `Activity peaked during ${maxPeriod.period} with ${maxPeriod.count.toLocaleString()} recorded entries.`
        });
      }
    }
  });

  return insights.map((item, idx) => {
    let type = 'info';
    if (item.severity === 'success') type = 'positive';
    else if (item.severity === 'warning' || item.severity === 'danger') type = 'warning';

    const title = item.title || (item.column && item.column !== 'Overall Table'
      ? `${item.category} • ${item.column}`
      : `${item.category} Overview`);

    return {
      id: `ins_${idx + 1}`,
      category: item.category,
      type,
      severity: item.severity,
      column: item.column,
      title,
      description: item.text,
      text: item.text
    };
  });
}

/**
 * Builds Chart.js-compatible structured visualization datasets from SQL results.
 */
function buildChartDatasets({
  numericSummaries = [],
  categoricalSummaries = [],
  dateSummaries = [],
  tableQuality = {},
  targetColumn = null,
  targetStatistic = null,
  targetResultValue = null,
  totalRows = 0
}) {
  const charts = [];

  // When a specific column is targeted, generate focused charts for that column & statistic
  if (targetColumn) {
    const targetNorm = String(targetColumn).trim().toLowerCase();
    const nullMetric = tableQuality?.nullMetrics?.find(m => m.columnName.toLowerCase() === targetNorm);
    const numStat = numericSummaries.find(ns => ns.columnName.toLowerCase() === targetNorm);
    const catStat = categoricalSummaries.find(cs => cs.columnName.toLowerCase() === targetNorm);
    const dateStat = dateSummaries.find(ds => ds.columnName.toLowerCase() === targetNorm);

    const nullCount = nullMetric?.nullCount || 0;
    const sampleTotal = totalRows > 0 ? totalRows : ((nullMetric?.totalCount) || 100);
    const validCount = Math.max(0, sampleTotal - nullCount);

    if (targetStatistic === 'NULL_COUNT') {
      charts.push({
        id: `target_null_${targetColumn}`,
        title: `Null Count Analysis: ${targetColumn}`,
        type: 'bar',
        labels: ['Populated Values', 'Missing / Null Values'],
        datasets: [
          {
            label: 'Record Count',
            data: [validCount, nullCount],
            backgroundColor: ['#48c78e', '#ef7182']
          }
        ],
        description: `Verified SQL count of populated (${validCount}) vs missing (${nullCount}) values for "${targetColumn}".`
      });
    } else if (targetStatistic === 'COUNT') {
      charts.push({
        id: `target_count_${targetColumn}`,
        title: `Total Count Verification: ${targetColumn}`,
        type: 'bar',
        labels: ['Valid Records', 'Total Table Rows'],
        datasets: [
          {
            label: 'Record Count',
            data: [validCount, sampleTotal],
            backgroundColor: ['#5c7cfa', '#8b73dc']
          }
        ],
        description: `Verified SQL count of valid records (${validCount}) in "${targetColumn}" against total records (${sampleTotal}).`
      });
    } else if (targetStatistic === 'DISTINCT_COUNT') {
      const distinct = targetResultValue != null ? Number(targetResultValue) : (catStat?.distinctCount ?? numStat?.distinctCount ?? 0);
      if (catStat?.topValues && catStat.topValues.length > 0) {
        charts.push({
          id: `target_distinct_freq_${targetColumn}`,
          title: `Top Frequencies: ${targetColumn} (Top ${catStat.topValues.length})`,
          type: 'bar',
          labels: catStat.topValues.map(v => v.value),
          datasets: [
            {
              label: 'Occurrence Count',
              data: catStat.topValues.map(v => v.count),
              backgroundColor: '#5c7cfa'
            }
          ],
          description: `Top ${catStat.topValues.length} distinct frequencies for "${targetColumn}".`
        });

        // NEW CHART CREATED BELOW: All Data in that chart
        const allDataVals = (catStat.allValues && catStat.allValues.length > 0) ? catStat.allValues : catStat.topValues;
        charts.push({
          id: `target_all_data_${targetColumn}`,
          title: `All Data Distribution: ${targetColumn} (${allDataVals.length} Categories)`,
          type: 'bar',
          isFullWidth: true,
          labels: allDataVals.map(v => v.value),
          datasets: [
            {
              label: 'Record Count (All Data)',
              data: allDataVals.map(v => v.count),
              backgroundColor: allDataVals.map((_, idx) => idx < catStat.topValues.length ? '#5c7cfa' : 'rgba(92, 124, 250, 0.55)')
            }
          ],
          description: `Complete SQL data distribution across all ${allDataVals.length} categories/values in column "${targetColumn}" (${distinct} distinct total).`
        });
      } else {
        charts.push({
          id: `target_distinct_${targetColumn}`,
          title: `Distinct Count: ${targetColumn}`,
          type: 'bar',
          labels: ['Distinct Values', 'Repeated / Duplicates'],
          datasets: [
            {
              label: 'Count',
              data: [distinct, Math.max(0, sampleTotal - distinct)],
              backgroundColor: ['#48c78e', '#8b73dc']
            }
          ],
          description: `${distinct} distinct values found in column "${targetColumn}" across ${sampleTotal} rows.`
        });
      }
    } else if (['MIN', 'MAX', 'AVG'].includes(targetStatistic) && numStat) {
      const statVal = targetResultValue != null ? targetResultValue : (targetStatistic === 'AVG' ? numStat.avg : targetStatistic === 'MIN' ? numStat.min : numStat.max);
      charts.push({
        id: `target_stat_metric_${targetColumn}`,
        title: `${targetStatistic} Benchmark: ${targetColumn} (${statVal})`,
        type: 'bar',
        labels: ['Min', 'Average', 'Median', 'Max'],
        datasets: [
          {
            label: 'Metric Value',
            data: [numStat.min, numStat.avg, numStat.median, numStat.max],
            backgroundColor: ['#38bdf8', '#8b73dc', '#6366f1', '#ec4899']
          }
        ],
        description: `Deterministic statistical benchmarks for "${targetColumn}": Min=${numStat.min}, Avg=${numStat.avg}, Median=${numStat.median}, Max=${numStat.max}.`
      });
    }

    // Add column distribution chart if available
    if (numStat?.histogramBuckets?.length > 0) {
      charts.push({
        id: `num_hist_${numStat.columnName}`,
        title: `Distribution: ${numStat.columnName}`,
        type: 'bar',
        labels: numStat.histogramBuckets.map(b => b.label),
        datasets: [
          {
            label: 'Frequency',
            data: numStat.histogramBuckets.map(b => b.count),
            backgroundColor: '#8b73dc'
          }
        ],
        description: `Binned numeric histogram for column "${numStat.columnName}".`
      });
    } else if (catStat?.topValues?.length > 0 && targetStatistic !== 'DISTINCT_COUNT') {
      charts.push({
        id: `cat_freq_${catStat.columnName}`,
        title: `Top Frequencies: ${catStat.columnName}`,
        type: 'bar',
        labels: catStat.topValues.map(v => v.value),
        datasets: [
          {
            label: 'Occurrence Count',
            data: catStat.topValues.map(v => v.count),
            backgroundColor: '#5c7cfa'
          }
        ],
        description: `Category frequencies for column "${catStat.columnName}".`
      });

      // NEW CHART CREATED BELOW: All Data in that chart
      const allDataVals = (catStat.allValues && catStat.allValues.length > 0) ? catStat.allValues : catStat.topValues;
      charts.push({
        id: `cat_all_data_${catStat.columnName}`,
        title: `All Data Distribution: ${catStat.columnName} (${allDataVals.length} Categories)`,
        type: 'bar',
        isFullWidth: true,
        labels: allDataVals.map(v => v.value),
        datasets: [
          {
            label: 'Record Count (All Data)',
            data: allDataVals.map(v => v.count),
            backgroundColor: allDataVals.map((_, idx) => idx < catStat.topValues.length ? '#5c7cfa' : 'rgba(92, 124, 250, 0.55)')
          }
        ],
        description: `Complete SQL data distribution across all ${allDataVals.length} categories/values in column "${catStat.columnName}".`
      });
    } else if (dateStat?.timeBuckets?.length > 0) {
      charts.push({
        id: `date_trend_${dateStat.columnName}`,
        title: `Timeline Trend: ${dateStat.columnName}`,
        type: 'line',
        labels: dateStat.timeBuckets.map(b => b.period),
        datasets: [
          {
            label: 'Records',
            data: dateStat.timeBuckets.map(b => b.count),
            borderColor: '#48c78e',
            backgroundColor: 'rgba(72, 199, 142, 0.15)',
            fill: true
          }
        ],
        description: `Timeline trend distribution for column "${dateStat.columnName}".`
      });
    }

    if (charts.length > 0) {
      return charts.map(c => ({
        ...c,
        description: c.description || `SQL aggregate distribution for ${c.title}`,
        data: {
          labels: c.labels,
          datasets: c.datasets
        }
      }));
    }
  }

  // Chart 1: Table Completeness & Null Distribution
  const nullCols = (tableQuality?.nullMetrics || []).filter(m => m.nullCount > 0);
  if (nullCols.length > 0) {
    charts.push({
      id: 'table_null_distribution',
      title: 'Missing Values by Column',
      type: 'bar',
      labels: nullCols.map(m => m.columnName),
      datasets: [
        {
          label: 'Null / Missing Count',
          data: nullCols.map(m => m.nullCount),
          backgroundColor: '#ef7182'
        }
      ]
    });
  }

  // Chart 2: Numeric Distribution Histograms
  numericSummaries.forEach(ns => {
    if (ns.histogramBuckets && ns.histogramBuckets.length > 0) {
      charts.push({
        id: `num_hist_${ns.columnName}`,
        title: `Distribution: ${ns.columnName}`,
        type: 'bar',
        labels: ns.histogramBuckets.map(b => b.label),
        datasets: [
          {
            label: 'Frequency',
            data: ns.histogramBuckets.map(b => b.count),
            backgroundColor: '#8b73dc'
          }
        ]
      });
    }
  });

  // Chart 3: Top Categories Bar Charts
  categoricalSummaries.forEach(cs => {
    if (cs.topValues && cs.topValues.length > 1) {
      charts.push({
        id: `cat_freq_${cs.columnName}`,
        title: `Top Frequencies: ${cs.columnName}`,
        type: 'bar',
        labels: cs.topValues.map(v => v.value),
        datasets: [
          {
            label: 'Occurrence Count',
            data: cs.topValues.map(v => v.count),
            backgroundColor: '#5c7cfa'
          }
        ]
      });

      // Chart 3B: All Data Categories Bar Chart created below Top Frequencies
      const allDataVals = (cs.allValues && cs.allValues.length > 0) ? cs.allValues : cs.topValues;
      charts.push({
        id: `cat_all_${cs.columnName}`,
        title: `All Data Distribution: ${cs.columnName} (${allDataVals.length} Categories)`,
        type: 'bar',
        isFullWidth: true,
        labels: allDataVals.map(v => v.value),
        datasets: [
          {
            label: 'All Records Count',
            data: allDataVals.map(v => v.count),
            backgroundColor: allDataVals.map((_, idx) => idx < cs.topValues.length ? '#5c7cfa' : 'rgba(92, 124, 250, 0.55)')
          }
        ],
        description: `Complete category breakdown across all ${allDataVals.length} values for column "${cs.columnName}".`
      });
    }
  });

  // Chart 4: Time Trend Line Charts
  dateSummaries.forEach(ds => {
    if (ds.timeBuckets && ds.timeBuckets.length > 1) {
      charts.push({
        id: `date_trend_${ds.columnName}`,
        title: `Timeline Trend: ${ds.columnName}`,
        type: 'line',
        labels: ds.timeBuckets.map(b => b.period),
        datasets: [
          {
            label: 'Records',
            data: ds.timeBuckets.map(b => b.count),
            borderColor: '#48c78e',
            backgroundColor: 'rgba(72, 199, 142, 0.15)',
            fill: true
          }
        ]
      });
    }
  });

  return charts.map(c => ({
    ...c,
    description: c.description || `SQL aggregate distribution for ${c.title}`,
    data: {
      labels: c.labels,
      datasets: c.datasets
    }
  }));
}

/**
 * Main Profiling Orchestrator.
 * Queries actual stored database records, produces SQL statistical analysis,
 * generates rule-based insights without AI, and outputs chart datasets.
 */
async function profileAssetData({ projectId, assetId, columnId = null, targetColumnName = null, statistic = null, targetResultValue = null, userId = null, dbClient = null }) {
  const client = dbClient || await pool.connect();
  const shouldRelease = !dbClient;
  const startTime = Date.now();

  try {
    // Enforce 8-second query timeout
    await client.query('SET statement_timeout = 8000');

    // 1. Resolve asset to physical table
    const assetMeta = await resolveAssetPhysicalTable({ projectId, assetId, client });

    if (!assetMeta.isPopulated || assetMeta.actualDbRowCount === 0) {
      return {
        success: true,
        isPopulated: false,
        assetId,
        assetName: assetMeta.asset_name,
        physicalTableName: assetMeta.physical_table_name,
        rowCount: 0,
        message: `Asset "${assetMeta.asset_name}" has no loaded records. Data must be loaded in Data Ingestion before profiling can run.`,
        insights: [],
        charts: [],
        tableQuality: { totalRows: 0, overallCompleteness: 0, nullMetrics: [] }
      };
    }

    // 2. Fetch and verify columns
    const columns = await getVerifiedColumns({
      assetId,
      physicalSchema: assetMeta.physicalSchemaName,
      physicalTable: assetMeta.physicalTableName,
      client
    });

    if (!columns.length) {
      return {
        success: true,
        isPopulated: false,
        assetId,
        assetName: assetMeta.asset_name,
        physicalTableName: assetMeta.physical_table_name,
        rowCount: 0,
        message: `Asset "${assetMeta.asset_name}" has no verifiable columns or loaded records. Run Data Ingestion to load business data before profiling.`,
        insights: [],
        charts: [],
        tableQuality: { totalRows: 0, overallCompleteness: 0, nullMetrics: [] }
      };
    }

    const resolvedTargetCol = targetColumnName || (columnId ? columns.find(c => c.column_id === columnId)?.column_name : null);

    // 3. Execute deterministic SQL profiling
    const profileResults = await executeTableProfiling({
      client,
      physicalSchema: assetMeta.physicalSchemaName,
      physicalTable: assetMeta.physicalTableName,
      columns,
      targetColumnName: resolvedTargetCol
    });

    // 4. Generate deterministic rule-based insights (Zero AI)
    const insights = generateRuleBasedInsights({
      totalRows: profileResults.totalRows,
      tableQuality: profileResults.tableQuality,
      numericSummaries: profileResults.numericSummaries,
      categoricalSummaries: profileResults.categoricalSummaries,
      dateSummaries: profileResults.dateSummaries,
      assetName: assetMeta.asset_name
    });

    // 5. Build structured chart datasets
    const charts = buildChartDatasets({
      numericSummaries: profileResults.numericSummaries,
      categoricalSummaries: profileResults.categoricalSummaries,
      dateSummaries: profileResults.dateSummaries,
      tableQuality: profileResults.tableQuality,
      targetColumn: resolvedTargetCol,
      targetStatistic: statistic,
      targetResultValue,
      totalRows: profileResults.totalRows
    });

    const nullMetrics = profileResults.tableQuality.nullMetrics || [];
    const missingCells = nullMetrics.reduce((acc, q) => acc + (q.nullCount || 0) + (q.emptyCount || 0), 0);
    const totalCells = profileResults.totalRows * columns.length;
    const completenessPct = totalCells > 0 ? Number((((totalCells - missingCells) / totalCells) * 100).toFixed(1)) : 100;
    const numericColsCount = columns.filter(c => isNumeric(c.data_type)).length;
    const dateColsCount = columns.filter(c => isDate(c.data_type)).length;
    const textColsCount = columns.filter(c => isText(c.data_type)).length;

    const summary = {
      totalRows: profileResults.totalRows,
      totalColumns: columns.length,
      missingCells,
      overallCompletenessPct: completenessPct,
      numericColumnsCount: numericColsCount,
      textColumnsCount: textColsCount,
      dateColumnsCount: dateColsCount
    };

    const columnProfiles = columns.map(c => {
      const q = nullMetrics.find(tq => tq.columnName === c.column_name) || {};
      const numStat = profileResults.numericSummaries.find(ns => ns.columnName === c.column_name) || null;
      const catStat = profileResults.categoricalSummaries.find(cs => cs.columnName === c.column_name) || null;
      const dateStat = profileResults.dateSummaries.find(ds => ds.columnName === c.column_name) || null;

      return {
        columnName: c.column_name,
        dataType: c.data_type,
        isNumeric: isNumeric(c.data_type),
        isText: isText(c.data_type),
        isDate: isDate(c.data_type),
        nullCount: q.nullCount || 0,
        completenessPct: q.completenessPct != null ? q.completenessPct : 100,
        distinctCount: numStat?.distinctCount ?? catStat?.distinctCount ?? 0,
        numericStats: numStat,
        categoryStats: catStat,
        dateStats: dateStat
      };
    });

    const executionDurationMs = Date.now() - startTime;

    return {
      success: true,
      isPopulated: true,
      assetId,
      assetName: assetMeta.asset_name,
      sourceName: assetMeta.source_name || 'Uploaded Data',
      sourceType: assetMeta.source_type,
      physicalSchema: assetMeta.physicalSchemaName,
      physicalTable: assetMeta.physicalTableName,
      physicalSchemaName: assetMeta.physicalSchemaName,
      physicalTableName: assetMeta.physicalTableName,
      totalRows: profileResults.totalRows,
      totalColumns: columns.length,
      summary,
      columnProfiles,
      columns,
      executionDurationMs,
      tableQuality: profileResults.tableQuality,
      numericSummaries: profileResults.numericSummaries,
      categoricalSummaries: profileResults.categoricalSummaries,
      dateSummaries: profileResults.dateSummaries,
      insights,
      charts
    };
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  isNumeric,
  isDate,
  isText,
  escapeIdentifier,
  resolveAssetPhysicalTable,
  getVerifiedColumns,
  executeTableProfiling,
  generateRuleBasedInsights,
  buildChartDatasets,
  profileAssetData
};

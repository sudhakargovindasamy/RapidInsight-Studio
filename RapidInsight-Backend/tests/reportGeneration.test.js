const assert = require('assert');
const path = require('path');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
require(dotenvPath).config({
  path: path.resolve(__dirname, '../backend/services/table-service/.env')
});

const {
  generateSqlDashboard,
  deriveChartShape: actualDeriveChartShape,
  shapeDashboardResult
} = require('../backend/services/table-service/src/services/sqlKpiExecutionService');
const { generateDashboardReport } = require('../backend/services/table-service/src/services/analyticsDashboardService');

function createMockSupabase(spies = {}) {
  return {
    from: () => ({
      upsert: (payload) => {
        if (spies.onUpsert) spies.onUpsert(payload);
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'dash-1', ...payload }, error: null })
          })
        };
      }
    })
  };
}

async function runTests() {
  console.log('--- Running Report Generation & Shaping Tests ---');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // Test 1: deriveChartShape & KPI shaping logic
  test('Shaping handles ID columns, numeric labels, single rows, and multi-column KPIs', () => {
    const ID_LIKE_COLUMN = /(^|_)id$/i;
    function isNumericValue(value) {
      if (value === null || value === undefined || value === '') return false;
      if (typeof value === 'object') return false;
      return Number.isFinite(Number(value));
    }
    function isNumericOrEmptyValue(value) {
      if (value === null || value === undefined || value === '') return true;
      return isNumericValue(value);
    }
    function deriveChartShape(rows, columns) {
      if (columns.length < 2) return null;
      let candidateColumns = columns;
      const filtered = columns.filter((column) => !ID_LIKE_COLUMN.test(column));
      if (filtered.length >= 2) {
        candidateColumns = filtered;
      }
      let labelColumns = candidateColumns.filter((column) => rows.some((row) => !isNumericOrEmptyValue(row[column])));
      let valueColumns = candidateColumns.filter((column) => rows.every((row) => isNumericOrEmptyValue(row[column])));
      if (labelColumns.length === 0 && candidateColumns.length === 2 && valueColumns.length === 2) {
        labelColumns = [candidateColumns[0]];
        valueColumns = [candidateColumns[1]];
      }
      if (labelColumns.length !== 1 || valueColumns.length !== 1) return null;
      return {
        labelColumn: labelColumns[0],
        valueColumn: valueColumns[0],
        labels: rows.map(r => String(r[labelColumns[0]])),
        values: rows.map(r => Number(r[valueColumns[0]]))
      };
    }

    // Chart with ID-like label (e.g. customer_id, total_spend)
    const idChartRows = [
      { customer_id: 'C101', total_spend: 500 },
      { customer_id: 'C102', total_spend: 300 }
    ];
    const idChart = deriveChartShape(idChartRows, ['customer_id', 'total_spend']);
    assert(idChart !== null, 'Chart with ID-like column should NOT be rejected');
    assert.strictEqual(idChart.labelColumn, 'customer_id');
    assert.strictEqual(idChart.valueColumn, 'total_spend');

    // Chart with numeric label (e.g. year, count)
    const yearChartRows = [
      { year: 2021, count: 50 },
      { year: 2022, count: 80 }
    ];
    const yearChart = deriveChartShape(yearChartRows, ['year', 'count']);
    assert(yearChart !== null, 'Chart with 2 numeric columns (e.g. year, count) should NOT be rejected');
    assert.strictEqual(yearChart.labelColumn, 'year');
    assert.strictEqual(yearChart.valueColumn, 'count');

    // Chart with single row
    const singleRowChart = deriveChartShape([{ category: 'A', value: 10 }], ['category', 'value']);
    assert(singleRowChart !== null, 'Single-row chart should be valid');
    assert.deepStrictEqual(singleRowChart.labels, ['A']);
    assert.deepStrictEqual(singleRowChart.values, [10]);

    // Categorical frequency fallback: when both columns are non-numeric (e.g. district, college_name)
    const rawCategoryRows = [
      { district: 'Chennai', college_name: 'College 1' },
      { district: 'Chennai', college_name: 'College 2' },
      { district: 'Coimbatore', college_name: 'College 3' }
    ];
    // Custom deriveChartShape matching implementation:
    const counts = new Map();
    for (const row of rawCategoryRows) {
      const val = row.district;
      counts.set(val, (counts.get(val) || 0) + 1);
    }
    assert.strictEqual(counts.get('Chennai'), 2, 'Chennai frequency count must be 2');
    assert.strictEqual(counts.get('Coimbatore'), 1, 'Coimbatore frequency count must be 1');
  });

  // Test 2: generateSqlDashboard rejects when customKpis is empty and marks failed
  await testAsync('generateSqlDashboard rejects empty customKpis and marks status failed', async () => {
    let lastUpsert = null;
    const mockSupabase = createMockSupabase({
      onUpsert: (payload) => {
        lastUpsert = payload;
      }
    });

    let threw = false;
    try {
      await generateSqlDashboard({
        supabase: mockSupabase,
        projectId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
        userEmail: 'test@example.com',
        accessToken: 'dummy',
        blueprint: { tables: [] },
        schemaBundles: [],
        generatedTablesBySchemaId: new Map(),
        customKpis: []
      });
    } catch (err) {
      threw = true;
      assert(err.message.includes('At least one KPI is required'));
    }

    assert(threw, 'Expected generateSqlDashboard to throw on empty customKpis');
    assert(lastUpsert !== null, 'Expected dashboard upsert to occur');
    assert.strictEqual(lastUpsert.report_status, 'failed', 'Expected dashboard status to be "failed"');
    assert(lastUpsert.error_message.includes('At least one KPI is required'));
  });

  // Test 3: analyticsDashboardService fails when 0 KPIs and 0 charts are computed
  await testAsync('analyticsDashboardService fails and marks status failed on 0 metrics', async () => {
    let lastUpsert = null;
    const mockSupabase = createMockSupabase({
      onUpsert: (payload) => {
        lastUpsert = payload;
      }
    });

    const blueprint = {
      tables: [{ table_name: 't1', schema_id: 's1' }],
      dashboard: {
        title: 'Empty Plan',
        kpis: [],
        charts: []
      }
    };

    const schemaBundles = [
      {
        schema: { id: 's1' },
        schemaDefinition: { fields: [{ name: 'f1' }] }
      }
    ];

    const generatedTablesBySchemaId = new Map([
      ['s1', { physical_table_name: 't1_phys', row_count: 5 }]
    ]);

    let threw = false;
    try {
      await generateDashboardReport({
        supabase: mockSupabase,
        projectId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000002',
        userEmail: 'test@example.com',
        accessToken: 'dummy',
        blueprint,
        schemaBundles,
        generatedTablesBySchemaId
      });
    } catch (err) {
      threw = true;
      assert(err.message.includes('No KPI or chart metrics could be computed'));
    }

    assert(threw, 'Expected generateDashboardReport to throw');
    assert(lastUpsert !== null, 'Expected dashboard upsert to occur');
    assert.strictEqual(lastUpsert.report_status, 'failed', 'Expected dashboard status to be marked "failed"');
  });

  // Test 4: shapeDashboardResult shapes single KPI, multi-row chart, and categorical breakdown
  test('shapeDashboardResult formats single KPIs, multi-row charts, and categorical frequency charts', () => {
    // 1. Single row numeric -> KPI
    const singleKpi = shapeDashboardResult(
      { request: 'Total colleges', label: 'Total Colleges', format: 'number', chart_type: null },
      [{ count: 418 }],
      0
    );
    assert(singleKpi !== null, 'Single numeric row should shape into a KPI');
    assert.strictEqual(singleKpi.kind, 'kpi');
    assert.strictEqual(singleKpi.value.value, 418);
    assert.strictEqual(singleKpi.value.title, 'Total Colleges');

    // 2. Multi-row with label and numeric measure -> Chart
    const multiRowChart = shapeDashboardResult(
      { request: 'Top 2 colleges', label: 'Top Colleges', format: 'number', chart_type: 'bar' },
      [
        { college: 'Anna Univ', score: 98 },
        { college: 'PSG', score: 95 }
      ],
      1
    );
    assert(multiRowChart !== null, 'Multi-row with numeric measure should shape into a chart');
    assert.strictEqual(multiRowChart.kind, 'chart');
    assert.deepStrictEqual(multiRowChart.value.labels, ['Anna Univ', 'PSG']);
    assert.deepStrictEqual(multiRowChart.value.values, [98, 95]);

    // 3. Multi-row when chart_type is null or omitted -> should still shape into chart rather than dropping
    const untypedMultiRow = shapeDashboardResult(
      { request: 'Colleges by city', label: 'Colleges by City', format: 'number', chart_type: null },
      [
        { city: 'Chennai', count: 50 },
        { city: 'Madurai', count: 20 }
      ],
      2
    );
    assert(untypedMultiRow !== null, 'Multi-row result should shape into a chart even if chart_type is null');
    assert.strictEqual(untypedMultiRow.kind, 'chart');

    // 4. Categorical raw rows without measure (district, college_name) -> Frequency chart
    const catRows = [
      { district: 'Chennai', college_name: 'C1' },
      { district: 'Chennai', college_name: 'C2' },
      { district: 'Coimbatore', college_name: 'C3' }
    ];
    const catChart = shapeDashboardResult(
      { request: 'district by college', label: 'Colleges by District', format: 'number', chart_type: 'bar' },
      catRows,
      3
    );
    assert(catChart !== null, 'Categorical rows should shape into a frequency chart');
    assert.strictEqual(catChart.kind, 'chart');
    assert.strictEqual(catChart.value.labels[0], 'Chennai');
    assert.strictEqual(catChart.value.values[0], 2);
    assert.strictEqual(catChart.value.labels[1], 'Coimbatore');
    assert.strictEqual(catChart.value.values[1], 1);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();


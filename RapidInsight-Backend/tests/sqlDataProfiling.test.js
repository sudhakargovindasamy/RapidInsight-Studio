const path = require('path');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const { Pool } = require(pgPath);
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });

const {
  resolveAssetPhysicalTable,
  profileAssetData,
  executeTableProfiling,
  generateRuleBasedInsights,
  buildChartDatasets
} = require('../backend/services/schema-service/src/services/sqlDataProfilingService');

const {
  runProfileStatistic
} = require('../backend/services/schema-service/src/services/catalogProfilingService');

const {
  registerCatalogMetadata
} = require('../backend/services/schema-service/src/services/catalogIngestionService');

async function runTestSuite() {
  console.log('=== STARTING SQL-BASED DATA PROFILING & AUTOMATIC INSIGHTS TEST SUITE ===');
  console.log('Strict requirement: 100% Deterministic SQL / No AI / Real DB Execution\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition, message) {
    if (!condition) {
      console.error(`  ❌ FAILED: ${message}`);
      failedCount++;
      throw new Error(`Assertion failed: ${message}`);
    } else {
      console.log(`  ✓ PASSED: ${message}`);
      passedCount++;
    }
  }

  try {
    // 0. Locate an active project and populated table
    console.log('[Setup] Finding populated physical table in database...');
    const popRes = await client.query(`
      SELECT 
        gt.id as generated_table_id,
        gt.project_id,
        gt.schema_id,
        gt.physical_schema_name,
        gt.physical_table_name,
        gt.row_count,
        gt.created_by,
        p.organisation_id
      FROM public.generated_tables gt
      JOIN public.projects p ON p.id = gt.project_id
      WHERE gt.status = 'POPULATED' AND gt.row_count > 0
      LIMIT 1;
    `);

    if (!popRes.rows.length) {
      throw new Error('No populated generated table found in DB to run profiling tests.');
    }

    const liveTest = popRes.rows[0];
    const projectId = liveTest.project_id;
    const userId = liveTest.created_by;

    console.log(`Using live populated table: "${liveTest.physical_schema_name}"."${liveTest.physical_table_name}" (Rows: ${liveTest.row_count})`);

    // Introspect physical columns
    const colsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `, [liveTest.physical_schema_name, liveTest.physical_table_name]);

    // Register this populated table into the Data Catalog
    const ingestRes = await registerCatalogMetadata({
      project: { id: projectId, organisation_id: liveTest.organisation_id },
      userId,
      source: {
        sourceName: 'Profiling Test Source',
        sourceType: 'INTERNAL_PROJECT_DB'
      },
      asset: {
        schemaId: liveTest.schema_id,
        generatedTableId: liveTest.generated_table_id,
        schemaName: liveTest.physical_schema_name,
        assetName: liveTest.physical_table_name,
        assetType: 'TABLE'
      },
      columns: colsRes.rows.map((c, i) => ({
        name: c.column_name,
        type: c.data_type,
        ordinalPosition: i,
        isPk: i === 0,
        isNullable: true
      }))
    });

    const assetId = ingestRes.assetId;
    console.log(`Registered catalog asset ID: ${assetId}`);

    // TEST 1: Physical Table Resolution
    console.log('\n[TEST 1] Physical Table Resolution');
    const resolved = await resolveAssetPhysicalTable({
      projectId,
      assetId,
      dbClient: client
    });
    assert(resolved.isPopulated === true, 'Resolved asset reports isPopulated = true');
    assert(resolved.physicalSchema === liveTest.physical_schema_name, `Schema matches: ${resolved.physicalSchema}`);
    assert(resolved.physicalTable === liveTest.physical_table_name, `Table matches: ${resolved.physicalTable}`);
    assert(resolved.rowCount > 0, `Row count is positive: ${resolved.rowCount}`);

    // TEST 2: Deterministic SQL Execution and Profiling
    console.log('\n[TEST 2] Full Table SQL Profiling Execution');
    const profile = await profileAssetData({
      projectId,
      assetId,
      dbClient: client
    });

    assert(profile.isPopulated === true, 'Profile indicates isPopulated = true');
    assert(profile.summary.totalRows === resolved.rowCount, `Total rows in summary matches physical rows (${profile.summary.totalRows})`);
    assert(profile.summary.totalColumns > 0, `Analyzed columns count > 0 (${profile.summary.totalColumns})`);
    assert(typeof profile.summary.overallCompletenessPct === 'number', `Overall completeness is a number (${profile.summary.overallCompletenessPct}%)`);
    assert(typeof profile.executionDurationMs === 'number', `Execution duration recorded: ${profile.executionDurationMs}ms`);

    // TEST 3: Column Profiles Verification
    console.log('\n[TEST 3] Column Profiles & Statistical Metrics');
    assert(Array.isArray(profile.columnProfiles), 'Column profiles is an array');
    const numericCols = profile.columnProfiles.filter(c => c.isNumeric);
    if (numericCols.length > 0) {
      const numCol = numericCols[0];
      console.log(`  Evaluating numeric column: ${numCol.columnName}`);
      assert(numCol.numericStats !== null, 'Numeric statistics generated');
      assert(typeof numCol.numericStats.min !== 'undefined', `Min value computed: ${numCol.numericStats.min}`);
      assert(typeof numCol.numericStats.max !== 'undefined', `Max value computed: ${numCol.numericStats.max}`);
      assert(typeof numCol.numericStats.avg !== 'undefined', `Avg value computed: ${numCol.numericStats.avg}`);
      assert(typeof numCol.numericStats.median !== 'undefined', `Median computed via percentile_cont: ${numCol.numericStats.median}`);
      assert(typeof numCol.numericStats.outlierCount === 'number', `IQR Outlier count computed: ${numCol.numericStats.outlierCount}`);
    } else {
      console.log('  (No numeric columns present in this table, skipping numeric stats assert)');
    }

    const textCols = profile.columnProfiles.filter(c => c.isText);
    if (textCols.length > 0) {
      const txtCol = textCols[0];
      console.log(`  Evaluating text column: ${txtCol.columnName}`);
      assert(txtCol.categoryStats !== null, 'Category statistics generated');
      assert(Array.isArray(txtCol.categoryStats.topValues), 'Top frequency values is an array');
      assert(typeof txtCol.categoryStats.isHighCardinality === 'boolean', 'High cardinality boolean flag present');
    }

    // TEST 4: Rule-Based Deterministic Insights (Zero AI)
    console.log('\n[TEST 4] Deterministic Rule-Based Insights Generation');
    assert(Array.isArray(profile.insights), 'Insights returned as array');
    assert(profile.insights.length > 0, `Generated ${profile.insights.length} analytical insights`);
    for (const ins of profile.insights) {
      assert(typeof ins.id === 'string', `Insight id is string (${ins.id})`);
      assert(typeof ins.category === 'string', `Category is present (${ins.category})`);
      assert(['positive', 'warning', 'info'].includes(ins.type), `Valid insight type (${ins.type})`);
      assert(typeof ins.title === 'string' && ins.title.length > 0, `Title is present (${ins.title})`);
      assert(typeof ins.description === 'string' && ins.description.length > 0, 'Description is present');
    }

    // TEST 5: Chart Datasets Generation
    console.log('\n[TEST 5] Analytical Visualization Datasets');
    assert(Array.isArray(profile.charts), 'Charts returned as array');
    assert(profile.charts.length > 0, `Generated ${profile.charts.length} chart datasets`);
    for (const ch of profile.charts) {
      assert(['bar', 'line'].includes(ch.type), `Chart type is bar or line (${ch.type})`);
      assert(Array.isArray(ch.data.labels), `Chart has labels array (${ch.title})`);
      assert(Array.isArray(ch.data.datasets), `Chart has datasets array (${ch.title})`);
      assert(ch.data.datasets.length > 0, 'Chart dataset contains at least 1 series');
    }

    // TEST 6: Unpopulated Asset Handling
    console.log('\n[TEST 6] Unpopulated Asset Handling');
    const unpopName = 'unpop_' + Date.now();
    const fakeAssetRes = await client.query(`
      INSERT INTO public.catalog_asset (
        source_id,
        project_id,
        schema_id,
        generated_table_id,
        schema_name,
        asset_name,
        asset_type,
        fq_name,
        status,
        created_by
      ) VALUES (
        $1, $2, NULL, NULL, 'public', $3, 'TABLE', $4, 'ACTIVE', $5
      ) RETURNING asset_id;
    `, [ingestRes.sourceId, projectId, unpopName, `public.${unpopName}`, userId]);

    const fakeAssetId = fakeAssetRes.rows[0].asset_id;

    const unpopProfile = await profileAssetData({
      projectId,
      assetId: fakeAssetId,
      dbClient: client
    });

    assert(unpopProfile.isPopulated === false, 'Unpopulated asset returns isPopulated = false');
    assert(typeof unpopProfile.message === 'string' && unpopProfile.message.length > 0, `Clear user-friendly message returned: "${unpopProfile.message}"`);

    // Clean up mock asset
    await client.query(`DELETE FROM public.catalog_asset WHERE asset_id = $1;`, [fakeAssetId]);

    // TEST 7: Single Statistic Profiling Integration with Full Profile
    console.log('\n[TEST 7] runProfileStatistic Backward-Compatibility & Enrichment');
    // Find first column id
    const colListRes = await client.query(`
      SELECT column_id, column_name FROM public.asset_column WHERE asset_id = $1 LIMIT 1;
    `, [assetId]);

    if (colListRes.rows.length > 0) {
      const testCol = colListRes.rows[0];
      const singleStatRes = await runProfileStatistic({
        projectId,
        columnId: testCol.column_id,
        statistic: 'NULL_COUNT'
      });
      assert(singleStatRes.statistic === 'NULL_COUNT', 'Single stat returns requested statistic');
      assert(typeof singleStatRes.result !== 'undefined', `Result value present: ${singleStatRes.result}`);
      assert(singleStatRes.assetProfile !== null && typeof singleStatRes.assetProfile === 'object', 'Single stat includes full assetProfile');
      assert(singleStatRes.assetProfile.summary.totalRows === resolved.rowCount, 'Enriched assetProfile has accurate row count');
    }

    // Clean up test data
    console.log('\n[Cleanup] Removing temporary catalog test entries...');
    await client.query(`DELETE FROM public.data_source WHERE source_id = $1;`, [ingestRes.sourceId]);

    console.log(`\n======================================================`);
    console.log(`ALL TESTS PASSED! (${passedCount} checks passed, ${failedCount} failures)`);
    console.log(`======================================================\n`);

  } catch (err) {
    console.error('\n❌ TEST SUITE ENCOUNTERED AN ERROR:\n', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

runTestSuite();

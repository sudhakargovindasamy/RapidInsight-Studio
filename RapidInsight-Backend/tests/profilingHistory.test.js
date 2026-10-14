const path = require('path');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const { Pool } = require(pgPath);
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });

const {
  listCatalogSources,
  listCatalogAssets,
  listCatalogColumns,
  runProfileStatistic,
  listProfilingHistory,
  getProfilingHistoryItem
} = require('../backend/services/schema-service/src/services/catalogProfilingService');

const {
  registerCatalogMetadata
} = require('../backend/services/schema-service/src/services/catalogIngestionService');

async function runProfilingHistoryTestSuite() {
  console.log('=== STARTING PROFILING HISTORY & PERSISTENCE TEST SUITE ===\n');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  let passedCount = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (!condition) {
      console.error(`❌ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
    console.log(`✅ PASS: ${message}`);
    passedCount++;
  }

  try {
    // 0. Locate a populated table
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
      throw new Error('No populated generated table found for profiling history test.');
    }

    const liveTest = popRes.rows[0];
    const projectId = liveTest.project_id;
    const userId = liveTest.created_by;

    // Introspect physical columns
    const colsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `, [liveTest.physical_schema_name, liveTest.physical_table_name]);

    if (!colsRes.rows.length) {
      throw new Error('Could not introspect physical columns.');
    }

    // Register / Ensure catalog metadata exists
    const ingestRes = await registerCatalogMetadata({
      project: { id: projectId, organisation_id: liveTest.organisation_id },
      userId,
      source: {
        sourceName: 'Profiling History Test Source',
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
      })),
      dbClient: client
    });

    const catalogCols = await listCatalogColumns({ projectId, assetId: ingestRes.assetId });
    if (catalogCols.length < 1) {
      throw new Error('Failed to resolve registered catalog columns.');
    }

    const testItem1 = catalogCols[0];
    const testItem2 = catalogCols.length > 1 ? catalogCols[1] : catalogCols[0];

    console.log(`[Setup] Project ID: ${projectId}`);
    console.log(`[Setup] Target 1: ${testItem1.column_name} (${testItem1.data_type})`);
    console.log(`[Setup] Target 2: ${testItem2.column_name} (${testItem2.data_type})\n`);

    // TEST 1: Initial history query runs cleanly for authorized project
    console.log('[Scenario 1] Querying existing profiling history...');
    const initialHistory = await listProfilingHistory({
      projectId,
      dbClient: client
    });
    assert(Array.isArray(initialHistory), 'History endpoint returns an array');
    const initialCount = initialHistory.length;
    console.log(`  Initial history items count: ${initialCount}`);

    // TEST 2: Run profiling on target 1 (COUNT)
    console.log('\n[Scenario 2] Executing Profiling Run 1 (COUNT)...');
    const run1Result = await runProfileStatistic({
      projectId,
      columnId: testItem1.column_id,
      statistic: 'COUNT',
      userId,
      dbClient: client
    });

    assert(run1Result !== null && typeof run1Result === 'object', 'Run 1 returned valid result object');
    assert(run1Result.result !== null && run1Result.result !== undefined, `Run 1 calculated result value: ${run1Result.result}`);
    assert(Boolean(run1Result.resultId), `Run 1 returned generated resultId: ${run1Result.resultId}`);

    // TEST 3: Verify Run 1 is persistently recorded in catalog_profiling_result table
    console.log('\n[Scenario 3] Verifying database persistence for Run 1...');
    const dbRecord1 = await client.query(`
      SELECT * FROM public.catalog_profiling_result WHERE result_id = $1
    `, [run1Result.resultId]);
    assert(dbRecord1.rows.length === 1, 'Run 1 record exists in public.catalog_profiling_result');
    assert(dbRecord1.rows[0].project_id === projectId, 'Run 1 record project_id matches authorized project');
    assert(dbRecord1.rows[0].statistic === 'COUNT', 'Run 1 statistic is stored as COUNT');
    assert(dbRecord1.rows[0].column_name === testItem1.column_name, `Run 1 column_name is correctly saved as ${testItem1.column_name}`);

    // TEST 4: Repeat profiling on target 2 (NULL_COUNT)
    console.log('\n[Scenario 4] Executing repeated profiling: Run 2 (NULL_COUNT)...');
    const run2Result = await runProfileStatistic({
      projectId,
      columnId: testItem2.column_id,
      statistic: 'NULL_COUNT',
      userId,
      dbClient: client
    });

    assert(run2Result !== null && typeof run2Result === 'object', 'Run 2 returned valid result object');
    assert(run2Result.resultId !== run1Result.resultId, 'Run 2 generated a unique resultId');

    // TEST 5: Verify both runs exist simultaneously without overwriting
    console.log('\n[Scenario 5] Verifying history retention across multiple runs...');
    const updatedHistory = await listProfilingHistory({
      projectId,
      dbClient: client
    });
    assert(updatedHistory.length === initialCount + 2, `History count increased by exactly 2 (was ${initialCount}, now ${updatedHistory.length})`);
    
    const foundRun1 = updatedHistory.find(h => h.result_id === run1Result.resultId);
    const foundRun2 = updatedHistory.find(h => h.result_id === run2Result.resultId);
    assert(Boolean(foundRun1), 'Run 1 is retained in history list');
    assert(Boolean(foundRun2), 'Run 2 is present in history list');
    assert(foundRun2.statistic === 'NULL_COUNT', 'Run 2 retained correct statistic NULL_COUNT');
    assert(foundRun1.statistic === 'COUNT', 'Run 1 retained correct statistic COUNT');

    // TEST 6: Simulate logout / re-login with a fresh DB connection and query
    console.log('\n[Scenario 6] Simulating user logout and subsequent re-login...');
    const newSessionPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    const newSessionClient = await newSessionPool.connect();
    try {
      const reloadedHistory = await listProfilingHistory({
        projectId,
        dbClient: newSessionClient
      });
      assert(reloadedHistory.length >= 2, `History automatically loads upon re-login (${reloadedHistory.length} records found)`);
      assert(reloadedHistory.some(r => r.result_id === run1Result.resultId), 'Run 1 is present after new session reconnect');
      assert(reloadedHistory.some(r => r.result_id === run2Result.resultId), 'Run 2 is present after new session reconnect');
    } finally {
      newSessionClient.release();
      await newSessionPool.end();
    }

    // TEST 7: Cross-project isolation
    console.log('\n[Scenario 7] Verifying cross-project isolation...');
    const dummyProjectId = '00000000-0000-0000-0000-000000000000';
    const isolatedHistory = await listProfilingHistory({
      projectId: dummyProjectId,
      dbClient: client
    });
    assert(isolatedHistory.length === 0, 'Unrelated project sees zero profiling results');

    // TEST 8: Retrieve specific historical run with automatic insights, visualizations, and verified column profiles
    console.log('\n[Scenario 8] Fetching specific historical profiling run with insights & charts...');
    const historyDetail = await getProfilingHistoryItem({
      projectId,
      resultId: run1Result.resultId,
      dbClient: client
    });

    assert(Boolean(historyDetail), 'Retrieved historical profiling item');
    assert(historyDetail.resultId === run1Result.resultId, 'History item resultId matches');
    assert(historyDetail.isHistorical === true, 'History item marked as isHistorical');
    assert(Array.isArray(historyDetail.insights) && historyDetail.insights.length > 0, `History item contains ${historyDetail.insights?.length} rule-based insights`);
    assert(Array.isArray(historyDetail.charts) && historyDetail.charts.length > 0, `History item contains ${historyDetail.charts?.length} visualization datasets`);
    assert(Array.isArray(historyDetail.columnProfiles) && historyDetail.columnProfiles.length > 0, `History item contains ${historyDetail.columnProfiles?.length} verified column profiles`);
    assert(historyDetail.statistic === 'COUNT', 'History item retained correct statistic');
    console.log(`  Historical item verified: ${historyDetail.insights.length} insights, ${historyDetail.charts.length} charts, ${historyDetail.columnProfiles.length} column profiles`);

    console.log(`\n========================================`);
    console.log(`ALL TESTS PASSED: ${passedCount}/${totalTests}`);
    console.log(`========================================\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

runProfilingHistoryTestSuite()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });


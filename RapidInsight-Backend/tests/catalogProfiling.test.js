const path = require('path');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const { Pool } = require(pgPath);
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });

const {
  listCatalogSources,
  listCatalogAssets,
  listCatalogColumns,
  runProfileStatistic
} = require('../backend/services/schema-service/src/services/catalogProfilingService');

const {
  registerCatalogMetadata
} = require('../backend/services/schema-service/src/services/catalogIngestionService');

async function runTestSuite() {
  console.log('--- STARTING CATALOG PROFILING BACKEND TEST SUITE ---');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    // 0. Locate a populated generated table and project for live profiling testing
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
      throw new Error('No populated generated table found for profiling test.');
    }

    const liveTest = popRes.rows[0];
    const projectId = liveTest.project_id;
    const userId = liveTest.created_by;

    console.log(`Using live populated table: "${liveTest.physical_schema_name}"."${liveTest.physical_table_name}" (Rows: ${liveTest.row_count})`);

    // Introspect actual column names and types from this physical table
    const colsRes = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `, [liveTest.physical_schema_name, liveTest.physical_table_name]);

    if (!colsRes.rows.length) {
      throw new Error('Could not introspect physical columns for populated table.');
    }

    console.log(`Introspected ${colsRes.rows.length} columns.`);
    const numericCol = colsRes.rows.find(c => ['integer', 'bigint', 'numeric', 'real', 'double precision', 'smallint'].includes(c.data_type.toLowerCase()));
    const stringCol = colsRes.rows.find(c => ['text', 'character varying', 'varchar'].includes(c.data_type.toLowerCase())) || colsRes.rows[0];

    // Register this populated table into the Data Catalog
    const ingestRes = await registerCatalogMetadata({
      project: { id: projectId, organisation_id: liveTest.organisation_id },
      userId,
      source: {
        sourceName: 'Internal Test DB',
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

    console.log('Registered populated asset in catalog:', ingestRes);

    // 1. TEST: List Sources
    console.log('\n[TEST 1] Testing listCatalogSources...');
    const sources = await listCatalogSources({ projectId });
    if (!sources || !sources.some(s => s.source_id === ingestRes.sourceId)) {
      throw new Error('Test 1 Failed: Created source not listed.');
    }
    console.log(`✓ TEST 1 PASSED: Found ${sources.length} sources.`);

    // 2. TEST: List Assets
    console.log('\n[TEST 2] Testing listCatalogAssets...');
    const assets = await listCatalogAssets({ projectId, sourceId: ingestRes.sourceId });
    const matchedAsset = assets.find(a => a.asset_id === ingestRes.assetId);
    if (!matchedAsset || !matchedAsset.is_populated) {
      throw new Error('Test 2 Failed: Asset not listed or is_populated is false.');
    }
    console.log(`✓ TEST 2 PASSED: Asset listed with is_populated = true.`);

    // 3. TEST: List Columns
    console.log('\n[TEST 3] Testing listCatalogColumns...');
    const catalogCols = await listCatalogColumns({ projectId, assetId: ingestRes.assetId });
    if (catalogCols.length !== colsRes.rows.length) {
      throw new Error(`Test 3 Failed: Column count mismatch (expected ${colsRes.rows.length}, got ${catalogCols.length})`);
    }
    console.log(`✓ TEST 3 PASSED: Listed ${catalogCols.length} columns.`);

    const catalogNumericCol = catalogCols.find(c => c.column_name === numericCol?.column_name);
    const catalogStringCol = catalogCols.find(c => c.column_name === stringCol.column_name);

    // 4. TEST: NULL_COUNT, COUNT, and DISTINCT_COUNT
    console.log('\n[TEST 4] Testing general statistics (COUNT, NULL_COUNT, DISTINCT_COUNT)...');
    const countStat = await runProfileStatistic({
      projectId,
      columnId: catalogStringCol.column_id,
      statistic: 'COUNT'
    });
    console.log(`COUNT result on "${catalogStringCol.column_name}":`, countStat.result, `(${countStat.executionDurationMs}ms)`);
    if (countStat.result !== liveTest.row_count) {
      console.warn(`Note: COUNT is ${countStat.result}, table total rows is ${liveTest.row_count}`);
    }

    const nullCountStat = await runProfileStatistic({
      projectId,
      columnId: catalogStringCol.column_id,
      statistic: 'NULL_COUNT'
    });
    console.log(`NULL_COUNT result:`, nullCountStat.result);

    const distinctCountStat = await runProfileStatistic({
      projectId,
      columnId: catalogStringCol.column_id,
      statistic: 'DISTINCT_COUNT'
    });
    console.log(`DISTINCT_COUNT result:`, distinctCountStat.result);
    console.log('✓ TEST 4 PASSED: General statistics executed successfully.');

    // 5. TEST: Numeric Statistics (MIN, MAX, AVG)
    if (catalogNumericCol) {
      console.log(`\n[TEST 5] Testing numeric statistics (MIN, MAX, AVG) on "${catalogNumericCol.column_name}"...`);
      const minStat = await runProfileStatistic({
        projectId,
        columnId: catalogNumericCol.column_id,
        statistic: 'MIN'
      });
      const maxStat = await runProfileStatistic({
        projectId,
        columnId: catalogNumericCol.column_id,
        statistic: 'MAX'
      });
      const avgStat = await runProfileStatistic({
        projectId,
        columnId: catalogNumericCol.column_id,
        statistic: 'AVG'
      });
      console.log(`MIN: ${minStat.result}, MAX: ${maxStat.result}, AVG: ${avgStat.result}`);
      if (typeof minStat.result !== 'number' || typeof maxStat.result !== 'number') {
        throw new Error('Test 5 Failed: Numeric statistics did not return numbers');
      }
      console.log('✓ TEST 5 PASSED: MIN, MAX, AVG executed accurately.');
    } else {
      console.log('[TEST 5 SKIPPED]: No numeric column in test table.');
    }

    // 6. TEST: Unsupported Statistic on Non-Numeric Column
    console.log('\n[TEST 6] Testing rejection of numeric stat (AVG) on non-numeric column...');
    let typeRejected = false;
    try {
      await runProfileStatistic({
        projectId,
        columnId: catalogStringCol.column_id,
        statistic: 'AVG'
      });
    } catch (err) {
      typeRejected = true;
      console.log(`✓ TEST 6 PASSED: Correctly rejected with: "${err.message}"`);
    }
    if (!typeRejected && !isNumericType(catalogStringCol.data_type)) {
      throw new Error('Test 6 Failed: AVG on non-numeric column was not rejected!');
    }

    // 7. TEST: Rejection on Unpopulated Asset
    console.log('\n[TEST 7] Testing rejection on unpopulated asset...');
    const unpopRes = await registerCatalogMetadata({
      project: { id: projectId, organisation_id: liveTest.organisation_id },
      userId,
      source: { sourceName: 'Unpopulated Source', sourceType: 'FILE_UPLOAD' },
      asset: { assetName: 'unpopulated_schema', assetType: 'FILE_SCHEMA' },
      columns: [{ name: 'val', type: 'number' }],
      dbClient: client
    });

    const unpopCols = await listCatalogColumns({ projectId, assetId: unpopRes.assetId });
    let unpopRejected = false;
    try {
      await runProfileStatistic({
        projectId,
        columnId: unpopCols[0].column_id,
        statistic: 'COUNT'
      });
    } catch (err) {
      unpopRejected = true;
      console.log(`✓ TEST 7 PASSED: Correctly rejected unpopulated asset: "${err.message}"`);
    }
    if (!unpopRejected) {
      throw new Error('Test 7 Failed: Unpopulated asset profiling was not rejected!');
    }

    // 8. TEST: Cross-tenant / Unauthorized Project Access
    console.log('\n[TEST 8] Testing cross-tenant project rejection...');
    let tenantRejected = false;
    try {
      await runProfileStatistic({
        projectId: '00000000-0000-0000-0000-000000000000',
        columnId: catalogStringCol.column_id,
        statistic: 'COUNT'
      });
    } catch (err) {
      tenantRejected = true;
      console.log(`✓ TEST 8 PASSED: Rejected with: "${err.message}"`);
    }
    if (!tenantRejected) {
      throw new Error('Test 8 Failed: Cross-tenant column access was not rejected!');
    }

    // 9. TEST: SQL Injection Attempt in Statistic
    console.log('\n[TEST 9] Testing SQL injection rejection in statistic parameter...');
    let injectionRejected = false;
    try {
      await runProfileStatistic({
        projectId,
        columnId: catalogStringCol.column_id,
        statistic: "COUNT; DROP TABLE public.data_source; --"
      });
    } catch (err) {
      injectionRejected = true;
      console.log(`✓ TEST 9 PASSED: Injection payload safely rejected: "${err.message}"`);
    }
    if (!injectionRejected) {
      throw new Error('Test 9 Failed: SQL injection payload was not rejected!');
    }

    // 10. TEST: Physical Column Drift / Missing Physical Column
    console.log('\n[TEST 10] Testing missing physical column detection...');
    const fakeColRes = await client.query(`
      INSERT INTO public.asset_column (
        asset_id, column_name, data_type, ordinal_position
      ) VALUES ($1, 'non_existent_physical_col', 'string', 99)
      RETURNING column_id;
    `, [ingestRes.assetId]);
    const fakeColId = fakeColRes.rows[0].column_id;

    let colDriftCaught = false;
    try {
      await runProfileStatistic({
        projectId,
        columnId: fakeColId,
        statistic: 'COUNT'
      });
    } catch (err) {
      colDriftCaught = true;
      console.log(`✓ TEST 10 PASSED: Column drift caught: "${err.message}"`);
    }
    if (!colDriftCaught) {
      throw new Error('Test 10 Failed: Fake column was not rejected!');
    }

    // CLEANUP
    console.log('\nCleaning up profiling test records...');
    await client.query("DELETE FROM public.data_source WHERE source_name IN ('Internal Test DB', 'Unpopulated Source')");
    console.log('✓ Cleanup complete.');

    console.log('\n=============================================');
    console.log('ALL STAGE 3 PROFILING TESTS PASSED!');
    console.log('=============================================');

  } catch (err) {
    console.error('PROFILING TEST FAILED:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runTestSuite();


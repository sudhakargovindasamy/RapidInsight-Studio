const path = require('path');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const { Pool } = require(pgPath);
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });

const { registerCatalogMetadata } = require('../backend/services/schema-service/src/services/catalogIngestionService');

async function runTests() {
  console.log('--- STARTING CATALOG INGESTION TEST SUITE ---');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  let testProjectId = null;
  let testUserId = null;
  let testOrgId = null;

  try {
    // 0. Setup: Query an existing real project and user for testing
    const projRes = await client.query(`
      SELECT p.id, p.organisation_id, p.created_by, p.physical_schema_name 
      FROM public.projects p 
      LIMIT 1;
    `);

    if (!projRes.rows.length) {
      console.error('No existing project found to execute test against.');
      process.exit(1);
    }

    const testProject = projRes.rows[0];
    testProjectId = testProject.id;
    testOrgId = testProject.organisation_id;
    testUserId = testProject.created_by;

    console.log(`Using test project: ${testProjectId}, org: ${testOrgId}, user: ${testUserId}`);

    // TEST 1: Successful File Upload Metadata Ingestion
    console.log('\n[TEST 1] Testing successful file upload metadata ingestion...');
    const result1 = await registerCatalogMetadata({
      project: testProject,
      userId: testUserId,
      source: {
        sourceName: 'Uploaded Schema Files - Test',
        sourceType: 'FILE_UPLOAD'
      },
      asset: {
        schemaName: testProject.physical_schema_name || 'public',
        assetName: 'test_ingestion_asset',
        assetType: 'FILE_SCHEMA'
      },
      columns: [
        { name: 'id', type: 'uuid', ordinalPosition: 0, isPk: true, isNullable: false },
        { name: 'email', type: 'string', ordinalPosition: 1, isPk: false, isNullable: false },
        { name: 'age', type: 'number', ordinalPosition: 2, isPk: false, isNullable: true }
      ],
      dbClient: client
    });

    if (!result1.sourceId || !result1.assetId || result1.columnsCount !== 3) {
      throw new Error(`Test 1 Failed: Unexpected result ${JSON.stringify(result1)}`);
    }

    // Verify rows in DB
    const check1 = await client.query('SELECT count(*)::int as cnt FROM public.asset_column WHERE asset_id = $1', [result1.assetId]);
    if (check1.rows[0].cnt !== 3) {
      throw new Error(`Test 1 Failed: expected 3 columns in DB, got ${check1.rows[0].cnt}`);
    }
    console.log('✓ TEST 1 PASSED: Created 1 source, 1 asset, 3 columns.');

    // TEST 2: Idempotent Re-Ingestion (repeated upload with updated column)
    console.log('\n[TEST 2] Testing idempotency upon repeated ingestion...');
    const result2 = await registerCatalogMetadata({
      project: testProject,
      userId: testUserId,
      source: {
        sourceName: 'Uploaded Schema Files - Test',
        sourceType: 'FILE_UPLOAD'
      },
      asset: {
        schemaName: testProject.physical_schema_name || 'public',
        assetName: 'test_ingestion_asset',
        assetType: 'FILE_SCHEMA'
      },
      columns: [
        { name: 'id', type: 'uuid', ordinalPosition: 0, isPk: true, isNullable: false },
        { name: 'email', type: 'string', ordinalPosition: 1, isPk: false, isNullable: false },
        // 'age' removed, 'created_at' added
        { name: 'created_at', type: 'date', ordinalPosition: 2, isPk: false, isNullable: false }
      ],
      dbClient: client
    });

    if (result2.sourceId !== result1.sourceId || result2.assetId !== result1.assetId) {
      throw new Error('Test 2 Failed: Idempotency violated, created different IDs!');
    }

    const check2 = await client.query(`
      SELECT column_name, data_type 
      FROM public.asset_column 
      WHERE asset_id = $1 
      ORDER BY ordinal_position
    `, [result2.assetId]);

    const colNames = check2.rows.map(r => r.column_name);
    if (colNames.includes('age') || !colNames.includes('created_at') || check2.rows.length !== 3) {
      throw new Error(`Test 2 Failed: Columns were not pruned or updated properly: ${JSON.stringify(colNames)}`);
    }
    console.log('✓ TEST 2 PASSED: Re-ingestion maintained source & asset IDs and pruned/updated columns.');

    // TEST 3: Invalid Metadata Rejection (missing columns)
    console.log('\n[TEST 3] Testing rejection of invalid metadata (empty columns)...');
    let rejectedAsExpected = false;
    try {
      await registerCatalogMetadata({
        project: testProject,
        userId: testUserId,
        source: { sourceName: 'Invalid', sourceType: 'FILE_UPLOAD' },
        asset: { assetName: 'invalid' },
        columns: [],
        dbClient: client
      });
    } catch (err) {
      rejectedAsExpected = true;
      console.log(`✓ TEST 3 PASSED: Correctly caught validation error: "${err.message}"`);
    }
    if (!rejectedAsExpected) {
      throw new Error('Test 3 Failed: Function did not reject empty columns!');
    }

    // TEST 4: Unauthorized Project Access (Non-existent / Cross-tenant project)
    console.log('\n[TEST 4] Testing tenant isolation / cross-tenant project rejection...');
    let crossTenantRejected = false;
    try {
      const fakeProject = { id: '00000000-0000-0000-0000-000000000000', organisation_id: testOrgId };
      await registerCatalogMetadata({
        project: fakeProject,
        userId: testUserId,
        source: { sourceName: 'Fake Source', sourceType: 'FILE_UPLOAD' },
        asset: { assetName: 'fake_asset' },
        columns: [{ name: 'col1', type: 'string' }],
        dbClient: client
      });
    } catch (err) {
      crossTenantRejected = true;
      console.log(`✓ TEST 4 PASSED: Database trigger/FK correctly rejected invalid project: "${err.message}"`);
    }
    if (!crossTenantRejected) {
      throw new Error('Test 4 Failed: Invalid project ID was not rejected!');
    }

    // TEST 5: Database Table Import Ingestion (External Postgres, credentials omitted)
    console.log('\n[TEST 5] Testing external database import metadata registration (no raw credentials)...');
    const result5 = await registerCatalogMetadata({
      project: testProject,
      userId: testUserId,
      source: {
        sourceName: 'DB: production_sample_db',
        sourceType: 'EXTERNAL_POSTGRESQL',
        host: 'db.example.internal',
        port: 5432,
        databaseName: 'production_sample_db'
      },
      asset: {
        schemaName: 'analytics',
        assetName: 'orders_fact',
        assetType: 'TABLE'
      },
      columns: [
        { name: 'order_id', type: 'number', isPk: true, isNullable: false },
        { name: 'amount', type: 'number', isPk: false, isNullable: false },
        { name: 'status', type: 'string', isPk: false, isNullable: false }
      ],
      dbClient: client
    });

    const checkSource = await client.query(
      'SELECT auth_type, credential_secret_ref, host, database_name FROM public.data_source WHERE source_id = $1',
      [result5.sourceId]
    );
    const srcRow = checkSource.rows[0];
    if (srcRow.auth_type !== 'NONE' || srcRow.credential_secret_ref !== null) {
      throw new Error('Test 5 Failed: Credentials or raw passwords were inadvertently recorded!');
    }
    console.log('✓ TEST 5 PASSED: External database source and asset registered cleanly with zero credentials stored.');

    // CLEANUP: Delete the test assets and sources created in tests
    console.log('\nCleaning up test artifacts...');
    await client.query("DELETE FROM public.data_source WHERE source_name IN ('Uploaded Schema Files - Test', 'DB: production_sample_db')");
    console.log('✓ Cleanup complete.');

    console.log('\n========================================');
    console.log('ALL STAGE 2 TESTS PASSED SUCCESSFULLY!');
    console.log('========================================');

  } catch (err) {
    console.error('TEST RUN FAILURE:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runTests();


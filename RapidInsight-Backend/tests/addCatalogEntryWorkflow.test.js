const path = require('path');
const pgPath = 'c:/Sudhakar-Intern/Project-RapidInsightStudio/RapidInsight-Backend/backend/services/schema-service/node_modules/pg';
const dotenvPath = 'c:/Sudhakar-Intern/Project-RapidInsightStudio/RapidInsight-Backend/backend/services/schema-service/node_modules/dotenv';
const { Pool } = require(pgPath);
require(dotenvPath).config({ path: 'c:/Sudhakar-Intern/Project-RapidInsightStudio/RapidInsight-Backend/backend/services/schema-service/.env' });

const {
  registerCatalogMetadata
} = require('../backend/services/schema-service/src/services/catalogIngestionService');
const {
  listCatalogSources,
  listCatalogAssets,
  listCatalogColumns
} = require('../backend/services/schema-service/src/services/catalogProfilingService');

async function testAddCatalogWorkflow() {
  console.log('--- TESTING MULTI-ENTRY ADD CATALOG WORKFLOW ---');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  let sourceId1 = null;
  let assetId1 = null;
  let assetId2 = null;

  try {
    // 1. Pick a real project
    const projRes = await client.query(`
      SELECT p.id, p.organisation_id, p.created_by, p.physical_schema_name 
      FROM public.projects p 
      LIMIT 1;
    `);

    if (!projRes.rows.length) {
      throw new Error('No project found in database.');
    }

    const project = projRes.rows[0];
    const projectId = project.id;
    const userId = project.created_by;

    console.log(`Using project: ${projectId}`);

    // STEP 1: Create First Catalog Entry using existing registerCatalogMetadata workflow
    console.log('\n[STEP 1] Creating First Catalog Entry (Entry A)...');
    const entryA = await registerCatalogMetadata({
      project,
      userId,
      source: {
        sourceName: 'Uploaded Schema Files - Test Add',
        sourceType: 'FILE_UPLOAD'
      },
      asset: {
        schemaName: project.physical_schema_name || 'public',
        assetName: 'test_catalog_entry_alpha',
        assetType: 'FILE_SCHEMA'
      },
      columns: [
        { name: 'id', type: 'integer', ordinalPosition: 0, isPk: true, isNullable: false },
        { name: 'first_name', type: 'varchar', ordinalPosition: 1, isPk: false, isNullable: true }
      ],
      dbClient: client
    });

    sourceId1 = entryA.sourceId;
    assetId1 = entryA.assetId;
    console.log(`✓ Entry A created: assetId = ${assetId1}, sourceId = ${sourceId1}`);

    // Verify Entry A is visible in listCatalogAssets
    const assetsAfterA = await listCatalogAssets({ projectId, sourceId: sourceId1, dbClient: client });
    const foundA = assetsAfterA.some(a => a.asset_id === assetId1);
    if (!foundA) throw new Error('Entry A was not found in catalog assets!');
    console.log(`✓ Confirmed: Entry A is visible in source assets (total: ${assetsAfterA.length})`);

    // STEP 2: Create Second Catalog Entry (repeating the existing workflow)
    console.log('\n[STEP 2] Adding Second Catalog Entry (Entry B) via same workflow...');
    const entryB = await registerCatalogMetadata({
      project,
      userId,
      source: {
        sourceId: sourceId1,
        sourceName: 'Uploaded Schema Files - Test Add',
        sourceType: 'FILE_UPLOAD'
      },
      asset: {
        schemaName: project.physical_schema_name || 'public',
        assetName: 'test_catalog_entry_beta',
        assetType: 'FILE_SCHEMA'
      },
      columns: [
        { name: 'order_id', type: 'uuid', ordinalPosition: 0, isPk: true, isNullable: false },
        { name: 'amount', type: 'numeric', ordinalPosition: 1, isPk: false, isNullable: false }
      ],
      dbClient: client
    });

    assetId2 = entryB.assetId;
    console.log(`✓ Entry B created: assetId = ${assetId2}`);

    // STEP 3: Verify BOTH Entry A and Entry B remain visible alongside each other
    console.log('\n[STEP 3] Verifying that BOTH Entry A and Entry B exist simultaneously...');
    const assetsAfterB = await listCatalogAssets({ projectId, sourceId: sourceId1, dbClient: client });

    const hasA = assetsAfterB.some(a => a.asset_id === assetId1);
    const hasB = assetsAfterB.some(a => a.asset_id === assetId2);

    if (!hasA) throw new Error('Entry A disappeared after adding Entry B!');
    if (!hasB) throw new Error('Entry B is missing from catalog assets!');

    console.log(`✓ Verified: Both Entry A and Entry B are visible in catalog!`);
    console.log(`  - Entry A: ${assetsAfterB.find(a => a.asset_id === assetId1)?.asset_name}`);
    console.log(`  - Entry B: ${assetsAfterB.find(a => a.asset_id === assetId2)?.asset_name}`);
    console.log(`  - Total assets in source: ${assetsAfterB.length}`);

    // STEP 4: Verify columns for both entries are preserved
    console.log('\n[STEP 4] Verifying columns for both entries...');
    const colsA = await listCatalogColumns({ projectId, assetId: assetId1, dbClient: client });
    const colsB = await listCatalogColumns({ projectId, assetId: assetId2, dbClient: client });

    console.log(`✓ Entry A has ${colsA.length} columns:`, colsA.map(c => c.column_name).join(', '));
    console.log(`✓ Entry B has ${colsB.length} columns:`, colsB.map(c => c.column_name).join(', '));

    if (colsA.length !== 2 || colsB.length !== 2) {
      throw new Error(`Unexpected column counts: colsA=${colsA.length}, colsB=${colsB.length}`);
    }

    console.log('\n======================================================');
    console.log('ALL ADD CATALOG WORKFLOW TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
  } finally {
    console.log('\nCleaning up test assets...');
    if (assetId1) {
      await client.query('DELETE FROM public.asset_column WHERE asset_id = $1', [assetId1]);
      await client.query('DELETE FROM public.catalog_asset WHERE asset_id = $1', [assetId1]);
    }
    if (assetId2) {
      await client.query('DELETE FROM public.asset_column WHERE asset_id = $1', [assetId2]);
      await client.query('DELETE FROM public.catalog_asset WHERE asset_id = $1', [assetId2]);
    }
    if (sourceId1) {
      await client.query('DELETE FROM public.data_source WHERE source_id = $1', [sourceId1]);
    }
    console.log('✓ Cleanup complete.');
    client.release();
    await pool.end();
  }
}

testAddCatalogWorkflow().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});


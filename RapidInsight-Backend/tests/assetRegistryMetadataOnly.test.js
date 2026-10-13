const path = require('path');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });
const { Pool } = require(pgPath);

const { registerAssetMetadata } = require('../backend/services/schema-service/src/services/assetRegistrationService');
const { listCatalogAssets, listCatalogColumns } = require('../backend/services/schema-service/src/services/catalogProfilingService');

async function runAcceptanceTest() {
  console.log('================================================================');
  console.log('STARTING ASSET REGISTRY METADATA-ONLY ACCEPTANCE TEST');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const testAssetName = 'colleges_test_registry';
  const testFileName = 'colleges_test_records.csv';

  try {
    // 1. Fetch valid project
    const { rows: projRows } = await pool.query(
      `SELECT * FROM public.projects WHERE physical_schema_name IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (!projRows.length) {
      throw new Error('No test project found.');
    }
    const testProject = projRows[0];
    const testUserId = testProject.created_by;
    const physicalSchema = testProject.physical_schema_name;

    console.log(`[SETUP] Using project "${testProject.name}" (${testProject.id})`);
    console.log(`[SETUP] Target physical schema: "${physicalSchema}"\n`);

    // Clean up any leftovers
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`, [testProject.id, testAssetName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`, [testProject.id, testAssetName]);

    // 2. Define metadata payload (mimicking the browser metadata extractor)
    // Note: The sample file conceptually has 5 business records, but ONLY metadata is sent:
    const metadataPayload = {
      projectId: testProject.id,
      originalFileName: testFileName,
      assetName: testAssetName,
      fileType: 'csv',
      fileSize: 4520,
      sheetName: null,
      columns: [
        { name: 'college_id', type: 'number', ordinalPosition: 0, isPk: true, isNullable: false },
        { name: 'college_name', type: 'string', ordinalPosition: 1, isPk: false, isNullable: false },
        { name: 'branch', type: 'string', ordinalPosition: 2, isPk: false, isNullable: true },
        { name: 'seats', type: 'number', ordinalPosition: 3, isPk: false, isNullable: true }
      ]
    };

    console.log('[STEP 1] Executing Asset Registry metadata registration...');
    console.log('Payload transmitted:');
    console.log(JSON.stringify(metadataPayload, null, 2));

    const result = await registerAssetMetadata({
      project: testProject,
      userId: testUserId,
      payload: metadataPayload
    });

    console.log('\n✓ Registration succeeded:');
    console.log(`  Asset ID: ${result.assetId}`);
    console.log(`  Schema ID: ${result.schemaId}`);
    console.log(`  Column Count: ${result.columnCount}`);

    // 3. VERIFICATION: Check public.catalog_asset
    console.log('\n[STEP 2] Verifying public.catalog_asset in database...');
    const { rows: assetRows } = await pool.query(
      `SELECT asset_id, asset_name, fq_name, file_size, column_count, status, created_at 
       FROM public.catalog_asset 
       WHERE asset_id = $1`,
      [result.assetId]
    );

    if (assetRows.length !== 1) {
      throw new Error('FAIL: catalog_asset record not created.');
    }
    const assetRecord = assetRows[0];
    console.log(`✓ catalog_asset found: name="${assetRecord.asset_name}", file_size=${assetRecord.file_size}, column_count=${assetRecord.column_count}, status="${assetRecord.status}"`);

    // 4. VERIFICATION: Check public.asset_column
    console.log('\n[STEP 3] Verifying public.asset_column in database...');
    const { rows: colRows } = await pool.query(
      `SELECT column_name, data_type, ordinal_position, is_pk, is_nullable 
       FROM public.asset_column 
       WHERE asset_id = $1 
       ORDER BY ordinal_position`,
      [result.assetId]
    );

    if (colRows.length !== 4) {
      throw new Error(`FAIL: Expected 4 column records, found ${colRows.length}.`);
    }
    console.log('✓ Column records verified in database:');
    console.table(colRows);

    // 5. VERIFICATION: Check public.schemas (uploaded_row_count must be 0)
    console.log('\n[STEP 4] Verifying public.schemas metadata (MUST NOT STORE ROWS)...');
    const { rows: schemaRows } = await pool.query(
      `SELECT id, original_file_name, file_type, field_count, uploaded_row_count, table_status 
       FROM public.schemas 
       WHERE id = $1`,
      [result.schemaId]
    );

    if (schemaRows.length !== 1) {
      throw new Error('FAIL: schemas record not created.');
    }
    const schemaRecord = schemaRows[0];
    if (schemaRecord.uploaded_row_count !== 0) {
      throw new Error(`FAIL: uploaded_row_count is ${schemaRecord.uploaded_row_count}, expected 0.`);
    }
    console.log(`✓ public.schemas confirmed: field_count=${schemaRecord.field_count}, uploaded_row_count=${schemaRecord.uploaded_row_count}, table_status="${schemaRecord.table_status}"`);

    // 6. VERIFICATION: Verify NO physical table contains business rows
    console.log('\n[STEP 5] Verifying that NO business data rows exist in PostgreSQL...');
    const { rows: tableCheck } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
      [physicalSchema, testAssetName]
    );

    if (tableCheck.length > 0) {
      const { rows: countRows } = await pool.query(
        `SELECT count(*)::int as count FROM "${physicalSchema}"."${testAssetName}"`
      );
      if (countRows[0].count > 0) {
        throw new Error(`FAIL: Physical table contains ${countRows[0].count} business records! Expected 0 rows.`);
      }
      console.log(`✓ Physical table contains exactly 0 business records.`);
    } else {
      console.log(`✓ Verified: Zero business rows exist in database for this registered asset.`);
    }

    // 7. VERIFICATION: Verify listing in Asset Registry
    console.log('\n[STEP 6] Verifying appearance in Asset Registry list API...');
    const catalogAssets = await listCatalogAssets({
      projectId: testProject.id,
      sourceId: null
    });

    const foundInRegistry = catalogAssets.find((a) => a.asset_id === result.assetId);
    if (!foundInRegistry) {
      throw new Error('FAIL: Registered asset does not appear in Asset Registry list.');
    }
    console.log(`✓ Asset successfully listed in Asset Registry: "${foundInRegistry.asset_name}"`);
    console.log(`  Source: "${foundInRegistry.source_name}", is_populated: ${foundInRegistry.is_populated}, row_count: ${foundInRegistry.row_count}`);

    // 8. VERIFICATION: Verify duplicate registration blocking
    console.log('\n[STEP 7] Verifying duplicate asset registration blocking (409 Conflict)...');
    let duplicateBlocked = false;
    try {
      await registerAssetMetadata({
        project: testProject,
        userId: testUserId,
        payload: metadataPayload
      });
    } catch (err) {
      if (err.statusCode === 409 && err.code === 'DUPLICATE_ASSET_BLOCKED') {
        duplicateBlocked = true;
        console.log(`✓ Duplicate registration blocked with HTTP 409: "${err.message}"`);
      } else {
        throw err;
      }
    }
    if (!duplicateBlocked) {
      throw new Error('FAIL: Duplicate asset registration was not blocked.');
    }

    // Clean up test data
    await pool.query(`DELETE FROM public.catalog_asset WHERE asset_id = $1`, [result.assetId]);
    await pool.query(`DELETE FROM public.schemas WHERE id = $1`, [result.schemaId]);
    console.log('\n[CLEANUP] Test records safely cleaned up.');

    console.log('\n================================================================');
    console.log('ALL ASSET REGISTRY ACCEPTANCE TESTS PASSED SUCCESSFULLY! (7/7)');
    console.log('================================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('\nACCEPTANCE TEST FAILED:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runAcceptanceTest();


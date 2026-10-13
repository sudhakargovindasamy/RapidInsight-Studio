const path = require('path');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });
const { Pool } = require(pgPath);
const supabasePkg = path.resolve(__dirname, '../backend/services/schema-service/node_modules/@supabase/supabase-js');
const { createClient } = require(supabasePkg);

const {
  computeCanonicalFingerprint,
  validateIncomingData,
  loadOrReplacePhysicalTable
} = require('../backend/services/schema-service/src/services/physicalTableLoaderService');

async function runTestSuite() {
  console.log('=== STARTING REGISTRY ASSET DATA LOAD TEST SUITE ===\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  let testProjectId = null;
  let testProject = null;
  const testTableName = 'test_registry_products';
  const schemaOnlyName = 'test_schema_only_defs';

  try {
    // 1. Fetch an existing valid project for testing
    const { rows: projectRows } = await pool.query(
      `SELECT * 
       FROM public.projects 
       WHERE physical_schema_name IS NOT NULL 
       ORDER BY created_at DESC LIMIT 1`
    );

    if (!projectRows.length) {
      throw new Error('No project found with physical_schema_name');
    }

    testProject = projectRows[0];
    testProjectId = testProject.id;
    const physicalSchema = testProject.physical_schema_name;

    console.log(`[SETUP] Using Project: "${testProject.name}" (${testProjectId})`);
    console.log(`[SETUP] Target Physical Schema: "${physicalSchema}"\n`);

    // Clean up any leftovers from prior runs in correct dependency order
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name IN ($2, $3)`, [testProjectId, testTableName, schemaOnlyName]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [testProjectId, testTableName, schemaOnlyName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [testProjectId, testTableName, schemaOnlyName]);

    // -------------------------------------------------------------
    // TEST 1: New Table Creation & Data Loading (CSV / records)
    // -------------------------------------------------------------
    console.log('[TEST 1] Testing New Table Creation with Valid Rows...');
    const schemaDef1 = {
      name: testTableName,
      fields: [
        { name: 'product_id', type: 'number', primaryKey: true },
        { name: 'product_name', type: 'string', notNull: true },
        { name: 'price', type: 'number' },
        { name: 'in_stock', type: 'boolean' }
      ]
    };

    const rows1 = [
      { product_id: 101, product_name: 'Wireless Keyboard', price: 49.99, in_stock: true },
      { product_id: 102, product_name: 'Ergonomic Mouse', price: 29.50, in_stock: true },
      { product_id: 103, product_name: 'USB-C Cable', price: 9.99, in_stock: false }
    ];

    const result1 = await loadOrReplacePhysicalTable({
      pool,
      supabase,
      project: testProject,
      userId: testProject.created_by,
      schemaDefinition: schemaDef1,
      rows: rows1,
      sanitizedTableName: testTableName,
      originalFileName: `${testTableName}.csv`,
      fileType: 'csv'
    });

    if (!result1.physicalTableName || result1.rowCount !== 3 || result1.isUpdate !== false) {
      throw new Error(`TEST 1 Failed: Expected 3 rows and isUpdate=false, got: ${JSON.stringify(result1)}`);
    }

    // Verify physical table in PostgreSQL
    const { rows: pgRows1 } = await pool.query(
      `SELECT product_id, product_name, price, in_stock FROM "${physicalSchema}"."${result1.physicalTableName}" ORDER BY product_id ASC`
    );

    if (pgRows1.length !== 3 || pgRows1[0].product_name !== 'Wireless Keyboard') {
      throw new Error(`TEST 1 Failed: Physical table does not contain expected records.`);
    }

    // Verify metadata
    const { rows: sRows1 } = await pool.query(
      `SELECT table_status, uploaded_row_count, seed_fingerprint, generated_table_id FROM public.schemas WHERE id = $1`,
      [result1.schemaId]
    );

    if (sRows1[0].table_status !== 'BUILT' || sRows1[0].uploaded_row_count !== 3 || !sRows1[0].seed_fingerprint) {
      throw new Error(`TEST 1 Failed: Schema metadata not updated correctly.`);
    }

    const { rows: gtRows1 } = await pool.query(
      `SELECT status, row_count FROM public.generated_tables WHERE id = $1`,
      [result1.generatedTableId]
    );

    if (gtRows1[0].status !== 'POPULATED' || gtRows1[0].row_count !== 3) {
      throw new Error(`TEST 1 Failed: Generated table metadata status is not POPULATED.`);
    }

    console.log('✓ TEST 1 PASSED: New physical table created and populated successfully.\n');

    // -------------------------------------------------------------
    // TEST 2: Unchanged Duplicate Data Upload (Must be blocked with 409)
    // -------------------------------------------------------------
    console.log('[TEST 2] Testing Duplicate Upload with Identical Schema & Data...');
    let duplicateBlocked = false;
    try {
      await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project: testProject,
        userId: testProject.created_by,
        schemaDefinition: schemaDef1,
        rows: rows1,
        sanitizedTableName: testTableName,
        originalFileName: `${testTableName}.csv`,
        fileType: 'csv'
      });
    } catch (err) {
      if (err.statusCode === 409 && err.code === 'DUPLICATE_TABLE_BLOCKED') {
        duplicateBlocked = true;
      } else {
        throw err;
      }
    }

    if (!duplicateBlocked) {
      throw new Error('TEST 2 Failed: Duplicate upload with identical data was NOT blocked with 409.');
    }

    // Verify existing table is still intact
    const { rows: pgCheck2 } = await pool.query(
      `SELECT count(*)::int as count FROM "${physicalSchema}"."${result1.physicalTableName}"`
    );
    if (pgCheck2[0].count !== 3) {
      throw new Error('TEST 2 Failed: Existing table was modified during blocked duplicate attempt.');
    }

    console.log('✓ TEST 2 PASSED: Identical duplicate correctly blocked with HTTP 409, table preserved.\n');

    // -------------------------------------------------------------
    // TEST 3: Updated Data Replacement (Must replace existing table atomically)
    // -------------------------------------------------------------
    console.log('[TEST 3] Testing Controlled Replacement with Updated Data...');
    const rowsUpdated = [
      { product_id: 101, product_name: 'Wireless Keyboard v2', price: 59.99, in_stock: true },
      { product_id: 102, product_name: 'Ergonomic Mouse v2', price: 34.50, in_stock: true },
      { product_id: 103, product_name: 'USB-C Cable Pro', price: 14.99, in_stock: true },
      { product_id: 104, product_name: 'Monitor Stand', price: 39.99, in_stock: true } // New 4th row!
    ];

    const result3 = await loadOrReplacePhysicalTable({
      pool,
      supabase,
      project: testProject,
      userId: testProject.created_by,
      schemaDefinition: schemaDef1,
      rows: rowsUpdated,
      sanitizedTableName: testTableName,
      originalFileName: `${testTableName}.csv`,
      fileType: 'csv'
    });

    if (result3.isUpdate !== true || result3.rowCount !== 4) {
      throw new Error(`TEST 3 Failed: Expected isUpdate=true and rowCount=4, got: ${JSON.stringify(result3)}`);
    }

    // Verify updated rows in PostgreSQL
    const { rows: pgRows3 } = await pool.query(
      `SELECT product_id, product_name, price FROM "${physicalSchema}"."${result3.physicalTableName}" ORDER BY product_id ASC`
    );

    if (pgRows3.length !== 4 || pgRows3[0].product_name !== 'Wireless Keyboard v2') {
      throw new Error('TEST 3 Failed: Physical table was not reloaded with updated rows.');
    }

    // Verify metadata reflects updated row count
    const { rows: gtRows3 } = await pool.query(
      `SELECT row_count FROM public.generated_tables WHERE id = $1`,
      [result3.generatedTableId]
    );
    if (gtRows3[0].row_count !== 4) {
      throw new Error('TEST 3 Failed: generated_tables row_count was not updated to 4.');
    }

    console.log('✓ TEST 3 PASSED: Table successfully replaced with updated data (4 rows).\n');

    // -------------------------------------------------------------
    // TEST 4: Validation Failure (Must reject without touching existing table)
    // -------------------------------------------------------------
    console.log('[TEST 4] Testing Rejection on Data Validation Failure...');
    let validationFailed = false;
    try {
      await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project: testProject,
        userId: testProject.created_by,
        schemaDefinition: { name: testTableName, fields: [] }, // Invalid: empty fields!
        rows: rowsUpdated,
        sanitizedTableName: testTableName,
        originalFileName: `${testTableName}.csv`,
        fileType: 'csv'
      });
    } catch (err) {
      if (err.statusCode === 400 && err.code === 'INVALID_SCHEMA_DEFINITION') {
        validationFailed = true;
      }
    }

    if (!validationFailed) {
      throw new Error('TEST 4 Failed: Invalid schema was not rejected with 400.');
    }

    // Ensure the 4 rows from TEST 3 are still preserved intact
    const { rows: pgCheck4 } = await pool.query(
      `SELECT count(*)::int as count FROM "${physicalSchema}"."${result3.physicalTableName}"`
    );
    if (pgCheck4[0].count !== 4) {
      throw new Error('TEST 4 Failed: Existing table was modified or lost during validation failure.');
    }

    console.log('✓ TEST 4 PASSED: Validation failure safely rejected, existing table preserved.\n');

    // -------------------------------------------------------------
    // TEST 5: Transactional Rollback on DB Failure
    // -------------------------------------------------------------
    console.log('[TEST 5] Testing Transaction Rollback on Database Failure...');
    let rollbackOccurred = false;
    try {
      // Intentionally trigger a real database constraint violation (duplicate key on unique column)
      const duplicateKeyRows = [
        { product_id: 999, product_name: 'Duplicate Item 1' },
        { product_id: 999, product_name: 'Duplicate Item 2' }
      ];

      await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project: testProject,
        userId: testProject.created_by,
        schemaDefinition: {
          name: testTableName,
          fields: [
            { name: 'product_id', type: 'number', unique: true },
            { name: 'product_name', type: 'string' }
          ]
        },
        rows: duplicateKeyRows,
        sanitizedTableName: testTableName,
        originalFileName: `${testTableName}.csv`,
        fileType: 'csv'
      });
    } catch (err) {
      rollbackOccurred = true;
    }

    if (!rollbackOccurred) {
      throw new Error('TEST 5 Failed: Error was not caught.');
    }

    // Verify previous table is still preserved
    const { rows: pgCheck5 } = await pool.query(
      `SELECT count(*)::int as count FROM "${physicalSchema}"."${result3.physicalTableName}"`
    );
    if (pgCheck5[0].count !== 4) {
      throw new Error('TEST 5 Failed: Table lost during transaction failure.');
    }

    console.log('✓ TEST 5 PASSED: Transaction rollback safely preserved previous valid table.\n');

    // -------------------------------------------------------------
    // TEST 6: Schema-Only File (JSON/YAML with zero rows)
    // -------------------------------------------------------------
    console.log('[TEST 6] Testing Schema-Only Definition (Zero Rows)...');
    const schemaDef6 = {
      name: schemaOnlyName,
      fields: [
        { name: 'id', type: 'uuid', primaryKey: true },
        { name: 'title', type: 'string' }
      ]
    };

    const result6 = await loadOrReplacePhysicalTable({
      pool,
      supabase,
      project: testProject,
      userId: testProject.created_by,
      schemaDefinition: schemaDef6,
      rows: [], // Zero rows!
      sanitizedTableName: schemaOnlyName,
      originalFileName: `${schemaOnlyName}.json`,
      fileType: 'json'
    });

    if (result6.rowCount !== 0 || result6.status !== 'CREATED') {
      throw new Error(`TEST 6 Failed: Expected 0 rows and status CREATED, got: ${JSON.stringify(result6)}`);
    }

    const { rows: pgCheck6 } = await pool.query(
      `SELECT count(*)::int as count FROM "${physicalSchema}"."${result6.physicalTableName}"`
    );
    if (pgCheck6[0].count !== 0) {
      throw new Error('TEST 6 Failed: Schema-only table should have 0 rows.');
    }

    // Clean up test tables and catalog assets in correct dependency order
    await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${result1.physicalTableName}" CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${result6.physicalTableName}" CASCADE`);
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name IN ($2, $3)`, [testProjectId, testTableName, schemaOnlyName]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [testProjectId, testTableName, schemaOnlyName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [testProjectId, testTableName, schemaOnlyName]);

    console.log('✓ TEST 6 PASSED: Schema-only table structure created with 0 rows (no seed generation).\n');

    console.log('======================================================');
    console.log('ALL REGISTRY ASSET DATA LOAD TESTS PASSED! (6/6)');
    console.log('======================================================\n');
  } finally {
    await pool.end();
  }
}

runTestSuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});

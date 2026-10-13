const path = require('path');
const crypto = require('crypto');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const supabasePkg = path.resolve(__dirname, '../backend/services/schema-service/node_modules/@supabase/supabase-js');

require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });
const { Pool, Client } = require(pgPath);
const { createClient } = require(supabasePkg);

const {
  computeCanonicalFingerprint,
  validateIncomingData,
  loadOrReplacePhysicalTable
} = require('../backend/services/schema-service/src/services/physicalTableLoaderService');

const {
  testAndDiscoverTables,
  importTablesAsSchemas
} = require('../backend/services/schema-service/src/services/dbConnectionService');

const { getProjectForEmployee } = require('../backend/services/schema-service/src/services/projectAccessService');

async function runDeepVerification() {
  console.log('================================================================');
  console.log('   REGISTRY ASSET DEEP VERIFICATION & REGRESSION SUITE          ');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const testTableName = 'verify_deep_products';
  const extSourceTableName = 'verify_ext_source_table';

  try {
    // 1. Fetch valid project
    const { rows: projectRows } = await pool.query(
      `SELECT * FROM public.projects WHERE physical_schema_name IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (!projectRows.length) throw new Error('No project found with physical_schema_name');

    const project = projectRows[0];
    const physicalSchema = project.physical_schema_name;

    console.log(`[CONFIG] Project: "${project.name}" (${project.id})`);
    console.log(`[CONFIG] Physical Schema: "${physicalSchema}"\n`);

    // Clean up any leftovers
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name IN ($2, $3)`, [project.id, testTableName, extSourceTableName]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [project.id, testTableName, extSourceTableName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [project.id, testTableName, extSourceTableName]);
    await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${testTableName}" CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS "public"."${extSourceTableName}" CASCADE`);

    // =================================================================
    // SECTION 1: METADATA CONSISTENCY DEEP VERIFICATION
    // =================================================================
    console.log('--- SECTION 1: METADATA CONSISTENCY DEEP VERIFICATION ---');

    // 1.1 Initial Creation
    const schemaDef1 = {
      name: testTableName,
      fields: [
        { name: 'id', type: 'number', primaryKey: true },
        { name: 'title', type: 'string', notNull: true },
        { name: 'price', type: 'number' }
      ]
    };
    const rows1 = [
      { id: 1, title: 'Item Alpha', price: 10.5 },
      { id: 2, title: 'Item Beta', price: 20.0 }
    ];

    const res1 = await loadOrReplacePhysicalTable({
      pool,
      supabase,
      project,
      userId: project.created_by,
      schemaDefinition: schemaDef1,
      rows: rows1,
      sanitizedTableName: testTableName,
      originalFileName: `${testTableName}.csv`,
      fileType: 'csv'
    });

    // Inspect metadata records
    const { rows: schemaRows1 } = await pool.query(`SELECT * FROM public.schemas WHERE id = $1`, [res1.schemaId]);
    const { rows: gtRows1 } = await pool.query(`SELECT * FROM public.generated_tables WHERE id = $1`, [res1.generatedTableId]);
    const { rows: catRows1 } = await pool.query(`SELECT * FROM public.catalog_asset WHERE schema_id = $1`, [res1.schemaId]);
    const { rows: physRows1 } = await pool.query(`SELECT count(*)::int as count FROM "${physicalSchema}"."${res1.physicalTableName}"`);

    if (!schemaRows1.length || !gtRows1.length || !catRows1.length) {
      throw new Error('Metadata missing after initial load');
    }
    const s1 = schemaRows1[0];
    const g1 = gtRows1[0];
    const c1 = catRows1[0];

    // Verify consistency linkages
    if (s1.generated_table_id !== g1.id || g1.schema_id !== s1.id || c1.generated_table_id !== g1.id) {
      throw new Error(`Inconsistent ID linkages: schema.gt=${s1.generated_table_id}, gt.schema=${g1.schema_id}, cat.gt=${c1.generated_table_id}`);
    }
    if (s1.table_status !== 'BUILT' || g1.status !== 'POPULATED' || physRows1[0].count !== 2 || g1.row_count !== 2) {
      throw new Error(`Inconsistent statuses or row count: table_status=${s1.table_status}, gt_status=${g1.status}, count=${physRows1[0].count}`);
    }
    console.log('✓ 1.1 Creation Consistency: Schemas, GeneratedTables, CatalogAsset, and Physical Table fully synchronized.');

    // 1.2 Duplicate Block Verification
    let duplicateBlocked = false;
    try {
      await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project,
        userId: project.created_by,
        schemaDefinition: schemaDef1,
        rows: rows1,
        sanitizedTableName: testTableName,
        originalFileName: `${testTableName}.csv`,
        fileType: 'csv'
      });
    } catch (err) {
      if (err.statusCode === 409 && err.code === 'DUPLICATE_TABLE_BLOCKED') {
        duplicateBlocked = true;
      }
    }
    if (!duplicateBlocked) throw new Error('Duplicate load was not blocked with 409');

    // Confirm metadata remained unchanged
    const { rows: schemaRowsDup } = await pool.query(`SELECT * FROM public.schemas WHERE id = $1`, [res1.schemaId]);
    if (schemaRowsDup[0].seed_fingerprint !== s1.seed_fingerprint) {
      throw new Error('Fingerprint altered on blocked duplicate');
    }
    console.log('✓ 1.2 Duplicate Blocking: Correctly blocked with HTTP 409, metadata completely untouched.');

    // 1.3 Replacement Consistency Verification
    const rowsUpdate = [
      { id: 1, title: 'Item Alpha Updated', price: 15.0 },
      { id: 2, title: 'Item Beta Updated', price: 25.0 },
      { id: 3, title: 'Item Gamma New', price: 35.0 }
    ];

    const resUpdate = await loadOrReplacePhysicalTable({
      pool,
      supabase,
      project,
      userId: project.created_by,
      schemaDefinition: schemaDef1,
      rows: rowsUpdate,
      sanitizedTableName: testTableName,
      originalFileName: `${testTableName}.csv`,
      fileType: 'csv'
    });

    if (!resUpdate.isUpdate || resUpdate.rowCount !== 3) {
      throw new Error('Replacement failed to register isUpdate=true and rowCount=3');
    }
    const { rows: schemaRowsUpd } = await pool.query(`SELECT * FROM public.schemas WHERE id = $1`, [resUpdate.schemaId]);
    const { rows: gtRowsUpd } = await pool.query(`SELECT * FROM public.generated_tables WHERE id = $1`, [resUpdate.generatedTableId]);
    const { rows: physRowsUpd } = await pool.query(`SELECT count(*)::int as count FROM "${physicalSchema}"."${resUpdate.physicalTableName}"`);

    if (schemaRowsUpd[0].uploaded_row_count !== 3 || gtRowsUpd[0].row_count !== 3 || physRowsUpd[0].count !== 3) {
      throw new Error('Row count mismatch after replacement');
    }
    if (schemaRowsUpd[0].seed_fingerprint === s1.seed_fingerprint) {
      throw new Error('Fingerprint did not update after data modification');
    }
    console.log('✓ 1.3 Replacement Consistency: Correctly replaced data (3 rows), updated fingerprint, preserved linkages.');

    // 1.4 Validation Failure Safety
    let validationFailed = false;
    try {
      await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project,
        userId: project.created_by,
        schemaDefinition: { fields: [] }, // Invalid: empty fields
        rows: [{ id: 1 }],
        sanitizedTableName: testTableName,
        originalFileName: `${testTableName}.csv`,
        fileType: 'csv'
      });
    } catch (err) {
      validationFailed = true;
    }
    if (!validationFailed) throw new Error('Validation failure was not rejected');

    const { rows: physRowsAfterValFail } = await pool.query(`SELECT count(*)::int as count FROM "${physicalSchema}"."${resUpdate.physicalTableName}"`);
    if (physRowsAfterValFail[0].count !== 3) {
      throw new Error('Physical table modified during validation failure');
    }
    console.log('✓ 1.4 Validation Failure Safety: Rejected before DB mutation; 3 rows preserved intact.');

    // 1.5 Rollback Safety
    let rollbackSuccess = false;
    try {
      await loadOrReplacePhysicalTable({
        pool,
        supabase,
        project,
        userId: project.created_by,
        schemaDefinition: {
          name: testTableName,
          fields: [{ name: 'id', type: 'number', unique: true }]
        },
        rows: [{ id: 10 }, { id: 10 }], // Duplicate key error
        sanitizedTableName: testTableName,
        originalFileName: `${testTableName}.csv`,
        fileType: 'csv'
      });
    } catch (err) {
      rollbackSuccess = true;
    }
    if (!rollbackSuccess) throw new Error('Rollback scenario did not throw error');

    const { rows: physRowsAfterRollback } = await pool.query(`SELECT count(*)::int as count FROM "${physicalSchema}"."${resUpdate.physicalTableName}"`);
    if (physRowsAfterRollback[0].count !== 3) {
      throw new Error('Physical table lost or corrupted during rollback');
    }
    console.log('✓ 1.5 Transaction Rollback Safety: Transaction safely aborted; previous 3 rows intact.\n');


    // =================================================================
    // SECTION 2: EXTERNAL DATABASE IMPORT WORKFLOW
    // =================================================================
    console.log('--- SECTION 2: EXTERNAL DATABASE IMPORT WORKFLOW ---');

    // Create a temporary source table in public schema to act as external table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public."${extSourceTableName}" (
        emp_id serial primary key,
        emp_name text not null,
        department text,
        salary numeric
      );
    `);
    await pool.query(`
      INSERT INTO public."${extSourceTableName}" (emp_name, department, salary)
      VALUES ('Alice', 'Engineering', 95000), ('Bob', 'Design', 85000), ('Charlie', 'Product', 90000);
    `);

    // Test 2.1: Discover tables
    const discoverResult = await testAndDiscoverTables({
      connectionString: process.env.DATABASE_URL
    });

    if (!discoverResult.success || !Array.isArray(discoverResult.tables)) {
      throw new Error('Discover tables failed');
    }
    const foundExtTable = discoverResult.tables.find(t => t.name === extSourceTableName);
    if (!foundExtTable || foundExtTable.columnCount < 4) {
      throw new Error(`External source table not found in discovery: ${JSON.stringify(discoverResult.tables.map(t => t.name))}`);
    }
    console.log(`✓ 2.1 External DB Discovery: Discovered table "${foundExtTable.fullName}" with ${foundExtTable.columnCount} columns.`);

    // Test 2.2: Import selected table
    const importResult = await importTablesAsSchemas({
      project,
      userId: project.created_by,
      userEmail: 'test@example.com',
      connectionConfig: {
        connectionString: process.env.DATABASE_URL,
        database: 'postgres'
      },
      selectedTables: [{ schema: 'public', name: extSourceTableName }],
      supabase
    });

    if (!importResult.success || importResult.importedCount !== 1) {
      throw new Error(`Import failed: ${JSON.stringify(importResult)}`);
    }

    const imported = importResult.schemas[0];
    const { rows: importedPhysRows } = await pool.query(
      `SELECT count(*)::int as count FROM "${physicalSchema}"."${imported.physical_table_name}"`
    );

    if (importedPhysRows[0].count !== 3) {
      throw new Error(`Expected 3 rows in imported physical table, got: ${importedPhysRows[0].count}`);
    }

    // Verify catalog entry for external table
    const { rows: extCatRows } = await pool.query(
      `SELECT ca.*, ds.source_type, ds.database_name, ds.credential_secret_ref
       FROM public.catalog_asset ca
       JOIN public.data_source ds ON ds.source_id = ca.source_id
       WHERE ca.schema_id = $1`,
      [imported.id]
    );

    if (!extCatRows.length) throw new Error('Catalog entry missing for imported external table');
    const extCat = extCatRows[0];
    if (extCat.source_type !== 'EXTERNAL_POSTGRESQL' || extCat.credential_secret_ref) {
      throw new Error(`Catalog source mismatch or secret leaked: ${JSON.stringify(extCat)}`);
    }

    console.log(`✓ 2.2 External DB Import: Imported 3 rows into physical table "${imported.physical_table_name}". Catalog asset recorded without credential leakage.\n`);


    // =================================================================
    // SECTION 3: FINGERPRINT PERSISTENCE & CONCURRENCY
    // =================================================================
    console.log('--- SECTION 3: FINGERPRINT PERSISTENCE & CONCURRENCY ---');

    // 3.1 Persistence across re-queries
    const { rows: fpCheck } = await pool.query(
      `SELECT seed_fingerprint FROM public.schemas WHERE id = $1`,
      [resUpdate.schemaId]
    );
    if (!fpCheck.length || !fpCheck[0].seed_fingerprint || fpCheck[0].seed_fingerprint.length !== 64) {
      throw new Error('Fingerprint not persisted as 64-character SHA-256');
    }
    console.log(`✓ 3.1 Fingerprint Persistence: Valid SHA-256 (${fpCheck[0].seed_fingerprint.slice(0, 16)}...) persisted in database.`);

    // 3.2 Concurrency: Send simultaneous duplicate requests
    console.log('Testing concurrent duplicate upload protection...');
    const concurrentPromises = [1, 2].map(async () => {
      try {
        await loadOrReplacePhysicalTable({
          pool,
          supabase,
          project,
          userId: project.created_by,
          schemaDefinition: schemaDef1,
          rows: rowsUpdate,
          sanitizedTableName: testTableName,
          originalFileName: `${testTableName}.csv`,
          fileType: 'csv'
        });
        return { success: true };
      } catch (err) {
        return { success: false, status: err.statusCode, code: err.code };
      }
    });

    const concurrentResults = await Promise.all(concurrentPromises);
    const blockedCount = concurrentResults.filter(r => r.status === 409 && r.code === 'DUPLICATE_TABLE_BLOCKED').length;

    // Both should be blocked with 409 because data is identical
    if (blockedCount !== 2) {
      throw new Error(`Expected concurrent identical requests to be safely blocked with 409, got: ${JSON.stringify(concurrentResults)}`);
    }

    // Verify generated_tables has no duplicate rows
    const { rows: gtDupCheck } = await pool.query(
      `SELECT count(*)::int as count FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name = $2`,
      [project.id, testTableName]
    );
    if (gtDupCheck[0].count !== 1) {
      throw new Error(`Duplicate generated_tables created: count=${gtDupCheck[0].count}`);
    }
    console.log('✓ 3.2 Concurrency Protection: 2/2 concurrent duplicates blocked with HTTP 409; exactly 1 generated_tables record maintained.\n');


    // =================================================================
    // SECTION 4: SECURITY & PROJECT AUTHORIZATION
    // =================================================================
    console.log('--- SECTION 4: SECURITY & PROJECT AUTHORIZATION ---');

    // 4.1 Non-owner access rejection
    const fakeUserId = crypto.randomUUID();
    let authRejected = false;
    try {
      await getProjectForEmployee({
        supabase,
        projectId: project.id,
        userId: fakeUserId
      });
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 403) {
        authRejected = true;
      }
    }

    if (!authRejected) throw new Error('Unauthorized user was not rejected by getProjectForEmployee');
    console.log('✓ 4.1 Project Authorization: Unauthorized user correctly rejected with 403/404.');

    // 4.2 Safe SQL identifiers
    const { quoteIdentifier } = require('../backend/services/schema-service/src/utils/identifierNaming');
    const safeCol = quoteIdentifier('column"name; DROP TABLE students;--');
    if (safeCol !== '"column""name; DROP TABLE students;--"') {
      throw new Error(`Quote identifier failed SQL injection defense: ${safeCol}`);
    }
    console.log(`✓ 4.2 SQL Injection Defense: Identifier escaped safely using PostgreSQL rules: ${safeCol}\n`);


    // =================================================================
    // CLEANUP
    // =================================================================
    await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${res1.physicalTableName}" CASCADE`);
    if (imported.physical_table_name) {
      await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${imported.physical_table_name}" CASCADE`);
    }
    await pool.query(`DROP TABLE IF EXISTS "public"."${extSourceTableName}" CASCADE`);
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name IN ($2, $3)`, [project.id, testTableName, extSourceTableName]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [project.id, testTableName, extSourceTableName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name IN ($2, $3)`, [project.id, testTableName, extSourceTableName]);

    console.log('================================================================');
    console.log('ALL DEEP VERIFICATION CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================\n');

  } finally {
    await pool.end();
  }
}

runDeepVerification().catch(err => {
  console.error('\n❌ DEEP VERIFICATION FAILED:', err);
  process.exit(1);
});


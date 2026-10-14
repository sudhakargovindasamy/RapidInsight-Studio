const path = require('path');
const assert = require('assert');

const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const xlsxPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/xlsx');
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });

const { Pool } = require(pgPath);
const XLSX = require(xlsxPath);

const {
  getAssetAndColumns,
  parseDataFile,
  validateFileSchema,
  validateAndAlignRows,
  generateSyntheticRows,
  ingestFileIntoAsset,
  ingestMockDataIntoAsset,
  ingestDatabaseIntoAsset
} = require('../backend/services/schema-service/src/services/assetIngestionService');

const { registerAssetMetadata } = require('../backend/services/schema-service/src/services/assetRegistrationService');
const { listCatalogAssets, listCatalogColumns } = require('../backend/services/schema-service/src/services/catalogProfilingService');
const { getDatabaseTableColumns, testAndDiscoverTables } = require('../backend/services/schema-service/src/services/dbConnectionService');

async function runTestSuite() {
  console.log('================================================================');
  console.log('      DATA INGESTION WORKFLOW COMPREHENSIVE TEST SUITE          ');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(`  ${err.message}`);
      failed++;
    }
  }

  try {
    // 1. Fetch authorized test project
    const { rows: projRows } = await pool.query(
      `SELECT * FROM public.projects WHERE physical_schema_name IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (!projRows.length) {
      throw new Error('No test project found in database.');
    }
    const testProject = projRows[0];
    const testUserId = testProject.created_by;
    const testAssetName = 'ingestion_unit_test_asset';

    console.log(`[SETUP] Using Project: "${testProject.name}" (${testProject.id})`);
    console.log(`[SETUP] Physical Schema: "${testProject.physical_schema_name}"\n`);

    // Clean up any existing test assets
    await pool.query(
      `DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`,
      [testProject.id, testAssetName]
    );
    await pool.query(
      `DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`,
      [testProject.id, testAssetName]
    );

    // 2. Register metadata for test asset
    const registered = await registerAssetMetadata({
      project: testProject,
      userId: testUserId,
      payload: {
        originalFileName: `${testAssetName}.csv`,
        assetName: testAssetName,
        fileType: 'csv',
        fileSize: 1024,
        columns: [
          { name: 'student_id', type: 'number', isPk: true, isNullable: false },
          { name: 'full_name', type: 'string', isPk: false, isNullable: false },
          { name: 'department', type: 'string', isPk: false, isNullable: true },
          { name: 'gpa', type: 'number', isPk: false, isNullable: true }
        ]
      }
    });

    const testAssetId = registered.assetId;
    console.log(`[SETUP] Registered test asset ID: ${testAssetId}\n`);

    // ── SUITE 1: File Parsing & Column Validation ─────────────────────────
    console.log('--- SUITE 1: File Parsing & Column Validation ---');

    await test('parseDataFile parses CSV buffer correctly', async () => {
      const csvContent = 'student_id,full_name,department,gpa\n1,Alice Johnson,Computer Science,3.95\n2,Bob Smith,Mathematics,3.70';
      const parsed = parseDataFile({ buffer: Buffer.from(csvContent, 'utf-8'), originalFileName: 'data.csv' });
      assert.strictEqual(parsed.rows.length, 2);
      assert.strictEqual(parsed.headers.length, 4);
      assert.strictEqual(parsed.rows[0].full_name, 'Alice Johnson');
    });

    await test('parseDataFile parses Excel buffer correctly', async () => {
      const ws = XLSX.utils.aoa_to_sheet([
        ['student_id', 'full_name', 'department', 'gpa'],
        [10, 'Carol White', 'Physics', 3.8],
        [20, 'David Brown', 'Chemistry', 3.6]
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const excelBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const parsed = parseDataFile({ buffer: excelBuf, originalFileName: 'records.xlsx' });
      assert.strictEqual(parsed.rows.length, 2);
      assert.strictEqual(parsed.rows[0].full_name, 'Carol White');
    });

    await test('parseDataFile parses JSON buffer correctly', async () => {
      const jsonContent = JSON.stringify([
        { student_id: 101, full_name: 'Emma Watson', department: 'Arts', gpa: 3.9 },
        { student_id: 102, full_name: 'Frank Miller', department: 'Music', gpa: 3.5 }
      ]);
      const parsed = parseDataFile({ buffer: Buffer.from(jsonContent, 'utf-8'), originalFileName: 'test.json' });
      assert.strictEqual(parsed.rows.length, 2);
      assert.strictEqual(parsed.rows[0].student_id, 101);
    });

    // ── SUITE 1B: Strict Schema Validation Scenarios ───────────────
    console.log('\n--- SUITE 1B: Strict File-to-Asset Schema Validation ---');

    const { columns: targetColumns } = await getAssetAndColumns(testProject.id, testAssetId);

    // Mock 18-column registered asset specification
    const registered18Columns = Array.from({ length: 18 }, (_, i) => ({
      column_name: `field_${i + 1}`,
      data_type: i % 2 === 0 ? 'number' : 'string',
      is_pk: i === 0,
      is_nullable: i > 0
    }));

    // Mock 41-column uploaded file headers with only 5 matching (field_1 to field_5)
    const uploaded41Headers = [
      ...Array.from({ length: 5 }, (_, i) => `field_${i + 1}`),
      ...Array.from({ length: 36 }, (_, i) => `unrelated_extra_${i + 1}`)
    ];

    await test('SCENARIO 1: Rejects file with 41 columns when registered asset has 18 columns (COLUMN_COUNT_MISMATCH)', async () => {
      const sampleRows = [{ field_1: 1, field_2: 'text' }];
      const validation = validateFileSchema({
        headers: uploaded41Headers,
        rows: sampleRows,
        registeredColumns: registered18Columns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'COLUMN_COUNT_MISMATCH');
      assert.strictEqual(validation.details.expectedColumnCount, 18);
      assert.strictEqual(validation.details.receivedColumnCount, 41);
      assert.strictEqual(validation.details.matchedColumnCount, 5);
      assert.strictEqual(validation.details.missingColumns.length, 13);
      assert.strictEqual(validation.details.unexpectedColumns.length, 36);
    });

    await test('SCENARIO 2: Rejects file with same column count but completely different names (SCHEMA_MISMATCH)', async () => {
      const differentHeaders = ['alpha', 'beta', 'gamma', 'delta'];
      const sampleRows = [{ alpha: 1, beta: 'b', gamma: 'c', delta: 4 }];
      const validation = validateFileSchema({
        headers: differentHeaders,
        rows: sampleRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'SCHEMA_MISMATCH');
      assert.strictEqual(validation.details.missingColumns.length, 4);
      assert.strictEqual(validation.details.unexpectedColumns.length, 4);
      assert.strictEqual(validation.details.matchedColumnCount, 0);
    });

    await test('SCENARIO 3: Rejects file with missing columns (3 headers for 4 registered columns)', async () => {
      const missingHeaders = ['student_id', 'full_name', 'department']; // missing gpa
      const sampleRows = [{ student_id: 1, full_name: 'Alice', department: 'CS' }];
      const validation = validateFileSchema({
        headers: missingHeaders,
        rows: sampleRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'COLUMN_COUNT_MISMATCH');
      assert.strictEqual(validation.details.expectedColumnCount, 4);
      assert.strictEqual(validation.details.receivedColumnCount, 3);
    });

    await test('SCENARIO 4: Rejects file with unexpected extra column (5 headers for 4 registered columns)', async () => {
      const extraHeaders = ['student_id', 'full_name', 'department', 'gpa', 'extra_bonus_score'];
      const sampleRows = [{ student_id: 1, full_name: 'Bob', department: 'Math', gpa: 3.5, extra_bonus_score: 99 }];
      const validation = validateFileSchema({
        headers: extraHeaders,
        rows: sampleRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'COLUMN_COUNT_MISMATCH');
      assert.strictEqual(validation.details.expectedColumnCount, 4);
      assert.strictEqual(validation.details.receivedColumnCount, 5);
      assert(validation.details.unexpectedColumns.includes('extra_bonus_score'));
    });

    await test('SCENARIO 5: Rejects file with duplicate column headers (DUPLICATE_COLUMNS_DETECTED)', async () => {
      const dupHeaders = ['student_id', 'full_name', 'department', 'student_id'];
      const sampleRows = [{ student_id: 1, full_name: 'Carol', department: 'Phys' }];
      const validation = validateFileSchema({
        headers: dupHeaders,
        rows: sampleRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'DUPLICATE_COLUMNS_DETECTED');
      assert(validation.details.duplicateColumns.includes('student_id'));
    });

    await test('SCENARIO 6: Rejects file with incompatible data type (string in numeric column)', async () => {
      const validHeaders = ['student_id', 'full_name', 'department', 'gpa'];
      const invalidRows = [{ student_id: 1, full_name: 'Dan', department: 'Chem', gpa: 'NOT_A_NUMBER' }];
      const validation = validateFileSchema({
        headers: validHeaders,
        rows: invalidRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'INCOMPATIBLE_DATA_TYPES');
      assert(validation.details.incompatibleTypes.some(t => t.includes('gpa')));
    });

    await test('SCENARIO 7: Rejects empty or null value in NOT NULL column', async () => {
      const validHeaders = ['student_id', 'full_name', 'department', 'gpa'];
      const invalidRows = [{ student_id: 2, full_name: '', department: 'Bio', gpa: 3.8 }];
      const validation = validateFileSchema({
        headers: validHeaders,
        rows: invalidRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, false);
      assert.strictEqual(validation.code, 'INCOMPATIBLE_DATA_TYPES');
      assert(validation.details.incompatibleTypes.some(t => t.includes('full_name') && t.includes('NOT NULL')));
    });

    await test('SCENARIO 8: Accepts file with exactly matching schema', async () => {
      const validHeaders = ['student_id', 'full_name', 'department', 'gpa'];
      const validRows = [{ student_id: 10, full_name: 'Elena', department: 'CS', gpa: 3.9 }];
      const validation = validateFileSchema({
        headers: validHeaders,
        rows: validRows,
        registeredColumns: targetColumns
      });

      assert.strictEqual(validation.isValid, true);
      assert.strictEqual(validation.details.expectedColumnCount, 4);
      assert.strictEqual(validation.details.receivedColumnCount, 4);
    });

    await test('SCENARIO 9: Accepts file with columns in different order and aligns correctly by column name', async () => {
      const swappedHeaders = ['gpa', 'department', 'student_id', 'full_name'];
      const sampleRows = [{ gpa: 3.85, department: 'Music', student_id: 25, full_name: 'Felix' }];

      const validation = validateFileSchema({
        headers: swappedHeaders,
        rows: sampleRows,
        registeredColumns: targetColumns
      });
      assert.strictEqual(validation.isValid, true);

      const aligned = validateAndAlignRows({
        rows: sampleRows,
        headers: swappedHeaders,
        registeredColumns: targetColumns
      });

      assert.strictEqual(aligned.length, 1);
      assert.strictEqual(aligned[0].student_id, 25);
      assert.strictEqual(aligned[0].full_name, 'Felix');
      assert.strictEqual(aligned[0].department, 'Music');
      assert.strictEqual(aligned[0].gpa, 3.85);
      // Verify keys follow registered column order: student_id, full_name, department, gpa
      assert.deepStrictEqual(Object.keys(aligned[0]), ['student_id', 'full_name', 'department', 'gpa']);
    });

    await test('SCENARIO 10: Normalizes column names case-insensitively and trims whitespace', async () => {
      const headers = [' STUDENT_ID ', 'Full_Name', 'DEPARTMENT', 'gpa '];
      const rows = [{ ' STUDENT_ID ': 33, 'Full_Name': 'Grace', 'DEPARTMENT': 'Navy', 'gpa ': 4.0 }];
      const validation = validateFileSchema({
        headers,
        rows,
        registeredColumns: targetColumns
      });
      assert.strictEqual(validation.isValid, true);
    });

    // ── SUITE 2: Method A — File Ingestion & Boundary Enforcement ───
    console.log('\n--- SUITE 2: Method A (File Ingestion & Boundary Enforcement) ---');

    await test('SCENARIO 11: End-to-end ingestion rejects mismatched file: inserts 0 rows and leaves asset unpopulated', async () => {
      // Create a CSV with 41 columns
      const headerLine = uploaded41Headers.join(',');
      const dataLine = uploaded41Headers.map((_, i) => (i === 0 ? '1' : `val_${i}`)).join(',');
      const mismatchedCsv = `${headerLine}\n${dataLine}`;

      let caughtError = null;
      try {
        await ingestFileIntoAsset({
          project: testProject,
          userId: testUserId,
          assetId: testAssetId,
          fileBuffer: Buffer.from(mismatchedCsv, 'utf-8'),
          originalFileName: 'mismatched_41_cols.csv'
        });
      } catch (err) {
        caughtError = err;
      }

      assert(caughtError != null, 'ingestFileIntoAsset must reject mismatched file');
      assert.strictEqual(caughtError.statusCode, 400);
      assert.strictEqual(caughtError.code, 'COLUMN_COUNT_MISMATCH');
      assert.strictEqual(caughtError.details.expectedColumnCount, 4);
      assert.strictEqual(caughtError.details.receivedColumnCount, 41);

      // Verify asset in catalog was NOT populated and row_count remains 0
      const catalogAssets = await listCatalogAssets({ projectId: testProject.id });
      const currentAsset = catalogAssets.find(a => a.asset_id === testAssetId);
      assert.strictEqual(currentAsset.is_populated, false);
      assert.strictEqual(currentAsset.row_count, 0);
    });

    await test('SCENARIO 12: Ingests valid CSV with exact schema into physical table and marks asset POPULATED', async () => {
      const csvData = 'student_id,full_name,department,gpa\n101,Alice Walker,Engineering,3.85\n102,Brian Cox,Physics,3.92\n103,Clara Schumann,Music,3.78';
      const result = await ingestFileIntoAsset({
        project: testProject,
        userId: testUserId,
        assetId: testAssetId,
        fileBuffer: Buffer.from(csvData, 'utf-8'),
        originalFileName: 'students.csv'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rowCount, 3);
      assert.strictEqual(result.status, 'POPULATED');

      // Verify physical table exists and has rows in PostgreSQL
      const physQuery = `SELECT count(*)::int as cnt FROM "${testProject.physical_schema_name}"."${result.physicalTableName}"`;
      const { rows: physRows } = await pool.query(physQuery);
      assert.strictEqual(physRows[0].cnt, 3);

      // Verify catalog_asset status is now populated with row_count = 3
      const catalogAssets = await listCatalogAssets({ projectId: testProject.id });
      const currentAsset = catalogAssets.find(a => a.asset_id === testAssetId);
      assert(currentAsset, 'Asset should exist in catalog');
      assert.strictEqual(currentAsset.is_populated, true);
      assert.strictEqual(currentAsset.row_count, 3);
    });

    await test('SCENARIO 13: Ingests valid CSV with rearranged column order successfully', async () => {
      // Swapped column order in CSV: gpa, full_name, department, student_id
      const swappedCsv = 'gpa,full_name,department,student_id\n3.99,Grace Hopper,Computing,201\n3.75,Alan Turing,Mathematics,202';
      const result = await ingestFileIntoAsset({
        project: testProject,
        userId: testUserId,
        assetId: testAssetId,
        fileBuffer: Buffer.from(swappedCsv, 'utf-8'),
        originalFileName: 'swapped_students.csv'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rowCount, 2);

      // Verify that data was loaded into the proper columns
      const queryCheck = `SELECT student_id, full_name, gpa FROM "${testProject.physical_schema_name}"."${result.physicalTableName}" ORDER BY student_id ASC LIMIT 1`;
      const { rows: checkRows } = await pool.query(queryCheck);
      assert.strictEqual(parseInt(checkRows[0].student_id, 10), 201);
      assert.strictEqual(checkRows[0].full_name, 'Grace Hopper');
      assert(Math.abs(parseFloat(checkRows[0].gpa) - 3.99) < 0.01);
    });

    // ── SUITE 3: Method B — Synthetic Mock Ingestion ────────────────
    console.log('\n--- SUITE 3: Method B (Synthetic Mock Ingestion) ---');

    await test('generateSyntheticRows generates typed rows with valid constraints', async () => {
      const { columns } = await getAssetAndColumns(testProject.id, testAssetId);
      const mockRows = generateSyntheticRows(columns, 15);
      assert.strictEqual(mockRows.length, 15);
      assert(mockRows[0].student_id != null, 'PK must be populated');
      assert(typeof mockRows[0].full_name === 'string', 'full_name must be string');
      assert(typeof mockRows[0].gpa === 'number', 'gpa must be numeric');
    });

    await test('ingestMockDataIntoAsset populates destination table with synthetic data', async () => {
      const result = await ingestMockDataIntoAsset({
        project: testProject,
        userId: testUserId,
        assetId: testAssetId,
        rowCount: 25
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rowCount, 25);
      assert.strictEqual(result.isSynthetic, true);

      // Verify database table updated to 25 rows
      const physQuery = `SELECT count(*)::int as cnt FROM "${testProject.physical_schema_name}"."${result.physicalTableName}"`;
      const { rows: physRows } = await pool.query(physQuery);
      assert.strictEqual(physRows[0].cnt, 25);

      // Verify catalog reflects new populated row count
      const catalogAssets = await listCatalogAssets({ projectId: testProject.id });
      const currentAsset = catalogAssets.find(a => a.asset_id === testAssetId);
      assert.strictEqual(currentAsset.is_populated, true);
      assert.strictEqual(currentAsset.row_count, 25);
    });

    // ── SUITE 4: Method C — Database Connection & Ingestion ─────────
    console.log('\n--- SUITE 4: Method C (Database Ingestion) ---');

    const testDbConfig = {
      connectionString: process.env.DATABASE_URL,
      allowSelfSigned: true,
      rejectUnauthorized: false
    };

    await test('testAndDiscoverTables connects to PostgreSQL and finds public tables', async () => {
      const connResult = await testAndDiscoverTables(testDbConfig);
      assert.strictEqual(connResult.success, true);
      assert(Array.isArray(connResult.tables), 'tables must be an array');
      assert(connResult.tables.length > 0, 'database must contain user tables');
    });

    await test('getDatabaseTableColumns introspects source columns', async () => {
      const cols = await getDatabaseTableColumns(
        testDbConfig,
        'public',
        'projects'
      );
      assert(Array.isArray(cols), 'columns must be an array');
      assert(cols.some(c => c.name === 'id' || c.name === 'name'), 'projects table has id and name');
    });

    await test('ingestDatabaseIntoAsset imports rows with column mapping', async () => {
      // Map from information_schema.columns where ordinal_position is integer and column_name is string
      const mapping = {
        student_id: 'ordinal_position',
        full_name: 'column_name',
        department: 'data_type',
        gpa: null
      };

      const result = await ingestDatabaseIntoAsset({
        project: testProject,
        userId: testUserId,
        assetId: testAssetId,
        connectionConfig: testDbConfig,
        sourceSchema: 'information_schema',
        sourceTable: 'columns',
        columnMapping: mapping,
        limit: 5
      });

      assert.strictEqual(result.success, true);
      assert(result.rowCount > 0, 'Should import at least 1 project row');

      // Verify physical table in PostgreSQL has imported rows
      const physQuery = `SELECT count(*)::int as cnt FROM "${testProject.physical_schema_name}"."${result.physicalTableName}"`;
      const { rows: physRows } = await pool.query(physQuery);
      assert.strictEqual(physRows[0].cnt, result.rowCount);
    });

    // ── SUITE 5: Security & Boundaries ─────────────────────────────
    console.log('\n--- SUITE 5: Security & Boundary Enforcement ---');

    await test('Rejects non-existent asset ID', async () => {
      const fakeAssetId = '00000000-0000-0000-0000-000000000000';
      await assert.rejects(async () => {
        await getAssetAndColumns(testProject.id, fakeAssetId);
      }, /Catalog asset not found/);
    });

    await test('Rejects empty file buffer', async () => {
      await assert.rejects(async () => {
        await ingestFileIntoAsset({
          project: testProject,
          userId: testUserId,
          assetId: testAssetId,
          fileBuffer: Buffer.from('', 'utf-8'),
          originalFileName: 'empty.csv'
        });
      }, /file buffer is empty/i);
    });

    // Clean up
    await pool.query(
      `DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`,
      [testProject.id, testAssetName]
    );
    await pool.query(
      `DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`,
      [testProject.id, testAssetName]
    );

  } finally {
    await pool.end();
  }

  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

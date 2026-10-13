const path = require('path');
const crypto = require('crypto');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const supabasePkg = path.resolve(__dirname, '../backend/services/schema-service/node_modules/@supabase/supabase-js');

require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });
const { Pool } = require(pgPath);
const { createClient } = require(supabasePkg);

const { quoteIdentifier } = require('../backend/services/schema-service/src/utils/identifierNaming');
const { loadOrReplacePhysicalTable } = require('../backend/services/schema-service/src/services/physicalTableLoaderService');

async function runSafetyAndConcurrencySuite() {
  console.log('================================================================');
  console.log('   SQL SAFETY & CONCURRENCY TRANSACTION SUITE                   ');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // -------------------------------------------------------------
    // PART 1: SQL IDENTIFIER SAFETY TESTS
    // -------------------------------------------------------------
    console.log('--- PART 1: SQL IDENTIFIER SAFETY TESTS ---');

    // 1.1 Mixed-case preservation
    const mixedCase = quoteIdentifier('ProductID');
    if (mixedCase !== '"ProductID"') {
      throw new Error(`Expected "ProductID", got ${mixedCase}`);
    }
    console.log('✓ 1.1 Mixed-case identifiers preserved: ProductID -> "ProductID"');

    // 1.2 Reserved words quoting without unexpected suffixing
    const reservedWords = ['user', 'order', 'table', 'select', 'group'];
    for (const rw of reservedWords) {
      const quoted = quoteIdentifier(rw);
      if (quoted !== `"${rw}"`) {
        throw new Error(`Expected "${rw}", got ${quoted}`);
      }
    }
    console.log('✓ 1.2 Reserved words correctly quoted: user, order, table, select, group');

    // 1.3 Embedded double-quote escaping
    const withQuote = quoteIdentifier('col"quote');
    if (withQuote !== '"col""quote"') {
      throw new Error(`Expected "col""quote", got ${withQuote}`);
    }
    console.log('✓ 1.3 Embedded double-quote escaped using PostgreSQL rule: col"quote -> "col""quote"');

    // 1.4 Injection payloads neutralized inside identifier quotes
    const injectionPayload = 'col; DROP TABLE students; --';
    const quotedInjection = quoteIdentifier(injectionPayload);
    if (quotedInjection !== '"col; DROP TABLE students; --"') {
      throw new Error(`Unexpected quote result for injection payload: ${quotedInjection}`);
    }
    console.log('✓ 1.4 Injection payload contained safely inside double-quotes');

    // 1.5 Validation on invalid inputs
    let nullCaught = false;
    try { quoteIdentifier(null); } catch { nullCaught = true; }
    if (!nullCaught) throw new Error('Failed to reject null identifier');

    let emptyCaught = false;
    try { quoteIdentifier('   '); } catch { emptyCaught = true; }
    if (!emptyCaught) throw new Error('Failed to reject empty identifier');

    let nullByteCaught = false;
    try { quoteIdentifier('col\0name'); } catch { nullByteCaught = true; }
    if (!nullByteCaught) throw new Error('Failed to reject null-byte identifier');

    let longCaught = false;
    try { quoteIdentifier('a'.repeat(64)); } catch { longCaught = true; }
    if (!longCaught) throw new Error('Failed to reject identifier >63 chars');

    console.log('✓ 1.5 Input validation safely rejects null, empty, null bytes, and >63 length identifiers.\n');

    // 1.6 Physical PostgreSQL execution with mixed-case and reserved word columns
    console.log('Testing live PostgreSQL execution with mixed-case and reserved columns...');
    const testSqlTable = 'test_sql_safety_tbl';
    await pool.query(`DROP TABLE IF EXISTS public."${testSqlTable}" CASCADE;`);
    await pool.query(`
      CREATE TABLE public."${testSqlTable}" (
        ${quoteIdentifier('ProductID')} int,
        ${quoteIdentifier('user')} text,
        ${quoteIdentifier('order')} int,
        ${quoteIdentifier('col"special')} text
      );
    `);
    await pool.query(`
      INSERT INTO public."${testSqlTable}" (${quoteIdentifier('ProductID')}, ${quoteIdentifier('user')}, ${quoteIdentifier('order')}, ${quoteIdentifier('col"special')})
      VALUES (101, 'john_doe', 5001, 'quoted_val');
    `);
    const { rows: readBackRows } = await pool.query(
      `SELECT ${quoteIdentifier('ProductID')}, ${quoteIdentifier('user')}, ${quoteIdentifier('order')}, ${quoteIdentifier('col"special')} FROM public."${testSqlTable}"`
    );
    if (!readBackRows.length || readBackRows[0].ProductID !== 101 || readBackRows[0].user !== 'john_doe') {
      throw new Error('Failed to read back rows from SQL safety test table');
    }
    await pool.query(`DROP TABLE IF EXISTS public."${testSqlTable}" CASCADE;`);
    console.log('✓ 1.6 Live PostgreSQL execution with mixed-case and reserved identifiers succeeded.\n');

    // -------------------------------------------------------------
    // PART 2: CONCURRENT DUPLICATE PROTECTION & TRANSACTION LOCK
    // -------------------------------------------------------------
    console.log('--- PART 2: CONCURRENT DUPLICATE PROTECTION & TRANSACTION LOCK ---');

    const { rows: projectRows } = await pool.query(
      `SELECT * FROM public.projects WHERE physical_schema_name IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (!projectRows.length) throw new Error('No valid project found');
    const project = projectRows[0];
    const physicalSchema = project.physical_schema_name;
    const concurrentTableName = 'verify_concurrent_race_test';

    // Clean up any leftovers
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`, [project.id, concurrentTableName]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, concurrentTableName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, concurrentTableName]);
    await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${concurrentTableName}" CASCADE`);

    const concurrentSchemaDef = {
      name: concurrentTableName,
      fields: [
        { name: 'ProductID', type: 'number', primaryKey: true },
        { name: 'ItemName', type: 'string' }
      ]
    };
    const concurrentRows = [
      { ProductID: 1, ItemName: 'Item One' },
      { ProductID: 2, ItemName: 'Item Two' }
    ];

    console.log('Firing 2 simultaneous identical loadOrReplacePhysicalTable calls to trigger race condition...');
    const p1 = loadOrReplacePhysicalTable({
      pool,
      supabase,
      project,
      userId: project.created_by,
      schemaDefinition: concurrentSchemaDef,
      rows: concurrentRows,
      sanitizedTableName: concurrentTableName,
      originalFileName: `${concurrentTableName}.csv`,
      fileType: 'csv'
    }).then(r => ({ success: true, isUpdate: r.isUpdate, res: r }))
      .catch(err => ({ success: false, status: err.statusCode, code: err.code, msg: err.message }));

    const p2 = loadOrReplacePhysicalTable({
      pool,
      supabase,
      project,
      userId: project.created_by,
      schemaDefinition: concurrentSchemaDef,
      rows: concurrentRows,
      sanitizedTableName: concurrentTableName,
      originalFileName: `${concurrentTableName}.csv`,
      fileType: 'csv'
    }).then(r => ({ success: true, isUpdate: r.isUpdate, res: r }))
      .catch(err => ({ success: false, status: err.statusCode, code: err.code, msg: err.message }));

    const [out1, out2] = await Promise.all([p1, p2]);

    console.log(`Call 1 Result: success=${out1.success}${out1.status ? ` (Status ${out1.status}: ${out1.code})` : ''}`);
    console.log(`Call 2 Result: success=${out2.success}${out2.status ? ` (Status ${out2.status}: ${out2.code})` : ''}`);

    const successes = [out1, out2].filter(o => o.success);
    const duplicates = [out1, out2].filter(o => o.status === 409 && o.code === 'DUPLICATE_TABLE_BLOCKED');

    if (successes.length !== 1 || duplicates.length !== 1) {
      throw new Error(`Expected exactly 1 success and 1 duplicate block (409), got: ${JSON.stringify({ out1, out2 })}`);
    }
    console.log('✓ 2.1 Database advisory lock serialized concurrent requests: exactly 1 created, 1 blocked with 409.');

    // Verify database state: exactly 1 generated_table, exactly 1 schema, exactly 1 catalog_asset
    const { rows: gtCount } = await pool.query(
      `SELECT count(*)::int as count FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name = $2`,
      [project.id, concurrentTableName]
    );
    const { rows: schemaCount } = await pool.query(
      `SELECT count(*)::int as count FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`,
      [project.id, concurrentTableName]
    );
    const { rows: catCount } = await pool.query(
      `SELECT count(*)::int as count FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`,
      [project.id, concurrentTableName]
    );

    if (gtCount[0].count !== 1 || schemaCount[0].count !== 1 || catCount[0].count !== 1) {
      throw new Error(`Inconsistent record count: GT=${gtCount[0].count}, Schemas=${schemaCount[0].count}, Catalog=${catCount[0].count}`);
    }
    console.log('✓ 2.2 Metadata integrity confirmed: exactly 1 schema, 1 generated_table, and 1 catalog_asset record.');

    // Cleanup
    const createdPhysicalTable = successes[0].res.physicalTableName;
    await pool.query(`DROP TABLE IF EXISTS "${physicalSchema}"."${createdPhysicalTable}" CASCADE`);
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`, [project.id, concurrentTableName]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, concurrentTableName]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, concurrentTableName]);

    console.log('\n================================================================');
    console.log('ALL SQL SAFETY & CONCURRENCY TESTS PASSED!');
    console.log('================================================================\n');
  } finally {
    await pool.end();
  }
}

runSafetyAndConcurrencySuite().catch(err => {
  console.error('\n❌ TEST SUITE FAILED:', err);
  process.exit(1);
});


const path = require('path');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');

require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });
const { Pool } = require(pgPath);

async function runHttpEndpointsE2ESuite() {
  console.log('================================================================');
  console.log('   HTTP ENDPOINTS ACTUAL E2E TEST SUITE                         ');
  console.log('================================================================\n');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const baseUrl = 'http://localhost:3001';
  const internalKey = process.env.INTERNAL_SERVICE_KEY;

  try {
    const { rows: projectRows } = await pool.query(
      `SELECT * FROM public.projects WHERE physical_schema_name IS NOT NULL ORDER BY created_at DESC LIMIT 1`
    );
    if (!projectRows.length) throw new Error('No project found');
    const project = projectRows[0];
    const userId = project.created_by;
    const testHttpTable = 'verify_http_e2e_tbl';

    // Cleanup
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`, [project.id, testHttpTable]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, testHttpTable]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, testHttpTable]);
    await pool.query(`DROP TABLE IF EXISTS "${project.physical_schema_name}"."${testHttpTable}" CASCADE`);

    const headers = {
      'x-internal-service-key': internalKey,
      'x-user-id': userId,
      'x-user-email': 'tester@example.com',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    };

    // 1. POST /schema/connect-db/test
    console.log('[E2E 1] Testing POST /schema/connect-db/test...');
    const testConnRes = await fetch(`${baseUrl}/schema/connect-db/test`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionString: process.env.DATABASE_URL })
    });
    const testConnData = await testConnRes.json();
    if (testConnRes.status !== 200 || !testConnData.success || !Array.isArray(testConnData.data.tables)) {
      throw new Error(`POST /schema/connect-db/test failed: ${JSON.stringify(testConnData)}`);
    }
    console.log(`✓ [E2E 1] POST /schema/connect-db/test returned 200 OK (${testConnData.data.tables.length} tables discovered).`);

    // 2. POST /schema/upload (First time creation)
    console.log('\n[E2E 2] Testing POST /schema/upload (New table creation)...');
    const csvContent1 = 'ProductID,ProductName,Price\n101,Laptop,999.99\n102,Mouse,24.50\n';
    const form1 = new FormData();
    form1.append('projectId', project.id);
    form1.append('file', new Blob([csvContent1], { type: 'text/csv' }), `${testHttpTable}.csv`);

    const uploadRes1 = await fetch(`${baseUrl}/schema/upload`, {
      method: 'POST',
      headers,
      body: form1
    });
    const uploadData1 = await uploadRes1.json();
    if (uploadRes1.status !== 201 || !uploadData1.success || uploadData1.data.schema.uploaded_row_count !== 2) {
      throw new Error(`POST /schema/upload creation failed: status=${uploadRes1.status}, data=${JSON.stringify(uploadData1)}`);
    }
    console.log(`✓ [E2E 2] POST /schema/upload returned 201 Created (2 rows loaded into "${uploadData1.data.schema.physical_table_name}").`);

    // 3. POST /schema/upload (Duplicate identical upload -> 409)
    console.log('\n[E2E 3] Testing POST /schema/upload (Duplicate upload blocking)...');
    const form2 = new FormData();
    form2.append('projectId', project.id);
    form2.append('file', new Blob([csvContent1], { type: 'text/csv' }), `${testHttpTable}.csv`);

    const uploadRes2 = await fetch(`${baseUrl}/schema/upload`, {
      method: 'POST',
      headers,
      body: form2
    });
    const uploadData2 = await uploadRes2.json();
    if (uploadRes2.status !== 409 || !uploadData2.message.includes('Duplicate upload blocked')) {
      throw new Error(`POST /schema/upload duplicate should return 409, got: status=${uploadRes2.status}, body=${JSON.stringify(uploadData2)}`);
    }
    console.log(`✓ [E2E 3] POST /schema/upload returned 409 Conflict: "${uploadData2.message}".`);

    // 4. POST /schema/upload (Updated data replacement -> 201 is_update: true)
    console.log('\n[E2E 4] Testing POST /schema/upload (Updated data replacement)...');
    const csvContentUpdate = 'ProductID,ProductName,Price\n101,Laptop Pro,1299.99\n102,Mouse,29.99\n103,Keyboard,79.99\n';
    const form3 = new FormData();
    form3.append('projectId', project.id);
    form3.append('file', new Blob([csvContentUpdate], { type: 'text/csv' }), `${testHttpTable}.csv`);

    const uploadRes3 = await fetch(`${baseUrl}/schema/upload`, {
      method: 'POST',
      headers,
      body: form3
    });
    const uploadData3 = await uploadRes3.json();
    if (uploadRes3.status !== 201 || !uploadData3.data.schema.is_update || uploadData3.data.schema.uploaded_row_count !== 3) {
      throw new Error(`POST /schema/upload replacement failed: status=${uploadRes3.status}, body=${JSON.stringify(uploadData3)}`);
    }
    console.log(`✓ [E2E 4] POST /schema/upload returned 201 Created with replacement: is_update=true, 3 rows loaded.`);

    // 5. GET /schema/my?projectId=...
    console.log('\n[E2E 5] Testing GET /schema/my?projectId=...');
    const listRes = await fetch(`${baseUrl}/schema/my?projectId=${project.id}`, {
      method: 'GET',
      headers
    });
    const listData = await listRes.json();
    if (listRes.status !== 200 || !listData.success || !Array.isArray(listData.data)) {
      throw new Error(`GET /schema/my failed: ${JSON.stringify(listData)}`);
    }
    const foundSchema = listData.data.find(s => s.sanitized_table_name === testHttpTable);
    if (!foundSchema || foundSchema.table_status !== 'BUILT' || foundSchema.uploaded_row_count !== 3) {
      throw new Error(`Schema not listed properly: ${JSON.stringify(foundSchema)}`);
    }
    console.log(`✓ [E2E 5] GET /schema/my returned 200 OK (verified schema listed with table_status="BUILT", uploaded_row_count=3).`);

    // Cleanup
    const physicalTable = uploadData3.data.schema.physical_table_name;
    await pool.query(`DROP TABLE IF EXISTS "${project.physical_schema_name}"."${physicalTable}" CASCADE`);
    await pool.query(`DELETE FROM public.catalog_asset WHERE project_id = $1 AND asset_name = $2`, [project.id, testHttpTable]);
    await pool.query(`DELETE FROM public.generated_tables WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, testHttpTable]);
    await pool.query(`DELETE FROM public.schemas WHERE project_id = $1 AND sanitized_table_name = $2`, [project.id, testHttpTable]);

    console.log('\n================================================================');
    console.log('ALL HTTP ENDPOINT E2E TESTS PASSED SUCCESSFULLY! (5/5)');
    console.log('================================================================\n');

  } finally {
    await pool.end();
  }
}

runHttpEndpointsE2ESuite().catch(err => {
  console.error('\n❌ HTTP E2E TEST SUITE FAILED:', err);
  process.exit(1);
});

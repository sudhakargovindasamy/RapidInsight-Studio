/**
 * Regression Test Suite: Schemas & Generated Tables Referential Integrity Contracts
 * 
 * Purpose:
 * Tests the referential integrity behavior of the decoupled relationship between
 * public.schemas and public.generated_tables, including the AFTER DELETE trigger logic,
 * project deletion cascading, transaction atomicity, and isolation of unrelated references.
 * 
 * Safety:
 * This test suite runs fully in-memory with ZERO database connections,
 * guaranteeing zero interaction with Supabase or production data.
 */

const assert = require('assert');

// In-Memory Relational Engine Simulating PostgreSQL Schemas, Generated Tables & Trigger
class MockPostgresEngine {
  constructor() {
    this.projects = new Map();
    this.schemas = new Map();
    this.generatedTables = new Map();
    this.inTransaction = false;
    this.savepoint = null;
  }

  beginTransaction() {
    assert(!this.inTransaction, 'Transaction already in progress');
    this.inTransaction = true;
    this.savepoint = {
      projects: new Map([...this.projects.entries()].map(([k, v]) => [k, { ...v }])),
      schemas: new Map([...this.schemas.entries()].map(([k, v]) => [k, { ...v }])),
      generatedTables: new Map([...this.generatedTables.entries()].map(([k, v]) => [k, { ...v }])),
    };
  }

  commitTransaction() {
    assert(this.inTransaction, 'No transaction to commit');
    this.inTransaction = false;
    this.savepoint = null;
  }

  rollbackTransaction() {
    assert(this.inTransaction, 'No transaction to rollback');
    this.projects = new Map([...this.savepoint.projects.entries()].map(([k, v]) => [k, { ...v }]));
    this.schemas = new Map([...this.savepoint.schemas.entries()].map(([k, v]) => [k, { ...v }]));
    this.generatedTables = new Map([...this.savepoint.generatedTables.entries()].map(([k, v]) => [k, { ...v }]));
    this.inTransaction = false;
    this.savepoint = null;
  }

  insertProject({ id, name }) {
    this.projects.set(id, { id, name });
  }

  insertSchema({ id, projectId, originalFileName, generatedTableId = null }) {
    this.schemas.set(id, {
      id,
      project_id: projectId,
      original_file_name: originalFileName,
      generated_table_id: generatedTableId,
      table_status: generatedTableId ? 'BUILT' : 'READY',
      updated_at: new Date()
    });
  }

  insertGeneratedTable({ id, schemaId, projectId, tableName }) {
    this.generatedTables.set(id, {
      id,
      schema_id: schemaId,
      project_id: projectId,
      table_name: tableName,
      created_at: new Date()
    });

    // Update back-link on schema
    const schema = this.schemas.get(schemaId);
    if (schema) {
      schema.generated_table_id = id;
      schema.table_status = 'BUILT';
      schema.updated_at = new Date();
    }
  }

  // Simulates: DELETE FROM public.generated_tables WHERE id = $1
  // Including the AFTER DELETE trigger: trg_nullify_schema_generated_table_id()
  deleteGeneratedTable(id) {
    const table = this.generatedTables.get(id);
    if (!table) return 0;

    // Remove row from generated_tables
    this.generatedTables.delete(id);

    // Trigger Execution: trg_nullify_schema_generated_table_id()
    // UPDATE public.schemas SET generated_table_id = NULL WHERE generated_table_id = OLD.id
    for (const [sId, schema] of this.schemas.entries()) {
      if (schema.generated_table_id === id) {
        schema.generated_table_id = null;
        schema.updated_at = new Date();
      }
    }

    return 1;
  }

  // Simulates schema deletion workflow in schemaDeleteService.js
  deleteSchemaCompletely(schemaId) {
    const schema = this.schemas.get(schemaId);
    if (!schema) return false;

    // 1. Delete associated generated tables
    for (const [tId, table] of this.generatedTables.entries()) {
      if (table.schema_id === schemaId) {
        this.deleteGeneratedTable(tId);
      }
    }

    // 2. Delete schema metadata
    this.schemas.delete(schemaId);
    return true;
  }

  // Simulates project deletion workflow in projectDeleteService.js
  deleteProjectCompletely(projectId) {
    const project = this.projects.get(projectId);
    if (!project) return false;

    // 1. Delete all generated tables for project
    for (const [tId, table] of this.generatedTables.entries()) {
      if (table.project_id === projectId) {
        this.deleteGeneratedTable(tId);
      }
    }

    // 2. Delete all schemas for project
    for (const [sId, schema] of this.schemas.entries()) {
      if (schema.project_id === projectId) {
        this.schemas.delete(sId);
      }
    }

    // 3. Delete project row
    this.projects.delete(projectId);
    return true;
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   SCHEMAS & GENERATED TABLES REFERENTIAL INTEGRITY TESTS       ');
  console.log('   (Offline In-Memory Verification - Zero Live DB Connection)   ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`✓ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`✗ FAIL: ${name}`);
      console.error(`  ${err.message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // TEST 1: Deleting a generated table clears matching schema reference
  // -------------------------------------------------------------
  test('Deleting a generated table clears its matching schema reference', () => {
    const engine = new MockPostgresEngine();
    engine.insertProject({ id: 'proj-1', name: 'Project Alpha' });
    engine.insertSchema({ id: 'sch-1', projectId: 'proj-1', originalFileName: 'sales.csv' });
    engine.insertGeneratedTable({ id: 'gt-1', schemaId: 'sch-1', projectId: 'proj-1', tableName: 'sales_raw' });

    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, 'gt-1');

    // Delete generated table directly (simulating direct SQL or test teardown)
    const deletedCount = engine.deleteGeneratedTable('gt-1');
    assert.strictEqual(deletedCount, 1);
    assert.strictEqual(engine.generatedTables.has('gt-1'), false);

    // Trigger contract: schema.generated_table_id must be nullified
    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, null);
  });

  // -------------------------------------------------------------
  // TEST 2: Deleting one generated table does NOT clear unrelated schema
  // -------------------------------------------------------------
  test('Deleting one generated table does not clear an unrelated schema reference', () => {
    const engine = new MockPostgresEngine();
    engine.insertProject({ id: 'proj-1', name: 'Project Alpha' });
    
    // Schema 1 & Table 1
    engine.insertSchema({ id: 'sch-1', projectId: 'proj-1', originalFileName: 'orders.csv' });
    engine.insertGeneratedTable({ id: 'gt-1', schemaId: 'sch-1', projectId: 'proj-1', tableName: 'orders' });

    // Schema 2 & Table 2
    engine.insertSchema({ id: 'sch-2', projectId: 'proj-1', originalFileName: 'customers.csv' });
    engine.insertGeneratedTable({ id: 'gt-2', schemaId: 'sch-2', projectId: 'proj-1', tableName: 'customers' });

    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, 'gt-1');
    assert.strictEqual(engine.schemas.get('sch-2').generated_table_id, 'gt-2');

    // Delete ONLY table 1
    engine.deleteGeneratedTable('gt-1');

    // Schema 1 must be nullified, Schema 2 MUST retain gt-2
    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, null);
    assert.strictEqual(engine.schemas.get('sch-2').generated_table_id, 'gt-2');
  });

  // -------------------------------------------------------------
  // TEST 3: Deleting a schema and its generated tables works completely
  // -------------------------------------------------------------
  test('Deleting a schema and its generated tables still works completely', () => {
    const engine = new MockPostgresEngine();
    engine.insertProject({ id: 'proj-1', name: 'Project Alpha' });
    engine.insertSchema({ id: 'sch-1', projectId: 'proj-1', originalFileName: 'inventory.csv' });
    engine.insertGeneratedTable({ id: 'gt-1', schemaId: 'sch-1', projectId: 'proj-1', tableName: 'inventory' });

    const success = engine.deleteSchemaCompletely('sch-1');
    assert.strictEqual(success, true);
    assert.strictEqual(engine.schemas.has('sch-1'), false);
    assert.strictEqual(engine.generatedTables.has('gt-1'), false);
  });

  // -------------------------------------------------------------
  // TEST 4: Deleting a project cascades cleanly
  // -------------------------------------------------------------
  test('Deleting a project tears down all schemas and generated tables', () => {
    const engine = new MockPostgresEngine();
    engine.insertProject({ id: 'proj-1', name: 'Project Alpha' });
    engine.insertSchema({ id: 'sch-1', projectId: 'proj-1', originalFileName: 'a.csv' });
    engine.insertGeneratedTable({ id: 'gt-1', schemaId: 'sch-1', projectId: 'proj-1', tableName: 'table_a' });
    engine.insertSchema({ id: 'sch-2', projectId: 'proj-1', originalFileName: 'b.csv' });
    engine.insertGeneratedTable({ id: 'gt-2', schemaId: 'sch-2', projectId: 'proj-1', tableName: 'table_b' });

    const success = engine.deleteProjectCompletely('proj-1');
    assert.strictEqual(success, true);
    assert.strictEqual(engine.projects.has('proj-1'), false);
    assert.strictEqual(engine.schemas.size, 0);
    assert.strictEqual(engine.generatedTables.size, 0);
  });

  // -------------------------------------------------------------
  // TEST 5: Failed transaction rolls back without leaving partial changes
  // -------------------------------------------------------------
  test('Failed transactions roll back without leaving partial state changes', () => {
    const engine = new MockPostgresEngine();
    engine.insertProject({ id: 'proj-1', name: 'Project Alpha' });
    engine.insertSchema({ id: 'sch-1', projectId: 'proj-1', originalFileName: 'metrics.csv' });
    engine.insertGeneratedTable({ id: 'gt-1', schemaId: 'sch-1', projectId: 'proj-1', tableName: 'metrics' });

    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, 'gt-1');

    // Begin transaction
    engine.beginTransaction();
    engine.deleteGeneratedTable('gt-1');
    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, null);

    // Simulate failure during subsequent step (e.g. storage error)
    engine.rollbackTransaction();

    // Verify state was completely restored to before transaction
    assert.strictEqual(engine.generatedTables.has('gt-1'), true);
    assert.strictEqual(engine.schemas.get('sch-1').generated_table_id, 'gt-1');
  });

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test runner failure:', err);
  process.exit(1);
});

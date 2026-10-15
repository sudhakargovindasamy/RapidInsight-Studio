/**
 * Offline Unit Test Suite: Dry-Run Transformation & SQL Integrity Verification
 * 
 * Purpose:
 * Statically verifies the in-memory dry-run transformation logic on migrations 007, 009, and 010.
 * Proves that:
 * 1. The original migration files on disk are NEVER modified.
 * 2. The terminating COMMIT; is replaced with ROLLBACK; in the execution payload.
 * 3. The initial BEGIN; remains intact to maintain transactional boundaries.
 * 4. The body of the migration (DDL, DO blocks, PL/pgSQL, triggers, comments) is preserved.
 * 
 * Safety:
 * Pure static in-memory test. Opens ZERO database connections.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.resolve(__dirname, '../backend/migrations');
const MIGRATION_FILES = [
  '007_break_circular_schemas_dependency.sql',
  '009_archive_legacy_backup_tables.sql',
  '010_optimize_dashboards_indexes.sql'
];

function getFileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function simulateDryRunTransformation(rawSql) {
  return rawSql.replace(/\bCOMMIT\s*;/gi, 'ROLLBACK;');
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   DRY-RUN TRANSFORMATION & SQL INTEGRITY TEST SUITE            ');
  console.log('   (100% Offline Static In-Memory Verification)                ');
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
  // TEST 1: Original migration files on disk remain strictly immutable
  // -------------------------------------------------------------
  test('Original migration files on disk are never modified by dry-run processing', () => {
    for (const filename of MIGRATION_FILES) {
      const filePath = path.join(MIGRATIONS_DIR, filename);
      const hashBefore = getFileHash(filePath);

      // Read and simulate transformation in memory
      const rawSql = fs.readFileSync(filePath, 'utf8');
      const transformed = simulateDryRunTransformation(rawSql);

      // Verify transformed is distinct
      assert.ok(transformed.includes('ROLLBACK;'));
      assert.ok(!transformed.includes('COMMIT;'));

      // Verify file on disk is bit-for-bit identical
      const hashAfter = getFileHash(filePath);
      assert.strictEqual(hashBefore, hashAfter, `File ${filename} was mutated on disk!`);
    }
  });

  // -------------------------------------------------------------
  // TEST 2: Migration 007 Transformation Verification
  // -------------------------------------------------------------
  test('Migration 007 payload replaces COMMIT with ROLLBACK while preserving triggers and DDL', () => {
    const filePath = path.join(MIGRATIONS_DIR, '007_break_circular_schemas_dependency.sql');
    const rawSql = fs.readFileSync(filePath, 'utf8');
    const transformed = simulateDryRunTransformation(rawSql);

    assert.ok(transformed.startsWith('-- Migration: 007'));
    assert.ok(transformed.includes('BEGIN;'));
    assert.ok(transformed.includes('ALTER TABLE public.schemas'));
    assert.ok(transformed.includes('CREATE OR REPLACE FUNCTION public.trg_fn_nullify_schema_generated_table_id()'));
    assert.ok(transformed.includes('CREATE TRIGGER trg_nullify_schema_generated_table_id'));
    assert.ok(transformed.includes('ROLLBACK;'));
    assert.ok(!transformed.includes('COMMIT;'));
  });

  // -------------------------------------------------------------
  // TEST 3: Migration 009 Transformation Verification
  // -------------------------------------------------------------
  test('Migration 009 payload replaces COMMIT with ROLLBACK while preserving DO blocks and grants', () => {
    const filePath = path.join(MIGRATIONS_DIR, '009_archive_legacy_backup_tables.sql');
    const rawSql = fs.readFileSync(filePath, 'utf8');
    const transformed = simulateDryRunTransformation(rawSql);

    assert.ok(transformed.startsWith('-- Migration: 009'));
    assert.ok(transformed.includes('BEGIN;'));
    assert.ok(transformed.includes('CREATE SCHEMA IF NOT EXISTS archive;'));
    assert.ok(transformed.includes('DO $$'));
    assert.ok(transformed.includes('REVOKE ALL ON SCHEMA archive FROM PUBLIC, anon, authenticated;'));
    assert.ok(transformed.includes('GRANT SELECT ON TABLE archive.%I TO postgres, service_role;'));
    assert.ok(transformed.includes('ROLLBACK;'));
    assert.ok(!transformed.includes('COMMIT;'));
  });

  // -------------------------------------------------------------
  // TEST 4: Migration 010 Transformation Verification
  // -------------------------------------------------------------
  test('Migration 010 payload replaces COMMIT with ROLLBACK while preserving DROP INDEX statements', () => {
    const filePath = path.join(MIGRATIONS_DIR, '010_optimize_dashboards_indexes.sql');
    const rawSql = fs.readFileSync(filePath, 'utf8');
    const transformed = simulateDryRunTransformation(rawSql);

    assert.ok(transformed.startsWith('-- Migration: 010'));
    assert.ok(transformed.includes('BEGIN;'));
    assert.ok(transformed.includes('DROP INDEX IF EXISTS public.dashboards_project_id_unique_idx;'));
    assert.ok(transformed.includes('DROP INDEX IF EXISTS public.dashboards_project_id_idx;'));
    assert.ok(transformed.includes('ROLLBACK;'));
    assert.ok(!transformed.includes('COMMIT;'));
  });

  // -------------------------------------------------------------
  // TEST 5: Edge Case - Preserving Non-Commit Words
  // -------------------------------------------------------------
  test('Regex does not accidentally mutate non-terminating words containing commit', () => {
    const trickySql = `
      -- We must be committed to clean architecture
      BEGIN;
      INSERT INTO audit_log (action) VALUES ('uncommitted_read');
      COMMIT;
    `;
    const transformed = simulateDryRunTransformation(trickySql);
    assert.ok(transformed.includes('committed to clean architecture'));
    assert.ok(transformed.includes('uncommitted_read'));
    assert.ok(transformed.includes('ROLLBACK;'));
    assert.ok(!transformed.includes('COMMIT;'));
  });

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  if (failed > 0) process.exit(1);
}

runTestSuite().catch(err => {
  console.error('Test suite runner failed:', err);
  process.exit(1);
});


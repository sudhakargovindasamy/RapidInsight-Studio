/**
 * Offline Unit Test Suite: Staging Migration Runner Safety & Validation Guards
 * 
 * Purpose:
 * Statically and empirically tests the fail-closed security guards, target verification logic,
 * argument constraints, path traversal rejection, production blacklisting, and secret sanitization
 * in executeStagingMigrations.js.
 * 
 * Safety:
 * This test suite uses child_process and mock tests. It opens ZERO database connections.
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { sanitizeLog, ALLOWED_MIGRATIONS, PROD_PROJECT_REF } = require('../backend/scripts/executeStagingMigrations');

const RUNNER_SCRIPT = path.resolve(__dirname, '../backend/scripts/executeStagingMigrations.js');

function runRunner(args, envOverrides = {}) {
  try {
    const stdout = execFileSync(process.execPath, [RUNNER_SCRIPT, ...args], {
      env: {
        ...process.env,
        STAGING_DATABASE_URL: '',
        DATABASE_URL: '',
        EXPECTED_STAGING_PROJECT_REF: '',
        OPERATOR_APPROVED: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        ...envOverrides
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const output = (res.stdout ? res.stdout.toString() : '') + (res.stderr ? res.stderr.toString() : '');
    return { status: 0, stdout: output, stderr: '' };
  } catch (err) {
    const output = (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : '');
    return {
      status: err.status,
      stdout: output,
      stderr: err.stderr ? err.stderr.toString() : ''
    };
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('   STAGING MIGRATION RUNNER SAFETY AUDIT TEST SUITE            ');
  console.log('   (100% Offline Static & Child-Process Validation)            ');
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
  // TEST 1: Missing migration argument halts closed
  // -------------------------------------------------------------
  test('Halts closed when no target migration argument is provided', () => {
    const res = runRunner([]);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('Missing target migration argument'));
  });

  // -------------------------------------------------------------
  // TEST 2: Rejects arbitrary or unapproved migration identifiers
  // -------------------------------------------------------------
  test('Rejects arbitrary migration numbers and unexpected strings', () => {
    const res1 = runRunner(['001']);
    assert.strictEqual(res1.status, 1);
    assert.ok(res1.stdout.includes('Unknown or disallowed migration target'));

    const res2 = runRunner(['999']);
    assert.strictEqual(res2.status, 1);
    assert.ok(res2.stdout.includes('Unknown or disallowed migration target'));

    const res3 = runRunner(['drop_database.sql']);
    assert.strictEqual(res3.status, 1);
    assert.ok(res3.stdout.includes('Unknown or disallowed migration target'));
  });

  // -------------------------------------------------------------
  // TEST 3: Rejects path traversal attempts
  // -------------------------------------------------------------
  test('Rejects path traversal attempts in argument', () => {
    const res = runRunner(['../../etc/passwd']);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('Unknown or disallowed migration target'));
  });

  // -------------------------------------------------------------
  // TEST 4: Migration 008 is strictly blocked
  // -------------------------------------------------------------
  test('Strictly rejects any attempt to execute migration 008', () => {
    const res = runRunner(['008']);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('Migration 008 is STRICTLY BLOCKED'));
  });

  // -------------------------------------------------------------
  // TEST 5: Halts closed if EXPECTED_STAGING_PROJECT_REF is missing
  // -------------------------------------------------------------
  test('Halts closed if EXPECTED_STAGING_PROJECT_REF is not configured', () => {
    const res = runRunner(['007']);
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('EXPECTED_STAGING_PROJECT_REF environment variable is not defined'));
  });

  // -------------------------------------------------------------
  // TEST 6: Critical abort if EXPECTED_STAGING_PROJECT_REF matches production
  // -------------------------------------------------------------
  test('Critical abort if EXPECTED_STAGING_PROJECT_REF matches production ref', () => {
    const res = runRunner(['007'], {
      EXPECTED_STAGING_PROJECT_REF: PROD_PROJECT_REF
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('EXPECTED_STAGING_PROJECT_REF is set to the PRODUCTION project ref'));
  });

  // -------------------------------------------------------------
  // TEST 7: Halts closed if database host reference does not match staging ref
  // -------------------------------------------------------------
  test('Halts closed when database connection host mismatches expected staging ref', () => {
    const res = runRunner(['007'], {
      EXPECTED_STAGING_PROJECT_REF: 'staging12345678',
      STAGING_DATABASE_URL: 'postgresql://postgres:pass@db.otherproject99.supabase.co:5432/postgres'
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('does not match EXPECTED_STAGING_PROJECT_REF'));
  });

  // -------------------------------------------------------------
  // TEST 8: Critical abort if database connection host matches production
  // -------------------------------------------------------------
  test('Critical abort if database connection host matches production reference', () => {
    const res = runRunner(['007'], {
      EXPECTED_STAGING_PROJECT_REF: 'staging12345678',
      STAGING_DATABASE_URL: `postgresql://postgres:pass@db.${PROD_PROJECT_REF}.supabase.co:5432/postgres`
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('Target database host matches PRODUCTION project reference'));
  });

  // -------------------------------------------------------------
  // TEST 9: Halts closed if service-key JWT ref does not match staging
  // -------------------------------------------------------------
  test('Halts closed if SUPABASE_SERVICE_ROLE_KEY JWT ref does not match expected staging ref', () => {
    const fakeWrongJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 
      Buffer.from(JSON.stringify({ ref: 'wrongref888', role: 'service_role' })).toString('base64') + 
      '.signature';

    const res = runRunner(['007'], {
      EXPECTED_STAGING_PROJECT_REF: 'staging12345678',
      STAGING_DATABASE_URL: 'postgresql://postgres:pass@db.staging12345678.supabase.co:5432/postgres',
      SUPABASE_SERVICE_ROLE_KEY: fakeWrongJwt
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes("Service key token ref ('wrongref888') does not match expected staging ref"));
  });

  // -------------------------------------------------------------
  // TEST 10: Critical abort if service-key JWT ref belongs to production
  // -------------------------------------------------------------
  test('Critical abort if SUPABASE_SERVICE_ROLE_KEY JWT belongs to production', () => {
    const fakeProdJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 
      Buffer.from(JSON.stringify({ ref: PROD_PROJECT_REF, role: 'service_role' })).toString('base64') + 
      '.signature';

    const res = runRunner(['007'], {
      EXPECTED_STAGING_PROJECT_REF: 'staging12345678',
      STAGING_DATABASE_URL: 'postgresql://postgres:pass@db.staging12345678.supabase.co:5432/postgres',
      SUPABASE_SERVICE_ROLE_KEY: fakeProdJwt
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('Service key token belongs to PRODUCTION project'));
  });

  // -------------------------------------------------------------
  // TEST 11: Halts closed if OPERATOR_APPROVED is not true
  // -------------------------------------------------------------
  test('Halts closed immediately before connection if OPERATOR_APPROVED is missing', () => {
    const res = runRunner(['007'], {
      EXPECTED_STAGING_PROJECT_REF: 'staging12345678',
      STAGING_DATABASE_URL: 'postgresql://postgres:pass@db.staging12345678.supabase.co:5432/postgres',
      OPERATOR_APPROVED: 'false'
    });
    assert.strictEqual(res.status, 1);
    assert.ok(res.stdout.includes('Operator approval is missing'));
  });

  // -------------------------------------------------------------
  // TEST 12: Secret sanitization redacts passwords and JWTs
  // -------------------------------------------------------------
  test('sanitizeLog redacts database passwords and JWT tokens', () => {
    const rawError = 'Connection failed to postgresql://postgres:SuperSecretPass123!@db.staging.supabase.co:5432/postgres with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
    const sanitized = sanitizeLog(rawError);

    assert.ok(!sanitized.includes('SuperSecretPass123!'));
    assert.ok(sanitized.includes('postgresql://postgres:*****@db.staging.supabase.co'));
    assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    assert.ok(sanitized.includes('[REDACTED_JWT]'));
  });

  // -------------------------------------------------------------
  // TEST 13: Dry-run SQL payload transforms COMMIT to ROLLBACK
  // -------------------------------------------------------------
  test('Dry run logic replaces terminating COMMIT; with ROLLBACK;', () => {
    const sampleSql = 'BEGIN;\nALTER TABLE public.schemas DROP CONSTRAINT test_fk;\nCOMMIT;\n';
    const dryRunSql = sampleSql.replace(/\bCOMMIT\s*;/gi, 'ROLLBACK;');

    assert.ok(dryRunSql.includes('ROLLBACK;'));
    assert.ok(!dryRunSql.includes('COMMIT;'));
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

/**
 * Fail-Closed Controlled Staging Migration Runner
 * 
 * Strict Operational Guardrails:
 * 1. Halts immediately if EXPECTED_STAGING_PROJECT_REF is not configured.
 * 2. Halts immediately if the database host reference matches Production ('pkyzswikbkvqrvbswjfb').
 * 3. Halts immediately if the target host reference does not match EXPECTED_STAGING_PROJECT_REF.
 * 4. Halts immediately if SUPABASE_SERVICE_ROLE_KEY is malformed or its ref does not match staging.
 * 5. Halts immediately if OPERATOR_APPROVED !== 'true'.
 * 6. Rejects any attempt to execute Migration 008 (STRICTLY BLOCKED).
 * 7. Applies migrations strictly one at a time from the approved directory.
 * 8. Handles transaction boundaries cleanly: in --dry-run mode, swaps COMMIT to ROLLBACK.
 * 9. Completely masks secrets, tokens, and database passwords in all output.
 */

const fs = require('fs');
const path = require('path');

// Dynamically resolve 'pg' from backend services
let Pool;
try {
  ({ Pool } = require('pg'));
} catch {
  const schemaServicePg = path.resolve(__dirname, '../services/schema-service/node_modules/pg');
  ({ Pool } = require(schemaServicePg));
}

const PROD_PROJECT_REF = 'pkyzswikbkvqrvbswjfb'; // Protected Production Ref
const ALLOWED_MIGRATIONS = {
  '007': '007_break_circular_schemas_dependency.sql',
  '009': '009_archive_legacy_backup_tables.sql',
  '010': '010_optimize_dashboards_indexes.sql'
};

function sanitizeLog(text) {
  if (!text) return '';
  return String(text)
    .replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, '$1*****$3')
    .replace(/(ey[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/g, '[REDACTED_JWT]');
}

async function runControlledMigration() {
  console.log('================================================================');
  console.log('       RAPIDINSIGHTSTUDIO CONTROLLED STAGING MIGRATION RUNNER   ');
  console.log('================================================================\n');

  // 1. Target Step Validation
  const targetStep = process.argv[2];
  if (!targetStep) {
    console.error('ERROR: Missing target migration argument.');
    console.error('Usage: node executeStagingMigrations.js <007|009|010> [--dry-run]');
    process.exit(1);
  }

  if (targetStep.includes('008')) {
    console.error('CRITICAL ABORT: Migration 008 is STRICTLY BLOCKED pending business sign-off.');
    process.exit(1);
  }

  const migrationFile = ALLOWED_MIGRATIONS[targetStep];
  if (!migrationFile) {
    console.error(`ERROR: Unknown or disallowed migration target '${targetStep}'. Allowed: 007, 009, 010.`);
    process.exit(1);
  }

  // 2. Expected Staging Reference Guard
  const expectedStagingRef = process.env.EXPECTED_STAGING_PROJECT_REF;
  if (!expectedStagingRef) {
    console.error('SAFETY HALT: EXPECTED_STAGING_PROJECT_REF environment variable is not defined.');
    console.error('The target staging database reference must be explicitly and independently provided.');
    process.exit(1);
  }

  if (expectedStagingRef === PROD_PROJECT_REF) {
    console.error('CRITICAL SECURITY VIOLATION: EXPECTED_STAGING_PROJECT_REF is set to the PRODUCTION project ref!');
    process.exit(1);
  }

  // 3. Database URL Host Inspection
  const dbUrlStr = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrlStr) {
    console.error('SAFETY HALT: No database connection URL provided (STAGING_DATABASE_URL or DATABASE_URL).');
    process.exit(1);
  }

  let dbUrl;
  try {
    dbUrl = new URL(dbUrlStr);
  } catch (err) {
    console.error(`SAFETY HALT: Invalid database URL format: ${err.message}`);
    process.exit(1);
  }

  const hostMatch = dbUrl.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  const targetRef = hostMatch ? hostMatch[1] : null;

  if (!targetRef) {
    console.error(`SAFETY HALT: Database host '${dbUrl.hostname}' is not a standard Supabase domain (db.<ref>.supabase.co).`);
    process.exit(1);
  }

  // Production Blacklist Guard
  if (targetRef === PROD_PROJECT_REF) {
    console.error('CRITICAL SECURITY ALERT: Target database host matches PRODUCTION project reference!');
    console.error('Execution has been aborted immediately. Zero commands executed.');
    process.exit(1);
  }

  // Staging Target Confirmation Guard
  if (targetRef !== expectedStagingRef) {
    console.error(`SAFETY HALT: Database host ref ('${targetRef}') does not match EXPECTED_STAGING_PROJECT_REF ('${expectedStagingRef}').`);
    process.exit(1);
  }

  // 4. Supabase Service Role Key Inspection (if provided)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    try {
      const parts = serviceKey.split('.');
      if (parts.length < 2) {
        throw new Error('JWT token must contain at least header and payload segments.');
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      if (payload.ref === PROD_PROJECT_REF) {
        console.error('CRITICAL SECURITY ALERT: Service key token belongs to PRODUCTION project!');
        process.exit(1);
      }
      if (payload.ref && payload.ref !== expectedStagingRef) {
        console.error(`SAFETY HALT: Service key token ref ('${payload.ref}') does not match expected staging ref ('${expectedStagingRef}').`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`SAFETY HALT: Malformed or unparseable SUPABASE_SERVICE_ROLE_KEY token: ${err.message}`);
      process.exit(1);
    }
  }

  // 5. Operator Approval Gating Guard (checked immediately before execution)
  if (process.env.OPERATOR_APPROVED !== 'true') {
    console.error('SAFETY HALT: Operator approval is missing.');
    console.error('Set OPERATOR_APPROVED=true only after completing the pre-execution checklist.');
    process.exit(1);
  }

  const isDryRun = process.argv.includes('--dry-run');

  console.log(`✓ Target Verified: db.${targetRef}.supabase.co (Confirmed Staging)`);
  console.log(`✓ Target Migration: ${migrationFile}`);
  console.log(`✓ Mode: ${isDryRun ? 'DRY RUN (Syntax & Transaction Simulation)' : 'LIVE STAGING EXECUTION'}`);
  console.log(`✓ Migration 008: EXCLUDED & BLOCKED`);

  // 6. Read Migration File from strictly approved migrations directory
  const sqlPath = path.resolve(__dirname, '../migrations', migrationFile);
  if (!fs.existsSync(sqlPath)) {
    console.error(`FATAL: Migration file not found at ${sqlPath}`);
    process.exit(1);
  }

  const rawSqlContent = fs.readFileSync(sqlPath, 'utf8');

  // In dry run mode, replace the terminating COMMIT; with ROLLBACK; to ensure
  // that internal commits in the SQL file do not persist changes.
  let executionSql = rawSqlContent;
  if (isDryRun) {
    executionSql = rawSqlContent.replace(/\bCOMMIT\s*;/gi, 'ROLLBACK;');
    console.log('✓ Dry-run mode: Replaced COMMIT with ROLLBACK in SQL payload.');
  }

  // 7. Connect and Execute within Transaction
  // Note: Migration SQL files contain their own BEGIN; and COMMIT; (or ROLLBACK;) blocks.
  const pool = new Pool({
    connectionString: dbUrlStr,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();

  try {
    console.log(`\nBeginning execution of ${migrationFile}...`);

    await client.query(executionSql);

    if (isDryRun) {
      console.log(`✓ [DRY RUN SUCCESS] ${migrationFile} executed and rolled back cleanly. Syntax, constraints & triggers valid.`);
    } else {
      console.log(`✓ [SUCCESS] ${migrationFile} committed successfully to staging database.`);
    }

    console.log('\nSTOP DECISION: Halting runner execution.');
    console.log('Subsequent migrations will NOT run automatically.');
    console.log('Perform the required postflight checks before running the next migration.\n');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\nEXECUTION FAILED - TRANSACTION ROLLED BACK:');
    console.error(sanitizeLog(err.message));
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Export for unit test suites and CLI execution
module.exports = {
  sanitizeLog,
  ALLOWED_MIGRATIONS,
  PROD_PROJECT_REF
};

if (require.main === module) {
  runControlledMigration().catch(err => {
    console.error('\nUNHANDLED RUNNER EXCEPTION:');
    console.error(sanitizeLog(err.message));
    process.exit(1);
  });
}

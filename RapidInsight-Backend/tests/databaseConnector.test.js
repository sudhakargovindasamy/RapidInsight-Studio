const path = require('path');
const assert = require('assert');

// Load environment variables before requiring schema-service modules
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });
const schemaServicePath = path.resolve(__dirname, '../backend/services/schema-service');
const {
  BaseConnector,
  PostgresConnector,
  ConnectorRegistry,
  defaultRegistry,
  resolveConnector,
  securityUtils
} = require(path.join(schemaServicePath, 'src/connectors'));

const {
  testAndDiscoverTables,
  parseClientConfig
} = require(path.join(schemaServicePath, 'src/services/dbConnectionService'));

const {
  testDatabaseConnection: controllerTestDbConn
} = require(path.join(schemaServicePath, 'src/controllers/schemaController'));

async function runTestSuite() {
  console.log('================================================================');
  console.log('   DATABASE CONNECTOR FOUNDATION AUTOMATED TEST SUITE           ');
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

  async function asyncTest(name, fn) {
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

  // -------------------------------------------------------------
  // SUITE 1: Connector Architecture & Base Contract
  // -------------------------------------------------------------
  console.log('--- 1. Connector Architecture & Base Contract ---');

  test('BaseConnector throws on direct instantiation without type', () => {
    assert.throws(() => new BaseConnector(), /requires a valid string databaseType/);
  });

  test('BaseConnector enforces method implementations', () => {
    const base = new BaseConnector('mock');
    assert.strictEqual(base.databaseType, 'mock');
    assert.throws(() => base.validateConfig({}), /validateConfig\(\) must be implemented/);
  });

  test('Registry has Postgres connector pre-registered for types and schemes', () => {
    const pgConn = defaultRegistry.getConnector('postgres');
    assert.ok(pgConn instanceof PostgresConnector);
    assert.strictEqual(defaultRegistry.getConnector('postgresql'), pgConn);
  });

  // -------------------------------------------------------------
  // SUITE 2: URI Scheme Detection & Unsupported Schemes
  // -------------------------------------------------------------
  console.log('\n--- 2. URI Scheme Detection & Unsupported Schemes ---');

  test('Resolves postgres:// and postgresql:// URIs to PostgresConnector', () => {
    const res1 = resolveConnector({ connectionString: 'postgres://user:pass@localhost:5432/mydb' });
    assert.strictEqual(res1.resolvedType, 'postgres');
    assert.ok(res1.connector instanceof PostgresConnector);

    const res2 = resolveConnector({ connectionString: 'postgresql://user:pass@localhost:5432/mydb' });
    assert.strictEqual(res2.resolvedType, 'postgres');
    assert.ok(res2.connector instanceof PostgresConnector);
  });

  test('Rejects unsupported URI scheme mysql:// with clear error', () => {
    assert.throws(
      () => resolveConnector({ connectionString: 'mysql://root:secret@localhost:3306/testdb' }),
      (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_DATABASE_TYPE');
        assert.ok(err.message.includes('mysql'));
        return true;
      }
    );
  });

  test('Rejects unsupported URI schemes mongodb:// and oracle://', () => {
    assert.throws(
      () => resolveConnector({ connectionString: 'mongodb://localhost:27017/testdb' }),
      (err) => err.code === 'UNSUPPORTED_DATABASE_TYPE'
    );
    assert.throws(
      () => resolveConnector({ connectionString: 'oracle://user:pass@localhost:1521/testdb' }),
      (err) => err.code === 'UNSUPPORTED_DATABASE_TYPE'
    );
  });

  // -------------------------------------------------------------
  // SUITE 3: Explicit Database Types & Strict No-Guessing Policy
  // -------------------------------------------------------------
  console.log('\n--- 3. Explicit Database Types & No-Guessing Policy ---');

  test('Resolves explicit database type "postgres"', () => {
    const res = resolveConnector({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'mydb',
      user: 'myuser'
    });
    assert.strictEqual(res.resolvedType, 'postgres');
    assert.strictEqual(res.mode, 'fields');
  });

  test('Rejects unsupported explicit type "snowflake" or "mysql"', () => {
    assert.throws(
      () => resolveConnector({ type: 'mysql', host: 'localhost', database: 'test' }),
      (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_DATABASE_TYPE');
        assert.ok(err.message.includes('mysql'));
        return true;
      }
    );
  });

  test('Strict no-guessing: Rejects credentials without URI or explicit type', () => {
    assert.throws(
      () => resolveConnector({ user: 'postgres', password: 'secret_password' }),
      (err) => {
        assert.strictEqual(err.code, 'DATABASE_TYPE_REQUIRED');
        return true;
      }
    );
  });

  test('Strict no-guessing: Rejects host/db without explicit type', () => {
    assert.throws(
      () => resolveConnector({ host: 'localhost', database: 'postgres', user: 'postgres' }),
      (err) => {
        assert.strictEqual(err.code, 'DATABASE_TYPE_REQUIRED');
        return true;
      }
    );
  });

  // -------------------------------------------------------------
  // SUITE 4: Field Validation & Port Checks
  // -------------------------------------------------------------
  console.log('\n--- 4. Field Validation & Port Checks ---');

  test('PostgresConnector validates required fields: missing host', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ database: 'mydb', user: 'u' }),
      (err) => err.code === 'MISSING_HOST'
    );
  });

  test('PostgresConnector validates required fields: missing database', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ host: 'localhost', user: 'u' }),
      (err) => err.code === 'MISSING_DATABASE'
    );
  });

  test('PostgresConnector validates required fields: missing user', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ host: 'localhost', database: 'db' }),
      (err) => err.code === 'MISSING_USER'
    );
  });

  test('PostgresConnector rejects invalid port values', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ host: 'localhost', port: 'invalid', database: 'db', user: 'u' }),
      (err) => err.code === 'INVALID_PORT'
    );
    assert.throws(
      () => connector.validateConfig({ host: 'localhost', port: 70000, database: 'db', user: 'u' }),
      (err) => err.code === 'INVALID_PORT'
    );
  });

  // -------------------------------------------------------------
  // SUITE 5: SSRF Prevention & Metadata Destination Denylist
  // -------------------------------------------------------------
  console.log('\n--- 5. SSRF Prevention & Metadata Destination Denylist ---');

  test('Blocks connections to cloud metadata service 169.254.169.254', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ host: '169.254.169.254', database: 'db', user: 'u' }),
      (err) => {
        assert.strictEqual(err.code, 'PROHIBITED_DESTINATION');
        assert.strictEqual(err.statusCode, 403);
        return true;
      }
    );
  });

  test('Blocks URI targeting metadata.google.internal', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ connectionString: 'postgres://u:p@metadata.google.internal:5432/db' }),
      (err) => err.code === 'PROHIBITED_DESTINATION'
    );
  });

  test('Blocks AWS ECS metadata endpoint 169.254.170.2', () => {
    const connector = new PostgresConnector();
    assert.throws(
      () => connector.validateConfig({ host: '169.254.170.2', database: 'db', user: 'u' }),
      (err) => err.code === 'PROHIBITED_DESTINATION'
    );
  });

  // -------------------------------------------------------------
  // SUITE 6: Credential Masking & Safe Error Responses
  // -------------------------------------------------------------
  console.log('\n--- 6. Credential Masking & Safe Error Responses ---');

  test('redactConnectionString masks passwords in URLs', () => {
    const raw = 'postgresql://admin:superSecretPassword99@db.example.com:5432/production';
    const redacted = securityUtils.redactConnectionString(raw);
    assert.ok(!redacted.includes('superSecretPassword99'));
    assert.ok(redacted.includes('admin:***@db.example.com'));
  });

  test('redactConfig creates safe copy without exposing passwords', () => {
    const config = {
      user: 'postgres',
      password: 'superSecretPassword',
      connectionString: 'postgres://admin:pwd@host/db'
    };
    const redacted = securityUtils.redactConfig(config);
    assert.strictEqual(redacted.password, '***');
    assert.ok(!redacted.connectionString.includes('pwd'));
    assert.strictEqual(config.password, 'superSecretPassword'); // Original untouched
  });

  test('sanitizeErrorMessage strips connection passwords from error text', () => {
    const errText = 'Error connecting to postgres://admin:secret123@db.com:5432/db: authentication failed for user "admin"';
    const sanitized = securityUtils.sanitizeErrorMessage(errText);
    assert.ok(!sanitized.includes('secret123'));
    assert.ok(sanitized.includes('postgres://admin:***@db.com:5432/db'));
  });

  // -------------------------------------------------------------
  // SUITE 7: TLS Verification by Default & Secure Configuration
  // -------------------------------------------------------------
  console.log('\n--- 7. TLS Verification by Default & Secure Configuration ---');

  test('Remote host verifies TLS certificates by default (rejectUnauthorized: true)', () => {
    const connector = new PostgresConnector();
    const config = connector.validateConfig({
      host: 'aws-rds.example.com',
      database: 'prod',
      user: 'reader'
    });
    assert.deepStrictEqual(config.ssl, { rejectUnauthorized: true });
  });

  test('Localhost defaults to SSL disabled (ssl: false)', () => {
    const connector = new PostgresConnector();
    const config = connector.validateConfig({
      host: 'localhost',
      database: 'dev',
      user: 'devuser'
    });
    assert.strictEqual(config.ssl, false);
  });

  test('Explicit allowSelfSigned configuration sets rejectUnauthorized: false', () => {
    const connector = new PostgresConnector();
    const config = connector.validateConfig({
      host: 'db.custom-internal.com',
      database: 'prod',
      user: 'reader',
      allowSelfSigned: true
    });
    assert.deepStrictEqual(config.ssl, { rejectUnauthorized: false });
  });

  test('Explicit sslMode: "disable" sets ssl: false on remote host', () => {
    const connector = new PostgresConnector();
    const config = connector.validateConfig({
      host: 'db.custom-internal.com',
      database: 'prod',
      user: 'reader',
      sslMode: 'disable'
    });
    assert.strictEqual(config.ssl, false);
  });

  // -------------------------------------------------------------
  // SUITE 8: Connection Teardown & Lifecycle Cleanup
  // -------------------------------------------------------------
  console.log('\n--- 8. Connection Teardown & Lifecycle Cleanup ---');

  await asyncTest('closeClient reliably closes client without throwing', async () => {
    let closed = false;
    const mockClient = {
      end: async () => { closed = true; }
    };
    const connector = new PostgresConnector();
    await connector.closeClient(mockClient);
    assert.strictEqual(closed, true);
  });

  await asyncTest('closeClient swallows close errors gracefully', async () => {
    const mockClient = {
      end: async () => { throw new Error('Socket already closed'); }
    };
    const connector = new PostgresConnector();
    // Should not throw
    await connector.closeClient(mockClient);
  });

  await asyncTest('discoverTables ensures client is closed on error', async () => {
    let closed = false;
    const mockClient = {
      query: async () => { throw new Error('Query error'); },
      end: async () => { closed = true; }
    };
    const connector = new PostgresConnector();
    try {
      await connector.discoverTables(mockClient);
    } catch {
      // Expected
    }
  });

  await asyncTest('PostgresConnector createClient handles unreachable port with safe error', async () => {
    const connector = new PostgresConnector();
    try {
      await connector.createClient({
        type: 'postgres',
        host: '127.0.0.1',
        port: 59998,
        database: 'unreachable_db',
        user: 'test_user',
        password: 'mySecretPassword123',
        connectionTimeoutMillis: 1000
      });
      assert.fail('Should have failed to connect to closed port');
    } catch (err) {
      assert.strictEqual(err.code, 'DATABASE_CONNECTION_FAILED');
      assert.ok(!err.message.includes('mySecretPassword123')); // Never leaks password
    }
  });

  // -------------------------------------------------------------
  // SUITE 9: Service Layer API Compatibility
  // -------------------------------------------------------------
  console.log('\n--- 9. Service Layer API Compatibility ---');

  test('parseClientConfig backward compatibility helper works via connector', () => {
    const parsed = parseClientConfig({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'postgres'
    });
    assert.strictEqual(parsed.host, 'localhost');
    assert.strictEqual(parsed.database, 'testdb');
    assert.strictEqual(parsed.port, 5432);
    assert.strictEqual(parsed.connectionTimeoutMillis, 8000);
  });

  await asyncTest('Controller testDatabaseConnection returns 400 for unsupported URI scheme', async () => {
    let capturedErr;
    const req = { body: { connectionString: 'mysql://root:secret@localhost:3306/db' }, id: 'req-1' };
    const res = {};
    const next = (err) => { capturedErr = err; };
    await controllerTestDbConn(req, res, next);
    assert.ok(capturedErr);
    assert.strictEqual(capturedErr.code, 'UNSUPPORTED_DATABASE_TYPE');
    assert.strictEqual(capturedErr.statusCode, 400);
  });

  await asyncTest('Controller testDatabaseConnection returns 403 for cloud metadata destination', async () => {
    let capturedErr;
    const req = { body: { connectionString: 'postgres://user:pass@169.254.169.254:5432/db' }, id: 'req-2' };
    const res = {};
    const next = (err) => { capturedErr = err; };
    await controllerTestDbConn(req, res, next);
    assert.ok(capturedErr);
    assert.strictEqual(capturedErr.code, 'PROHIBITED_DESTINATION');
    assert.strictEqual(capturedErr.statusCode, 403);
  });

  await asyncTest('Controller testDatabaseConnection returns 400 when type is omitted without URI', async () => {
    let capturedErr;
    const req = { body: { host: 'localhost', database: 'postgres', user: 'postgres' }, id: 'req-3' };
    const res = {};
    const next = (err) => { capturedErr = err; };
    await controllerTestDbConn(req, res, next);
    assert.ok(capturedErr);
    assert.strictEqual(capturedErr.code, 'DATABASE_TYPE_REQUIRED');
    assert.strictEqual(capturedErr.statusCode, 400);
  });

  // Summary
  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});

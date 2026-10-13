const { Client } = require('pg');
const BaseConnector = require('./BaseConnector');
const AppError = require('../errors/AppError');
const logger = require('../config/logger');
const {
  validateHostAndPort,
  resolveSslConfig,
  redactConfig,
  sanitizeErrorMessage
} = require('./securityUtils');

function mapPgTypeToSchemaType(pgType) {
  const type = String(pgType || '').toLowerCase();
  if (['integer', 'bigint', 'smallint', 'decimal', 'numeric', 'real', 'double precision', 'int', 'int4', 'int8', 'float4', 'float8'].some(t => type.includes(t))) {
    return 'number';
  }
  if (['boolean', 'bool'].some(t => type.includes(t))) {
    return 'boolean';
  }
  if (['date', 'timestamp', 'time'].some(t => type.includes(t))) {
    return 'date';
  }
  return 'string';
}

class PostgresConnector extends BaseConnector {
  constructor() {
    super('postgres');
  }

  /**
   * Validates and normalizes PostgreSQL connection configuration.
   * Enforces security constraints and resolves TLS settings.
   */
  validateConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
      throw new AppError('Connection configuration must be an object.', 400, 'INVALID_CONFIG');
    }

    const timeout = Number(rawConfig.connectionTimeoutMillis) || 8000;

    // 1. Connection URI mode
    if (rawConfig.connectionString) {
      const uriStr = String(rawConfig.connectionString).trim();
      let parsedUrl;
      try {
        parsedUrl = new URL(uriStr);
      } catch {
        throw new AppError('Invalid PostgreSQL connection URI.', 400, 'INVALID_CONNECTION_URI');
      }

      if (parsedUrl.protocol !== 'postgres:' && parsedUrl.protocol !== 'postgresql:') {
        throw new AppError(
          `PostgreSQL connector does not handle URI scheme "${parsedUrl.protocol.replace(':', '')}".`,
          400,
          'SCHEME_MISMATCH'
        );
      }

      const host = parsedUrl.hostname;
      const port = parsedUrl.port ? Number(parsedUrl.port) : 5432;
      validateHostAndPort(host, port);

      const isLocalhost = host === 'localhost' || host === '127.0.0.1';
      const sslmode = parsedUrl.searchParams.get('sslmode');

      const ssl = resolveSslConfig({
        isLocalhost,
        ssl: rawConfig.ssl,
        sslMode: rawConfig.sslMode || sslmode,
        allowSelfSigned: rawConfig.allowSelfSigned,
        rejectUnauthorized: rawConfig.rejectUnauthorized
      });

      return {
        connectionString: uriStr,
        connectionTimeoutMillis: timeout,
        ssl
      };
    }

    // 2. Individual fields mode
    const host = String(rawConfig.host || '').trim();
    if (!host) {
      throw new AppError('Host is required for PostgreSQL connection.', 400, 'MISSING_HOST');
    }

    const port = rawConfig.port !== undefined && rawConfig.port !== null && rawConfig.port !== ''
      ? Number(rawConfig.port)
      : 5432;

    validateHostAndPort(host, port);

    const database = String(rawConfig.database || '').trim();
    if (!database) {
      throw new AppError('Database name is required for PostgreSQL connection.', 400, 'MISSING_DATABASE');
    }

    const user = String(rawConfig.user || '').trim();
    if (!user) {
      throw new AppError('Username is required for PostgreSQL connection.', 400, 'MISSING_USER');
    }

    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    const ssl = resolveSslConfig({
      isLocalhost,
      ssl: rawConfig.ssl,
      sslMode: rawConfig.sslMode,
      allowSelfSigned: rawConfig.allowSelfSigned,
      rejectUnauthorized: rawConfig.rejectUnauthorized
    });

    return {
      host,
      port,
      database,
      user,
      password: rawConfig.password !== undefined ? String(rawConfig.password) : '',
      connectionTimeoutMillis: timeout,
      ssl
    };
  }

  /**
   * Connects to PostgreSQL using node-postgres Client with enforced timeout.
   */
  async createClient(config) {
    const clientConfig = this.validateConfig(config);
    const client = new Client(clientConfig);

    try {
      await client.connect();
      return client;
    } catch (err) {
      logger.error(
        { err: { message: sanitizeErrorMessage(err.message), code: err.code } },
        'PostgreSQL connection attempt failed'
      );
      throw new AppError(
        `Database connection failed: ${sanitizeErrorMessage(err.message)}`,
        400,
        'DATABASE_CONNECTION_FAILED'
      );
    }
  }

  /**
   * Closes connection safely.
   */
  async closeClient(client) {
    if (!client) return;
    try {
      await client.end();
    } catch (err) {
      logger.warn({ err: sanitizeErrorMessage(err.message) }, 'Error closing PostgreSQL client connection');
    }
  }

  /**
   * Tests connection and discovers available user tables.
   */
  async testConnection(config) {
    const client = await this.createClient(config);
    try {
      const tablesResult = await this.discoverTables(client);
      return {
        success: true,
        tables: tablesResult.tables
      };
    } finally {
      await this.closeClient(client);
    }
  }

  /**
   * Introspects user tables from information_schema.
   */
  async discoverTables(configOrClient) {
    let client = configOrClient;
    let shouldClose = false;

    if (!(configOrClient instanceof Client) && typeof configOrClient?.query !== 'function') {
      client = await this.createClient(configOrClient);
      shouldClose = true;
    }

    try {
      const query = `
        SELECT 
          t.table_schema, 
          t.table_name,
          (
            SELECT count(*)::int 
            FROM information_schema.columns c 
            WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
          ) as column_count
        FROM information_schema.tables t
        WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast', 'graphql', 'vault', 'auth', 'storage', 'realtime')
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_schema, t.table_name;
      `;

      const result = await client.query(query);

      return {
        tables: result.rows.map(r => ({
          schema: r.table_schema,
          name: r.table_name,
          fullName: `${r.table_schema}.${r.table_name}`,
          columnCount: r.column_count
        }))
      };
    } finally {
      if (shouldClose) {
        await this.closeClient(client);
      }
    }
  }

  /**
   * Introspects column definitions and primary key constraints for a specific table.
   */
  async introspectTableColumns(client, schema, table) {
    const colQuery = `
      SELECT 
        c.column_name, 
        c.data_type, 
        c.is_nullable,
        c.column_default,
        CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
      FROM information_schema.columns c
      LEFT JOIN (
        SELECT kcu.column_name, kcu.table_schema, kcu.table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
      ) pk ON pk.table_schema = c.table_schema 
          AND pk.table_name = c.table_name 
          AND pk.column_name = c.column_name
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position;
    `;

    const colsResult = await client.query(colQuery, [schema, table]);
    if (!colsResult.rows.length) return [];

    return colsResult.rows.map(col => ({
      name: col.column_name,
      type: mapPgTypeToSchemaType(col.data_type),
      primaryKey: Boolean(col.is_primary_key),
      notNull: col.is_nullable === 'NO',
      unique: Boolean(col.is_primary_key)
    }));
  }

  /**
   * Reads sample rows with safe limit.
   */
  async fetchSampleRows(client, schema, table, limit = 100) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 1000));
    const safeSchema = String(schema).replace(/"/g, '""');
    const safeTable = String(table).replace(/"/g, '""');

    const rowsQuery = `SELECT * FROM "${safeSchema}"."${safeTable}" LIMIT ${safeLimit};`;
    const result = await client.query(rowsQuery);
    return result.rows || [];
  }
}

module.exports = PostgresConnector;


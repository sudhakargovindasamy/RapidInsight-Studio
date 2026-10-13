const AppError = require('../errors/AppError');

/**
 * Common Connector Contract / Abstract Interface.
 *
 * Every database connector must extend this class and implement its lifecycle methods:
 * - validateConfig: Validates and sanitizes connection inputs.
 * - createClient: Instantiates and connects the underlying driver client.
 * - closeClient: Gracefully closes and releases connections.
 * - testConnection: Executes a lightweight verification query or discovery.
 * - discoverTables: Introspects accessible user tables.
 * - introspectTableColumns: Reads column definitions, data types, and primary keys.
 * - fetchSampleRows: Fetches sample data rows for schema import.
 */
class BaseConnector {
  constructor(databaseType) {
    if (!databaseType || typeof databaseType !== 'string') {
      throw new Error('BaseConnector requires a valid string databaseType');
    }
    this.databaseType = databaseType.toLowerCase().trim();
  }

  /**
   * Validates and normalizes raw connection configuration.
   * Throws AppError if required fields are missing or invalid.
   * @param {Object} rawConfig
   * @returns {Object} normalized configuration object
   */
  validateConfig(rawConfig) {
    throw new Error(`validateConfig() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Instantiates and establishes a live connection to the database.
   * Must enforce connection timeouts.
   * @param {Object} config
   * @returns {Promise<any>} Connected database client
   */
  async createClient(config) {
    throw new Error(`createClient() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Gracefully and safely closes the database connection.
   * Must handle errors internally and never reject.
   * @param {any} client
   * @returns {Promise<void>}
   */
  async closeClient(client) {
    throw new Error(`closeClient() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Tests database connectivity and returns metadata.
   * @param {Object} config
   * @returns {Promise<{ success: boolean, tables?: Array, latencyMs?: number }>}
   */
  async testConnection(config) {
    throw new Error(`testConnection() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Discovers user tables and column counts.
   * @param {Object|any} configOrClient
   * @returns {Promise<{ tables: Array<{ schema: string, name: string, fullName: string, columnCount: number }> }>}
   */
  async discoverTables(configOrClient) {
    throw new Error(`discoverTables() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Introspects table columns and primary keys.
   * @param {any} client
   * @param {string} schema
   * @param {string} table
   * @returns {Promise<Array<{ name: string, type: string, primaryKey: boolean, notNull: boolean, unique: boolean }>>}
   */
  async introspectTableColumns(client, schema, table) {
    throw new Error(`introspectTableColumns() must be implemented by ${this.constructor.name}`);
  }

  /**
   * Reads sample rows from the specified table.
   * @param {any} client
   * @param {string} schema
   * @param {string} table
   * @param {number} limit
   * @returns {Promise<Array<Object>>}
   */
  async fetchSampleRows(client, schema, table, limit = 100) {
    throw new Error(`fetchSampleRows() must be implemented by ${this.constructor.name}`);
  }
}

module.exports = BaseConnector;


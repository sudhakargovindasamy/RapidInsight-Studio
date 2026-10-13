const AppError = require('../errors/AppError');
const PostgresConnector = require('./PostgresConnector');

class ConnectorRegistry {
  constructor() {
    this.connectors = new Map();
    this.uriSchemes = new Map();
  }

  /**
   * Registers a database connector instance.
   * @param {BaseConnector} connector
   * @param {Object} options
   * @param {string[]} options.types - Alias types (e.g. ['postgres', 'postgresql'])
   * @param {string[]} options.schemes - URI protocols (e.g. ['postgres:', 'postgresql:'])
   */
  registerConnector(connector, { types = [], schemes = [] } = {}) {
    if (!connector || typeof connector.databaseType !== 'string') {
      throw new Error('Invalid connector: must be an instance of BaseConnector');
    }

    const primaryType = connector.databaseType.toLowerCase();
    this.connectors.set(primaryType, connector);

    for (const t of types) {
      this.connectors.set(t.toLowerCase().trim(), connector);
    }

    for (const s of schemes) {
      const normalizedScheme = s.endsWith(':') ? s.toLowerCase().trim() : `${s.toLowerCase().trim()}:`;
      this.uriSchemes.set(normalizedScheme, primaryType);
    }
  }

  /**
   * Retrieves a registered connector by its database type identifier.
   * @param {string} type
   * @returns {BaseConnector|null}
   */
  getConnector(type) {
    if (!type || typeof type !== 'string') return null;
    return this.connectors.get(type.toLowerCase().trim()) || null;
  }

  /**
   * Resolves the appropriate database connector from connection configuration.
   * 
   * Strict Resolution Policy:
   * 1. Detects supported database type from connection URI scheme.
   * 2. Accepts explicit database type (type / databaseType / engine) when URI is unavailable.
   * 3. Validates required connection fields.
   * 4. Returns a clear unsupported-database error when no connector is available.
   * 5. NEVER guesses a database type solely from credentials.
   *
   * @param {Object} connectionConfig
   * @returns {{ connector: BaseConnector, resolvedType: string, mode: 'uri'|'fields' }}
   */
  resolveConnector(connectionConfig) {
    if (!connectionConfig || typeof connectionConfig !== 'object') {
      throw new AppError('Connection configuration is required.', 400, 'CONNECTION_CONFIG_REQUIRED');
    }

    // 1. URI Scheme Detection
    if (connectionConfig.connectionString) {
      const uriStr = String(connectionConfig.connectionString).trim();
      let parsedUrl;
      try {
        parsedUrl = new URL(uriStr);
      } catch {
        throw new AppError('Invalid connection URI format.', 400, 'INVALID_CONNECTION_URI');
      }

      const scheme = parsedUrl.protocol.toLowerCase();
      if (!this.uriSchemes.has(scheme)) {
        const cleanScheme = scheme.replace(':', '');
        const supportedSchemes = [...new Set(this.uriSchemes.keys())]
          .map(s => s.replace(':', ''))
          .join(', ');

        throw new AppError(
          `Unsupported database URI scheme "${cleanScheme}". Supported schemes are: ${supportedSchemes}.`,
          400,
          'UNSUPPORTED_DATABASE_TYPE'
        );
      }

      const targetType = this.uriSchemes.get(scheme);
      const connector = this.connectors.get(targetType);

      return {
        connector,
        resolvedType: targetType,
        mode: 'uri'
      };
    }

    // 2. Explicit Database Type
    const explicitType = connectionConfig.type || connectionConfig.databaseType || connectionConfig.engine;
    if (explicitType !== undefined && explicitType !== null && String(explicitType).trim() !== '') {
      const normalizedType = String(explicitType).toLowerCase().trim();

      if (!this.connectors.has(normalizedType)) {
        const supportedTypes = [...new Set(this.connectors.keys())].join(', ');
        throw new AppError(
          `Database type "${normalizedType}" is not supported. Supported database types are: ${supportedTypes}.`,
          400,
          'UNSUPPORTED_DATABASE_TYPE'
        );
      }

      const connector = this.connectors.get(normalizedType);
      return {
        connector,
        resolvedType: normalizedType,
        mode: 'fields'
      };
    }

    // 3. Neither URI nor explicit type provided: NEVER guess from credentials
    const supportedTypes = [...new Set(this.connectors.keys())].join(', ');
    const hasAnyFields = Boolean(
      connectionConfig.host ||
      connectionConfig.database ||
      connectionConfig.user ||
      connectionConfig.password
    );

    if (hasAnyFields) {
      throw new AppError(
        `Database type is required when connection URI is not provided. Supported types: ${supportedTypes}.`,
        400,
        'DATABASE_TYPE_REQUIRED'
      );
    }

    throw new AppError(
      'Connection configuration is incomplete. Please provide a connection URI or specify an explicit database type and host.',
      400,
      'INVALID_CONNECTION_CONFIG'
    );
  }
}

// Create and configure default registry instance
const defaultRegistry = new ConnectorRegistry();
const postgresConnector = new PostgresConnector();

defaultRegistry.registerConnector(postgresConnector, {
  types: ['postgres', 'postgresql'],
  schemes: ['postgres:', 'postgresql:']
});

module.exports = {
  ConnectorRegistry,
  defaultRegistry,
  resolveConnector: (config) => defaultRegistry.resolveConnector(config)
};


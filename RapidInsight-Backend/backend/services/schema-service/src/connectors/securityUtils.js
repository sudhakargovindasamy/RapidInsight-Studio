const AppError = require('../errors/AppError');

/**
 * Denylist of cloud metadata endpoints, link-local addresses, and sensitive internal hostnames.
 * Connections to these destinations are prohibited to prevent SSRF (Server-Side Request Forgery).
 */
const PROHIBITED_HOST_PATTERNS = [
  /^169\.254\./,              // AWS, Azure, GCP, OpenStack link-local & metadata range (169.254.0.0/16)
  /^169\.254\.169\.254$/,     // Specific AWS/Azure/GCP metadata address
  /^169\.254\.170\.2$/,       // AWS ECS task metadata endpoint
  /^metadata\.google\.internal$/i,
  /^instance-data$/i,
  /^fd00:ec2::254$/i,         // AWS IPv6 metadata
  /^fe80::/i                  // IPv6 link-local
];

/**
 * Redacts passwords and sensitive secrets from a connection URI string.
 * e.g., postgres://user:secret@db.host.com:5432/app -> postgres://user:***@db.host.com:5432/app
 * @param {string} uri
 * @returns {string} Redacted URI string
 */
function redactConnectionString(uri) {
  if (!uri || typeof uri !== 'string') return '';
  try {
    const parsed = new URL(uri.trim());
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    // Fallback regex replacement if URI cannot be parsed by URL constructor
    return uri.replace(/(:\/\/[^:]+:)[^@]+(@)/, '$1***$2');
  }
}

/**
 * Creates a sanitized copy of a connection config object safe for logging.
 * Replaces passwords and masks connection string secrets.
 * @param {Object} config
 * @returns {Object} Sanitized copy
 */
function redactConfig(config) {
  if (!config || typeof config !== 'object') return {};
  const redacted = { ...config };

  if (redacted.password) {
    redacted.password = '***';
  }
  if (redacted.connectionString) {
    redacted.connectionString = redactConnectionString(redacted.connectionString);
  }
  return redacted;
}

/**
 * Sanitizes error messages to prevent database credentials or connection strings
 * from leaking into API responses or log streams.
 * @param {string} message
 * @returns {string} Sanitized message
 */
function sanitizeErrorMessage(message) {
  if (!message || typeof message !== 'string') return 'Database operation failed.';
  let sanitized = message;

  // Mask passwords embedded in any connection URI in the error text
  sanitized = sanitized.replace(/([a-zA-Z0-9_+.-]+:\/\/[^:]+:)[^@]+(@)/g, '$1***$2');

  // Mask password=xyz or pwd=xyz parameters
  sanitized = sanitized.replace(/(password|pwd|secret)\s*=\s*['"]?[^\s'";]+['"]?/gi, '$1=***');

  return sanitized;
}

/**
 * Validates that host and port do not target prohibited internal/metadata destinations
 * and that port falls within the legitimate range.
 * @param {string} host
 * @param {number|string} port
 */
function validateHostAndPort(host, port) {
  if (!host || typeof host !== 'string' || !host.trim()) {
    throw new AppError('Host cannot be empty.', 400, 'INVALID_HOST');
  }

  const trimmedHost = host.trim().toLowerCase();

  for (const pattern of PROHIBITED_HOST_PATTERNS) {
    if (pattern.test(trimmedHost)) {
      throw new AppError(
        'Connection to cloud metadata or prohibited internal destination is forbidden.',
        403,
        'PROHIBITED_DESTINATION'
      );
    }
  }

  if (port !== undefined && port !== null && port !== '') {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      throw new AppError('Port must be a valid integer between 1 and 65535.', 400, 'INVALID_PORT');
    }
  }
}

/**
 * Resolves TLS / SSL settings.
 * Remote connections verify certificates by default (`rejectUnauthorized: true`).
 * Explicit, secure configuration options are provided for environments with self-signed certs.
 * @param {Object} options
 * @param {boolean} options.isLocalhost
 * @param {any} options.ssl
 * @param {string} [options.sslMode]
 * @param {boolean} [options.allowSelfSigned]
 * @param {boolean} [options.rejectUnauthorized]
 * @returns {boolean|Object} SSL options object or false
 */
function resolveSslConfig({ isLocalhost, ssl, sslMode, allowSelfSigned, rejectUnauthorized }) {
  // Localhost connections default to SSL disabled unless explicitly requested
  if (isLocalhost) {
    if (ssl && typeof ssl === 'object') return ssl;
    if (ssl === true) return { rejectUnauthorized: false };
    return false;
  }

  // Explicitly disabled
  if (sslMode === 'disable' || ssl === false) {
    return false;
  }

  // Explicitly allowed self-signed certificates or disabled CA verification
  if (
    sslMode === 'allow-self-signed' ||
    sslMode === 'no-verify' ||
    allowSelfSigned === true ||
    rejectUnauthorized === false
  ) {
    return { rejectUnauthorized: false };
  }

  // Custom ssl object provided directly
  if (ssl && typeof ssl === 'object') {
    return ssl;
  }

  // Default for remote connections: verify certificates securely
  return { rejectUnauthorized: true };
}

module.exports = {
  PROHIBITED_HOST_PATTERNS,
  redactConnectionString,
  redactConfig,
  sanitizeErrorMessage,
  validateHostAndPort,
  resolveSslConfig
};


const POSTGRES_IDENTIFIER_MAX_LENGTH = 63;

function normalizeIdentifier(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const safe = normalized || 'identifier';
  const prefixed = /^[a-z_]/.test(safe) ? safe : `t_${safe}`;

  return prefixed.slice(0, POSTGRES_IDENTIFIER_MAX_LENGTH).replace(/_+$/g, '') || 'identifier';
}

function assertSafeIdentifier(identifier) {
  if (!identifier || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
}

function quoteIdentifier(identifier) {
  assertSafeIdentifier(identifier);
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualifiedIdentifier(schemaName, tableName) {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

module.exports = {
  POSTGRES_IDENTIFIER_MAX_LENGTH,
  normalizeIdentifier,
  assertSafeIdentifier,
  quoteIdentifier,
  quoteQualifiedIdentifier,
};

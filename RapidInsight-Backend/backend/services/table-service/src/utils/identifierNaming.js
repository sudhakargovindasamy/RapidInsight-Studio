const crypto = require('crypto');

const RESERVED_WORDS = new Set([
  'select',
  'insert',
  'update',
  'delete',
  'table',
  'schema',
  'user',
  'order',
  'group',
  'where',
  'from',
  'to',
  'by',
  'join',
  'create',
  'drop',
  'alter',
  'index',
  'view'
]);

function normalizeIdentifier(value) {
  let normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!normalized) normalized = 'item';
  if (/^[0-9]/.test(normalized)) normalized = `x_${normalized}`;
  if (RESERVED_WORDS.has(normalized)) normalized = `${normalized}_value`;

  return normalized.slice(0, 63);
}

function quoteIdentifier(identifier) {
  const safe = normalizeIdentifier(identifier);

  if (!/^[a-z_][a-z0-9_]*$/.test(safe)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${safe}"`;
}

function shortHash(value, length = 10) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, length);
}

function buildPhysicalTableName({ schemaId, sourceName }) {
  const base = normalizeIdentifier(sourceName || 'generated_table').slice(0, 36);
  const suffix = shortHash(schemaId, 10);
  return normalizeIdentifier(`${base}_${suffix}`);
}

module.exports = {
  normalizeIdentifier,
  quoteIdentifier,
  buildPhysicalTableName
};
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
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');

  if (!normalized) normalized = 'uploaded_table';
  if (/^[0-9]/.test(normalized)) normalized = `x_${normalized}`;
  if (RESERVED_WORDS.has(normalized)) normalized = `${normalized}_table`;

  return normalized.slice(0, 63);
}

function quoteIdentifier(identifier) {
  if (identifier === null || identifier === undefined) {
    throw new Error('Identifier cannot be null or undefined');
  }
  const str = String(identifier).trim();
  if (str.length === 0) {
    throw new Error('Identifier cannot be empty');
  }
  if (str.length > 63) {
    throw new Error(`Identifier exceeds PostgreSQL maximum length of 63 characters: "${str.slice(0, 30)}..."`);
  }
  if (str.includes('\0')) {
    throw new Error('Identifier cannot contain null byte');
  }

  // Standard PostgreSQL identifier quoting: wrap in double quotes and escape any internal double quotes by doubling them ("" -> """")
  return `"${str.replace(/"/g, '""')}"`;
}

function shortHash(value, length = 10) {
  const crypto = require('crypto');
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
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

  return normalized;
}

function truncateIdentifier(value, maxLength = 63) {
  const normalized = normalizeIdentifier(value);
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength).replace(/_+$/g, '');
}

function quoteIdentifier(identifier) {
  const safe = normalizeIdentifier(identifier);
  if (!/^[a-z_][a-z0-9_]*$/.test(safe)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${safe}"`;
}

function buildProjectSchemaName({ organisationName, projectName }) {
  const orgPart = normalizeIdentifier(organisationName).slice(0, 18);
  const projectPart = normalizeIdentifier(projectName).slice(0, 24);
  return truncateIdentifier(`${orgPart}_${projectPart}`, 63);
}

module.exports = {
  normalizeIdentifier,
  quoteIdentifier,
  buildProjectSchemaName
};
const path = require('path');
const crypto = require('crypto');
const { normalizeIdentifier, POSTGRES_IDENTIFIER_MAX_LENGTH } = require('./identifierUtils');

const RESERVED_KEYWORDS = new Set([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric', 'authorization',
  'between', 'binary', 'both', 'case', 'cast', 'check', 'collate', 'column', 'constraint',
  'create', 'cross', 'current_catalog', 'current_date', 'current_role', 'current_schema',
  'current_time', 'current_timestamp', 'current_user', 'default', 'deferrable', 'desc', 'distinct',
  'do', 'else', 'end', 'except', 'false', 'fetch', 'for', 'foreign', 'freeze', 'from', 'full',
  'grant', 'group', 'having', 'ilike', 'in', 'initially', 'inner', 'intersect', 'into', 'is',
  'isnull', 'join', 'lateral', 'leading', 'left', 'like', 'limit', 'localtime', 'localtimestamp',
  'natural', 'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order', 'outer', 'overlaps',
  'placing', 'primary', 'references', 'returning', 'right', 'select', 'session_user', 'similar',
  'some', 'symmetric', 'table', 'tablesample', 'then', 'to', 'trailing', 'true', 'union', 'unique',
  'user', 'using', 'variadic', 'verbose', 'when', 'where', 'window', 'with'
]);

function compactIdentifier(value, fallback = 'identifier') {
  const normalized = normalizeIdentifier(value || fallback);
  const reservedSafe = RESERVED_KEYWORDS.has(normalized) ? `${normalized}_table` : normalized;
  return reservedSafe.slice(0, POSTGRES_IDENTIFIER_MAX_LENGTH).replace(/_+$/g, '') || fallback;
}

function shortHash(value, length = 6) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, length);
}

function withSuffix(base, suffix) {
  const safeSuffix = normalizeIdentifier(suffix).slice(0, 12);
  const maxBaseLength = POSTGRES_IDENTIFIER_MAX_LENGTH - safeSuffix.length - 1;
  return `${base.slice(0, maxBaseLength).replace(/_+$/g, '')}_${safeSuffix}`;
}

function buildProjectSchemaName({ organisationName, projectName, organisationId, projectId }) {
  const base = compactIdentifier(`${organisationName}_${projectName}`, 'project_schema');
  const suffix = shortHash(`${organisationId || ''}:${projectId || ''}`);

  if (base.length <= POSTGRES_IDENTIFIER_MAX_LENGTH - suffix.length - 1) {
    return base;
  }

  return withSuffix(base, suffix);
}

function buildPhysicalTableName({ projectId, schemaId }) {
  const projectPart = String(projectId || '').replace(/-/g, '').slice(0, 8) || 'project';
  const schemaPart = String(schemaId || '').replace(/-/g, '').slice(0, 8) || 'schema';
  return compactIdentifier(`ris_${projectPart}_${schemaPart}`, 'ris_table');
}

function buildTableNameFromFileName(originalFileName) {
  const parsed = path.parse(String(originalFileName || ''));
  return compactIdentifier(parsed.name || originalFileName, 'uploaded_schema');
}

module.exports = {
  RESERVED_KEYWORDS,
  compactIdentifier,
  buildProjectSchemaName,
  buildPhysicalTableName,
  buildTableNameFromFileName,
};

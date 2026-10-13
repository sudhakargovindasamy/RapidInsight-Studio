const POSTGRES_IDENTIFIER_MAX_LENGTH = 63;

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

export function normalizeIdentifier(value, fallback = 'identifier') {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  const safe = normalized || fallback;
  const prefixed = /^[a-z_]/.test(safe) ? safe : `t_${safe}`;
  const reservedSafe = RESERVED_KEYWORDS.has(prefixed) ? `${prefixed}_table` : prefixed;

  return reservedSafe.slice(0, POSTGRES_IDENTIFIER_MAX_LENGTH).replace(/_+$/g, '') || fallback;
}

export function buildTableNameFromFileName(fileName) {
  const rawName = String(fileName || '')
    .split(/[\\/]/)
    .pop()
    .replace(/\.[^/.]+$/, '');

  return normalizeIdentifier(rawName, 'uploaded_schema');
}


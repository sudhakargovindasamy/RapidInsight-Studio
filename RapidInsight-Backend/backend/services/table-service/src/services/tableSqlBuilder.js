const { quoteIdentifier, normalizeIdentifier } = require('../utils/identifierNaming');

function mapFieldType(field) {
  const type = String(field.type || 'string').toLowerCase();

  switch (type) {
    case 'uuid':
      return 'uuid';
    case 'number':
      return 'numeric';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'email':
    case 'enum':
    case 'address':
    case 'string':
    default:
      return 'text';
  }
}

function getFields(schemaDefinition) {
  const fields = schemaDefinition.fields || schemaDefinition.columns || [];

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('schemaDefinition must contain fields or columns.');
  }

  return fields;
}

function buildCreateTableSql({ schemaName, tableName, schemaDefinition }) {
  const fields = getFields(schemaDefinition);

  const systemColumns = [
    `"__ris_id" uuid primary key default gen_random_uuid()`,
    `"__ris_generated_table_id" uuid not null`,
    `"__ris_created_by" uuid`,
    `"__ris_created_at" timestamptz not null default now()`
  ];

  const userColumns = fields.map((field) => {
    const columnName = quoteIdentifier(field.name);
    const sqlType = mapFieldType(field);
    const constraints = [];

    if (field.notNull || field.not_null || field.required) constraints.push('not null');
    if (field.unique) constraints.push('unique');

    return `${columnName} ${sqlType} ${constraints.join(' ')}`.trim();
  });

  return `
    create table if not exists ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} (
      ${systemColumns.concat(userColumns).join(',\n      ')}
    );
  `;
}

const NUMERIC_TYPES = new Set(['number', 'numeric', 'integer', 'decimal', 'float', 'double']);

// Mirrors schema-service's inference rule. Kept as a local copy because the
// two services share no library; the constant is the point where JavaScript
// stops representing integers exactly.
const MAX_EXACT_INTEGER_DIGITS = 15;

function isOversizedIntegerString(value) {
  if (!/^-?\d+$/.test(value)) return false;

  return value.replace('-', '').length > MAX_EXACT_INTEGER_DIGITS;
}

function sanitizeValue(value, fieldType) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const typeStr = String(fieldType || '').toLowerCase();
  if (NUMERIC_TYPES.has(typeStr)) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    const str = String(value).trim();
    if (!str) return null;

    const cleaned = str.replace(/[^0-9.-]/g, '');
    if (!cleaned || cleaned === '-' || cleaned === '.') return null;

    /*
     * Postgres numeric is arbitrary precision, but JavaScript's Number is not:
     * anything past Number.MAX_SAFE_INTEGER silently loses its low-order
     * digits. Parsing a 19-digit id here would corrupt it before Postgres ever
     * sees it, so an oversized integer is handed over as a string and left for
     * the driver to pass through intact.
     */
    if (isOversizedIntegerString(cleaned)) {
      return cleaned;
    }

    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }

  if (typeStr === 'date') {
    const str = String(value).trim();
    if (!str) return null;
    const STRICT_DATE_REGEX = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
    if (!STRICT_DATE_REGEX.test(str) || Number.isNaN(Date.parse(str))) {
      return null;
    }
    return str;
  }

  return value;
}

function normalizeRowForInsert(row, schemaDefinition) {
  const fields = getFields(schemaDefinition);
  const normalized = {};

  const rawKeyMap = {};
  if (row && typeof row === 'object') {
    Object.keys(row).forEach((key) => {
      const normalizedKey = normalizeIdentifier(key);
      if (rawKeyMap[normalizedKey] === undefined && row[key] !== undefined && row[key] !== null) {
        rawKeyMap[normalizedKey] = row[key];
      }
    });
  }

  fields.forEach((field) => {
    const columnName = normalizeIdentifier(field.name);
    const rawVal = rawKeyMap[columnName] ?? row[columnName] ?? row[field.name] ?? null;
    normalized[columnName] = sanitizeValue(rawVal, field.type);
  });

  return normalized;
}

module.exports = {
  buildCreateTableSql,
  normalizeRowForInsert,
  getFields
};
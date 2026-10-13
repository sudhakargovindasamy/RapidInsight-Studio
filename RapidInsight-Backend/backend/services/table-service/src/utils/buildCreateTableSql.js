const {
  quoteIdentifier,
  quoteQualifiedIdentifier,
  normalizeIdentifier,
} = require('./identifierUtils');

function resolveFields(schemaDefinition) {
  return schemaDefinition.fields || schemaDefinition.columns || [];
}

function mapTypeToSql(field) {
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
    case 'address':
    case 'enum':
    case 'string':
    default:
      return 'text';
  }
}

function buildColumnSql(field) {
  const columnName = normalizeIdentifier(field.name);
  const sqlType = mapTypeToSql(field);
  const parts = [quoteIdentifier(columnName), sqlType];

  if (field.primaryKey || field.primary_key) {
    parts.push('PRIMARY KEY');
  }

  if (field.notNull || field.not_null) {
    parts.push('NOT NULL');
  }

  if (field.unique) {
    parts.push('UNIQUE');
  }

  return parts.join(' ');
}

function buildEnumCheckSql(field) {
  const type = String(field.type || '').toLowerCase();

  if (type !== 'enum') {
    return null;
  }

  const values = field.options?.values || field.options || [];

  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const columnName = normalizeIdentifier(field.name);
  const safeValues = values.map((value) => `'${String(value).replace(/'/g, "''")}'`);

  return `CHECK (${quoteIdentifier(columnName)} IN (${safeValues.join(', ')}))`;
}

function buildCreateTableSql({ schemaName, tableName, schemaDefinition }) {
  const fields = resolveFields(schemaDefinition);

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Fields are required to build table.');
  }

  const systemColumns = [
    '"__ris_id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    '"__ris_generated_table_id" uuid NOT NULL',
    '"__ris_created_by" uuid NOT NULL',
    '"__ris_created_at" timestamptz NOT NULL DEFAULT now()',
  ];

  const userColumns = fields.map(buildColumnSql);
  const enumChecks = fields.map(buildEnumCheckSql).filter(Boolean);
  const allDefinitions = [...systemColumns, ...userColumns, ...enumChecks];

  const qualifiedName = schemaName
    ? quoteQualifiedIdentifier(schemaName, tableName)
    : quoteIdentifier(tableName);

  return `CREATE TABLE ${qualifiedName} (${allDefinitions.join(', ')});`;
}

module.exports = {
  buildCreateTableSql,
  resolveFields,
  mapTypeToSql,
  buildColumnSql,
};

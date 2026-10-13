const { quoteIdentifier, quoteQualifiedIdentifier, normalizeIdentifier } = require('./identifierUtils');
const { resolveFields } = require('./buildCreateTableSql');

function normalizeValue(value) {
  return value === undefined ? null : value;
}

function buildInsertSql({
  schemaName,
  tableName,
  schemaDefinition,
  rows,
  generatedTableId,
  userId,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Rows must be a non-empty array.');
  }

  const fields = resolveFields(schemaDefinition);
  const userColumns = fields.map((field) => normalizeIdentifier(field.name));
  const columns = ['__ris_generated_table_id', '__ris_created_by', ...userColumns];
  const quotedColumns = columns.map(quoteIdentifier);
  const values = [];
  const rowPlaceholders = [];

  rows.forEach((row) => {
    const placeholders = [];

    values.push(generatedTableId);
    placeholders.push(`$${values.length}`);

    values.push(userId);
    placeholders.push(`$${values.length}`);

    userColumns.forEach((columnName) => {
      values.push(normalizeValue(row[columnName]));
      placeholders.push(`$${values.length}`);
    });

    rowPlaceholders.push(`(${placeholders.join(', ')})`);
  });

  const qualifiedName = schemaName
    ? quoteQualifiedIdentifier(schemaName, tableName)
    : quoteIdentifier(tableName);

  const sql = `
    INSERT INTO ${qualifiedName}
    (${quotedColumns.join(', ')})
    VALUES ${rowPlaceholders.join(', ')}
  `;

  return { sql, values };
}

module.exports = {
  buildInsertSql,
};

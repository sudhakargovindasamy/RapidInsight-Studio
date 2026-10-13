function resolveFields(schemaDefinition) {
  return schemaDefinition.fields || schemaDefinition.columns || [];
}

function validateSchemaDefinition(schemaDefinition) {
  const fields = resolveFields(schemaDefinition);

  if (!schemaDefinition || !Array.isArray(fields) || fields.length === 0) {
    throw new Error('Valid schemaDefinition with fields/columns is required.');
  }

  return fields;
}

module.exports = {
  resolveFields,
  validateSchemaDefinition,
};

// Shared schema-compaction helpers.
//
// Both the one-shot blueprint prompt and the focused step prompts need the same
// view of an uploaded schema, so the shaping lives here instead of being copied
// per prompt. Keeping one definition means a change to what the model sees
// applies to every step at once.

function resolveSchemaDefinition(schema) {
  return schema?.schemaDefinition || schema?.schema_definition || {};
}

function resolveSchemaFields(schema) {
  const definition = resolveSchemaDefinition(schema);

  if (Array.isArray(definition.fields)) return definition.fields;
  if (Array.isArray(definition.columns)) return definition.columns;
  if (Array.isArray(schema?.fields)) return schema.fields;
  if (Array.isArray(schema?.columns)) return schema.columns;

  return [];
}

function resolveSchemaId(schema) {
  return schema?.schema_id || schema?.id || null;
}

function resolveTableName(schema) {
  const definition = resolveSchemaDefinition(schema);

  return (
    schema?.sanitized_table_name ||
    schema?.table_name ||
    definition?.name ||
    schema?.original_file_name ||
    `schema_${resolveSchemaId(schema) || "unknown"}`
  );
}

function compactField(field) {
  return {
    name: String(field?.name || "").trim(),
    type: String(field?.type || "string").trim().toLowerCase(),
    primaryKey: field?.primaryKey === true || field?.primary_key === true,
    notNull: field?.notNull === true || field?.not_null === true,
    unique: field?.unique === true,
  };
}

function compactSchema(schema) {
  return {
    schema_id: resolveSchemaId(schema),
    table_name: resolveTableName(schema),
    fields: resolveSchemaFields(schema)
      .map(compactField)
      .filter((field) => field.name),
  };
}

function compactSchemas(schemas = []) {
  if (!Array.isArray(schemas)) return [];

  return schemas
    .map(compactSchema)
    .filter(
      (schema) =>
        schema.schema_id &&
        schema.table_name &&
        schema.fields.length > 0
    );
}

module.exports = {
  resolveSchemaDefinition,
  resolveSchemaFields,
  resolveSchemaId,
  resolveTableName,
  compactField,
  compactSchema,
  compactSchemas,
};

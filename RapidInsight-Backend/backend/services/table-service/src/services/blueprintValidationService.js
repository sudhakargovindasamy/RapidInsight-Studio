const {
  normalizeIdentifier
} = require('../utils/identifierUtils');

const ALLOWED_TABLE_TYPES = new Set(['fact', 'dimension', 'bridge', 'reference']);
const ALLOWED_RELATIONSHIP_TYPES = new Set(['one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']);

const ALLOWED_GENERATION_STRATEGIES = new Set([
  'uuid',
  'incremental',
  'student_id',
  'course_id',
  'professor_id',
  'department_id',
  'semester_id',
  'hostel_id',
  'enrollment_id',
  'integer_range',
  'number_range',
  'enum',
  'boolean',
  'email',
  'full_name',
  'name',
  'first_name',
  'last_name',
  'phone',
  'city',
  'country',
  'address',
  'sentence',
  'words',
  'date_between'
]);

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = 422;
    throw error;
  }
}

function getFields(schemaDefinition) {
  return schemaDefinition.fields || schemaDefinition.columns || [];
}

function normalizeName(value) {
  return normalizeIdentifier(value);
}

function buildSchemaMaps(schemaBundles) {
  const schemaById = new Map();
  const fieldsBySchemaId = new Map();

  schemaBundles.forEach((bundle) => {
    const schemaId = bundle.schema.id;
    const fields = getFields(bundle.schemaDefinition);
    const fieldNames = new Set(fields.map((field) => normalizeName(field.name)));

    schemaById.set(schemaId, bundle);
    fieldsBySchemaId.set(schemaId, fieldNames);
  });

  return {
    schemaById,
    fieldsBySchemaId
  };
}

function detectCycle(tableNames, relationships) {
  const graph = new Map();

  tableNames.forEach((tableName) => {
    graph.set(tableName, []);
  });

  relationships.forEach((relationship) => {
    const child = normalizeName(relationship.from_table);
    const parent = normalizeName(relationship.to_table);

    if (graph.has(parent)) {
      graph.get(parent).push(child);
    }
  });

  const visiting = new Set();
  const visited = new Set();

  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;

    visiting.add(node);

    const neighbours = graph.get(node) || [];

    for (const neighbour of neighbours) {
      if (dfs(neighbour)) return true;
    }

    visiting.delete(node);
    visited.add(node);

    return false;
  }

  for (const tableName of tableNames) {
    if (dfs(tableName)) return true;
  }

  return false;
}

function validateGenerationRule(column) {
  const generation = column.generation || {};

  if (!generation.strategy) return;

  assert(
    ALLOWED_GENERATION_STRATEGIES.has(String(generation.strategy).toLowerCase()),
    `Unknown generation strategy "${generation.strategy}" for column "${column.name}".`
  );

  if (generation.min !== undefined && generation.max !== undefined) {
    if (String(generation.strategy).toLowerCase() === 'date_between') {
      let minDate = Date.parse(generation.min);
      let maxDate = Date.parse(generation.max);
      if (!Number.isNaN(minDate) && !Number.isNaN(maxDate)) {
        if (minDate > maxDate) {
          const temp = generation.min;
          generation.min = generation.max;
          generation.max = temp;
        }
      }
    } else {
      let min = Number(generation.min);
      let max = Number(generation.max);

      assert(Number.isFinite(min), `Invalid generation min for column "${column.name}".`);
      assert(Number.isFinite(max), `Invalid generation max for column "${column.name}".`);
      if (min > max) {
        const temp = generation.min;
        generation.min = generation.max;
        generation.max = temp;
      }
    }
  }

  if (generation.values !== undefined) {
    if (!Array.isArray(generation.values)) {
      delete generation.values;
    }
  }
}

function validateBlueprintAgainstSchemas({
  blueprint,
  schemaBundles
}) {
  assert(blueprint && typeof blueprint === 'object', 'Blueprint must be an object.');

  if (!blueprint.tables) blueprint.tables = [];
  if (!blueprint.relationships) blueprint.relationships = [];
  if (!blueprint.dependency_order) blueprint.dependency_order = [];

  assert(Array.isArray(blueprint.tables), 'Blueprint tables must be an array.');
  assert(Array.isArray(blueprint.relationships), 'Blueprint relationships must be an array.');
  assert(Array.isArray(blueprint.dependency_order), 'Blueprint dependency_order must be an array.');

  const {
    fieldsBySchemaId
  } = buildSchemaMaps(schemaBundles);

  const uploadedSchemaIds = new Set(schemaBundles.map((bundle) => bundle.schema.id));
  const returnedSchemaIds = new Set();
  const tableByName = new Map();
  const tableNames = [];

  // Auto-correct AI hallucination: if the LLM forgot some schemas in a huge payload, append defaults
  const returnedSchemaIdsRaw = new Set((blueprint.tables || []).map((t) => t.schema_id).filter(Boolean));
  uploadedSchemaIds.forEach((schemaId) => {
    if (!returnedSchemaIdsRaw.has(schemaId)) {
      const bundle = schemaBundles.find((b) => b.schema.id === schemaId);
      const tableName = bundle.schema.sanitized_table_name || bundle.schema.display_name || bundle.schema.original_file_name.replace('.json', '');
      const fields = bundle.schemaDefinition.fields || bundle.schemaDefinition.columns || [];
      const primaryKeyField = fields.find((f) => f.primary_key || f.primaryKey) || fields[0];

      const missingTable = {
        schema_id: schemaId,
        table_name: tableName,
        table_type: 'fact',
        primary_key: primaryKeyField ? primaryKeyField.name : 'id',
        unique_keys: [],
        columns: fields.map((f) => {
          const isPk = f.primary_key || f.primaryKey;
          let pkStrategy = 'uuid';
          if (f.type && (f.type.toLowerCase().includes('number') || f.type.toLowerCase().includes('int') || f.type.toLowerCase().includes('serial'))) {
            pkStrategy = 'incremental';
          }
          return {
            name: f.name,
            role: isPk ? 'primary_key' : 'dimension',
            type: f.type || 'string',
            generation: isPk ? { strategy: pkStrategy } : {}
          };
        })
      };

      blueprint.tables.push(missingTable);
      if (!blueprint.dependency_order) blueprint.dependency_order = [];
      blueprint.dependency_order.push(tableName);
    }
  });

  blueprint.tables.forEach((table) => {
    const tableName = normalizeName(table.table_name);

    assert(table.schema_id, `schema_id is required for table "${table.table_name}".`);
    assert(uploadedSchemaIds.has(table.schema_id), `Unknown schema_id "${table.schema_id}".`);
    assert(!tableByName.has(tableName), `Duplicate table name "${table.table_name}".`);
    assert(ALLOWED_TABLE_TYPES.has(table.table_type), `Invalid table_type for "${table.table_name}".`);
    assert(table.primary_key, `Primary key is required for "${table.table_name}".`);

    returnedSchemaIds.add(table.schema_id);
    tableByName.set(tableName, table);
    tableNames.push(tableName);

    const fieldNames = fieldsBySchemaId.get(table.schema_id);
    const primaryKey = normalizeName(table.primary_key);

    assert(fieldNames.has(primaryKey), `Primary key "${table.primary_key}" not found in schema "${table.table_name}".`);

    (table.unique_keys || []).forEach((uniqueKey) => {
      assert(
        fieldNames.has(normalizeName(uniqueKey)),
        `Unique key "${uniqueKey}" not found in schema "${table.table_name}".`
      );
    });

    (table.columns || []).forEach((column) => {
      const columnName = normalizeName(column.name);

      assert(
        fieldNames.has(columnName),
        `Column "${column.name}" not found in uploaded schema for table "${table.table_name}".`
      );

      // Force UUID or Incremental strategy for Primary Keys to prevent collisions
      if (column.role === 'primary_key' || columnName === primaryKey) {
        if (!column.generation) column.generation = {};
        const strategy = String(column.generation.strategy || '').toLowerCase();

        if (strategy !== 'uuid' && strategy !== 'incremental') {
          const type = String(column.type || '').toLowerCase();
          if (type.includes('int') || type.includes('number') || type.includes('serial')) {
            column.generation.strategy = 'incremental';
          } else {
            column.generation.strategy = 'uuid';
          }
        }
      }

      validateGenerationRule(column);
    });
  });

  uploadedSchemaIds.forEach((schemaId) => {
    assert(returnedSchemaIds.has(schemaId), `Blueprint missing uploaded schema_id "${schemaId}".`);
  });

  blueprint.relationships.forEach((relationship) => {
    const fromTable = normalizeName(relationship.from_table);
    const toTable = normalizeName(relationship.to_table);
    const fromColumn = normalizeName(relationship.from_column);
    const toColumn = normalizeName(relationship.to_column);

    assert(tableByName.has(fromTable), `Relationship from_table "${relationship.from_table}" does not exist.`);
    assert(tableByName.has(toTable), `Relationship to_table "${relationship.to_table}" does not exist.`);
    assert(ALLOWED_RELATIONSHIP_TYPES.has(relationship.relationship_type), `Invalid relationship_type "${relationship.relationship_type}".`);

    const fromTableBlueprint = tableByName.get(fromTable);
    const toTableBlueprint = tableByName.get(toTable);

    const fromFields = fieldsBySchemaId.get(fromTableBlueprint.schema_id);
    const toFields = fieldsBySchemaId.get(toTableBlueprint.schema_id);

    assert(fromFields.has(fromColumn), `Relationship source column "${relationship.from_column}" does not exist.`);
    assert(toFields.has(toColumn), `Relationship target column "${relationship.to_column}" does not exist.`);
  });

  assert(!detectCycle(tableNames, blueprint.relationships), 'Invalid circular dependency found in relationships.');

  // Automatically correct AI's dependency_order hallucination using Kahn's algorithm
  const graph = new Map();
  const inDegree = new Map();

  tableNames.forEach((tableName) => {
    graph.set(tableName, []);
    inDegree.set(tableName, 0);
  });

  blueprint.relationships.forEach((relationship) => {
    const child = normalizeName(relationship.from_table);
    const parent = normalizeName(relationship.to_table);

    if (graph.has(parent) && inDegree.has(child)) {
      graph.get(parent).push(child);
      inDegree.set(child, inDegree.get(child) + 1);
    }
  });

  const queue = [];
  inDegree.forEach((degree, tableName) => {
    if (degree === 0) queue.push(tableName);
  });

  const autoDependencyOrder = [];
  while (queue.length > 0) {
    const node = queue.shift();
    autoDependencyOrder.push(node);
    const neighbours = graph.get(node) || [];
    for (const neighbour of neighbours) {
      inDegree.set(neighbour, inDegree.get(neighbour) - 1);
      if (inDegree.get(neighbour) === 0) {
        queue.push(neighbour);
      }
    }
  }

  blueprint.dependency_order = autoDependencyOrder;

  return true;
}

module.exports = {
  validateBlueprintAgainstSchemas
};

const VALID_TABLE_TYPES = new Set([
  "fact",
  "dimension",
  "bridge",
  "reference",
]);

const VALID_RELATIONSHIP_TYPES = new Set([
  "one_to_one",
  "one_to_many",
  "many_to_one",
  "many_to_many",
]);

const VALID_PRIMARY_KEY_SOURCES = new Set([
  "supplied",
  "inferred",
]);

const VALID_REQUEST_STATUSES = new Set([
  "executable",
  "needs_clarification",
  "unsupported",
]);

const VALID_ANALYSIS_TYPES = new Set([
  "ranking",
  "trend",
  "comparison",
  "distribution",
  "aggregation",
]);

const VALID_OPERATIONS = new Set([
  "count",
  "sum",
  "avg",
  "min",
  "max",
]);

// Kept in step with the prompt, which forbids scatter, and with the frontend,
// which registers no scatter renderer. Accepting a type nothing can draw only
// moves the failure to render time.
const VALID_CHART_TYPES = new Set([
  "bar",
  "line",
  "pie",
  "doughnut",
]);

const VALID_FORMATS = new Set([
  "number",
  "decimal",
  "currency",
  "percentage",
]);

const VALID_SORT_DIRECTIONS = new Set([
  "asc",
  "desc",
]);

const VALID_TIME_BUCKETS = new Set([
  "day",
  "month",
  "year",
]);

const VALID_FILTER_OPERATORS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "between",
  "contains",
  "starts_with",
  "ends_with",
  "is_null",
  "is_not_null",
]);

const NUMERIC_TYPE_FAMILIES = new Set([
  "number",
  "numeric",
  "decimal",
  "float",
  "double",
  "real",
  "int",
  "integer",
  "tinyint",
  "smallint",
  "mediumint",
  "bigint",
  "serial",
  "smallserial",
  "bigserial",
  "money",
]);

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = 422;
    throw error;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeType(value) {
  return String(value || "string")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getTypeFamily(value) {
  const type = normalizeType(value);

  if (/^(varchar|character varying|char|character|string|text)/.test(type)) {
    return "string";
  }

  if (/^(bool|boolean)/.test(type)) {
    return "boolean";
  }

  if (/^(date|datetime|timestamp|timestamptz|time)/.test(type)) {
    return "date";
  }

  if (/^(uuid)/.test(type)) {
    return "uuid";
  }

  for (const numericType of NUMERIC_TYPE_FAMILIES) {
    if (type === numericType || type.startsWith(`${numericType}(`)) {
      return "numeric";
    }
  }

  if (/^(int2|int4|int8|float4|float8|double precision)/.test(type)) {
    return "numeric";
  }

  return type;
}

function isNumericType(value) {
  return getTypeFamily(value) === "numeric";
}

function isDateType(value) {
  return getTypeFamily(value) === "date";
}

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
  return String(schema?.schema_id || schema?.id || "").trim();
}

function resolveTableName(schema) {
  const definition = resolveSchemaDefinition(schema);

  return String(
    schema?.sanitized_table_name ||
    schema?.table_name ||
    definition?.name ||
    schema?.original_file_name ||
    ""
  ).trim();
}

function isExplicitPrimaryKey(field) {
  return field?.primaryKey === true || field?.primary_key === true;
}

function isExplicitUnique(field) {
  return field?.unique === true;
}

function buildSourceSchemaMaps(schemas) {
  assert(
    Array.isArray(schemas) && schemas.length > 0,
    "Original uploaded schemas are required for blueprint validation."
  );

  const bySchemaId = new Map();
  const byTableName = new Map();

  schemas.forEach((schema, index) => {
    const path = `schemas[${index}]`;
    const schemaId = resolveSchemaId(schema);
    const tableName = resolveTableName(schema);
    const fields = resolveSchemaFields(schema);

    assert(nonEmptyString(schemaId), `${path} is missing schema_id.`);
    assert(nonEmptyString(tableName), `${path} is missing table_name.`);
    assert(fields.length > 0, `${path} has no fields.`);
    assert(!bySchemaId.has(schemaId), `${path}.schema_id "${schemaId}" is duplicated.`);

    const columns = new Map();
    const explicitPrimaryKeys = new Set();
    const explicitUniqueKeys = new Set();

    fields.forEach((field, fieldIndex) => {
      const fieldPath = `${path}.fields[${fieldIndex}]`;
      const fieldName = String(field?.name || "").trim();
      const normalizedFieldName = normalizeName(fieldName);

      assert(nonEmptyString(fieldName), `${fieldPath}.name is required.`);
      assert(
        !columns.has(normalizedFieldName),
        `${fieldPath}.name "${fieldName}" is duplicated.`
      );

      columns.set(normalizedFieldName, {
        name: fieldName,
        type: normalizeType(field?.type),
        primaryKey: isExplicitPrimaryKey(field),
        unique: isExplicitUnique(field),
        notNull: field?.notNull === true || field?.not_null === true,
      });

      if (isExplicitPrimaryKey(field)) explicitPrimaryKeys.add(normalizedFieldName);
      if (isExplicitUnique(field)) explicitUniqueKeys.add(normalizedFieldName);
    });

    assert(
      explicitPrimaryKeys.size <= 1,
      `${path} contains multiple explicitly supplied primary keys, but the compact contract supports one primary_key.`
    );

    const sourceTable = {
      schemaId,
      tableName,
      normalizedTableName: normalizeName(tableName),
      columns,
      explicitPrimaryKeys,
      explicitUniqueKeys,
    };

    assert(
      !byTableName.has(sourceTable.normalizedTableName),
      `Uploaded table name "${tableName}" is duplicated.`
    );

    bySchemaId.set(schemaId, sourceTable);
    byTableName.set(sourceTable.normalizedTableName, sourceTable);
  });

  return { bySchemaId, byTableName };
}

function assertExactProperties(object, allowedProperties, path) {
  Object.keys(object).forEach((property) => {
    assert(
      allowedProperties.has(property),
      `${path}.${property} is not allowed.`
    );
  });
}

function assertArrayOfExistingColumns({ values, sourceTable, path }) {
  assert(Array.isArray(values), `${path} must be an array.`);

  const seen = new Set();

  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    const normalizedValue = normalizeName(value);

    assert(nonEmptyString(value), `${itemPath} must be a non-empty string.`);
    assert(
      sourceTable.columns.has(normalizedValue),
      `${itemPath} "${value}" does not exist in uploaded schema "${sourceTable.tableName}".`
    );
    assert(!seen.has(normalizedValue), `${itemPath} "${value}" is duplicated.`);

    seen.add(normalizedValue);
  });

  return seen;
}

function validateTables(blueprintTables, sourceMaps) {
  assert(Array.isArray(blueprintTables), "blueprint.tables must be an array.");
  assert(
    blueprintTables.length === sourceMaps.bySchemaId.size,
    "blueprint.tables must contain exactly one compact key definition per uploaded schema."
  );

  const allowedProperties = new Set([
    "schema_id",
    "table_name",
    "table_type",
    "primary_key",
    "primary_key_source",
    "unique_keys",
    "foreign_keys",
  ]);

  const returnedSchemaIds = new Set();
  const returnedTableNames = new Set();
  const blueprintTableMap = new Map();

  blueprintTables.forEach((table, index) => {
    const path = `blueprint.tables[${index}]`;

    assert(isObject(table), `${path} must be an object.`);
    assertExactProperties(table, allowedProperties, path);
    assert(table.columns === undefined, `${path}.columns must not be returned.`);
    assert(nonEmptyString(table.schema_id), `${path}.schema_id is required.`);
    assert(nonEmptyString(table.table_name), `${path}.table_name is required.`);
    assert(VALID_TABLE_TYPES.has(table.table_type), `${path}.table_type is invalid.`);
    assert(nonEmptyString(table.primary_key), `${path}.primary_key is required.`);
    assert(
      VALID_PRIMARY_KEY_SOURCES.has(table.primary_key_source),
      `${path}.primary_key_source must be supplied or inferred.`
    );
    assert(
      !returnedSchemaIds.has(table.schema_id),
      `${path}.schema_id "${table.schema_id}" is duplicated.`
    );

    const normalizedTableName = normalizeName(table.table_name);

    assert(
      !returnedTableNames.has(normalizedTableName),
      `${path}.table_name "${table.table_name}" is duplicated.`
    );

    const sourceTable = sourceMaps.bySchemaId.get(table.schema_id);

    assert(
      sourceTable,
      `${path}.schema_id "${table.schema_id}" is not an uploaded schema.`
    );
    assert(
      sourceTable.normalizedTableName === normalizedTableName,
      `${path}.table_name must exactly match uploaded table name "${sourceTable.tableName}".`
    );
    assert(
      sourceTable.tableName === table.table_name,
      `${path}.table_name must preserve the supplied spelling and case exactly.`
    );

    const normalizedPrimaryKey = normalizeName(table.primary_key);
    const sourcePrimaryKeyColumn = sourceTable.columns.get(normalizedPrimaryKey);

    assert(
      sourcePrimaryKeyColumn,
      `${path}.primary_key "${table.primary_key}" does not exist in uploaded schema "${sourceTable.tableName}".`
    );
    assert(
      sourcePrimaryKeyColumn.name === table.primary_key,
      `${path}.primary_key must preserve the supplied column name exactly.`
    );

    if (sourceTable.explicitPrimaryKeys.size === 1) {
      const [explicitPrimaryKey] = sourceTable.explicitPrimaryKeys;

      assert(
        table.primary_key_source === "supplied",
        `${path}.primary_key_source must be supplied because the uploaded schema defines a primary key.`
      );
      assert(
        explicitPrimaryKey === normalizedPrimaryKey,
        `${path}.primary_key must use the explicitly supplied primary key.`
      );
    } else {
      assert(
        table.primary_key_source === "inferred",
        `${path}.primary_key_source must be inferred because the uploaded schema does not define a primary key.`
      );
    }

    const uniqueKeys = assertArrayOfExistingColumns({
      values: table.unique_keys,
      sourceTable,
      path: `${path}.unique_keys`,
    });

    assert(
      !uniqueKeys.has(normalizedPrimaryKey),
      `${path}.unique_keys must not duplicate primary_key.`
    );

    sourceTable.explicitUniqueKeys.forEach((explicitUniqueKey) => {
      if (explicitUniqueKey !== normalizedPrimaryKey) {
        assert(
          uniqueKeys.has(explicitUniqueKey),
          `${path}.unique_keys must include explicitly supplied unique column "${sourceTable.columns.get(explicitUniqueKey).name}".`
        );
      }
    });

    const foreignKeys = assertArrayOfExistingColumns({
      values: table.foreign_keys,
      sourceTable,
      path: `${path}.foreign_keys`,
    });

    assert(
      !foreignKeys.has(normalizedPrimaryKey),
      `${path}.foreign_keys must not contain primary_key.`
    );

    returnedSchemaIds.add(table.schema_id);
    returnedTableNames.add(normalizedTableName);
    blueprintTableMap.set(normalizedTableName, {
      table,
      sourceTable,
      primaryKey: normalizedPrimaryKey,
      uniqueKeys,
      foreignKeys,
    });
  });

  sourceMaps.bySchemaId.forEach((sourceTable, schemaId) => {
    assert(
      returnedSchemaIds.has(schemaId),
      `Blueprint is missing compact key metadata for uploaded table "${sourceTable.tableName}".`
    );
  });

  return blueprintTableMap;
}

function relationshipKey(relationship) {
  return [
    normalizeName(relationship.from_table),
    normalizeName(relationship.from_column),
    normalizeName(relationship.to_table),
    normalizeName(relationship.to_column),
  ].join("::");
}

function reverseRelationshipKey(relationship) {
  return [
    normalizeName(relationship.to_table),
    normalizeName(relationship.to_column),
    normalizeName(relationship.from_table),
    normalizeName(relationship.from_column),
  ].join("::");
}

function validateRelationshipShape(relationship, path) {
  const allowedProperties = new Set([
    "from_table",
    "from_column",
    "to_table",
    "to_column",
    "relationship_type",
  ]);

  assert(isObject(relationship), `${path} must be an object.`);
  assertExactProperties(relationship, allowedProperties, path);

  allowedProperties.forEach((property) => {
    assert(nonEmptyString(relationship[property]), `${path}.${property} is required.`);
  });
}

function validateRelationships(relationships, blueprintTableMap) {
  assert(Array.isArray(relationships), "blueprint.relationships must be an array.");

  const relationshipKeys = new Set();
  const usedForeignKeys = new Map();

  relationships.forEach((relationship, index) => {
    const path = `blueprint.relationships[${index}]`;

    validateRelationshipShape(relationship, path);
    assert(
      VALID_RELATIONSHIP_TYPES.has(relationship.relationship_type),
      `${path}.relationship_type is invalid.`
    );

    const fromTableName = normalizeName(relationship.from_table);
    const toTableName = normalizeName(relationship.to_table);
    const fromColumnName = normalizeName(relationship.from_column);
    const toColumnName = normalizeName(relationship.to_column);
    const fromTable = blueprintTableMap.get(fromTableName);
    const toTable = blueprintTableMap.get(toTableName);

    assert(fromTable, `${path}.from_table "${relationship.from_table}" is unknown.`);
    assert(toTable, `${path}.to_table "${relationship.to_table}" is unknown.`);
    assert(
      fromTable.table.table_name === relationship.from_table,
      `${path}.from_table must preserve the supplied table name exactly.`
    );
    assert(
      toTable.table.table_name === relationship.to_table,
      `${path}.to_table must preserve the supplied table name exactly.`
    );

    const fromColumn = fromTable.sourceTable.columns.get(fromColumnName);
    const toColumn = toTable.sourceTable.columns.get(toColumnName);

    assert(
      fromColumn,
      `${path}.from_column "${relationship.from_column}" does not exist in uploaded schema "${fromTable.sourceTable.tableName}".`
    );
    assert(
      toColumn,
      `${path}.to_column "${relationship.to_column}" does not exist in uploaded schema "${toTable.sourceTable.tableName}".`
    );
    assert(
      fromColumn.name === relationship.from_column,
      `${path}.from_column must preserve the supplied column name exactly.`
    );
    assert(
      toColumn.name === relationship.to_column,
      `${path}.to_column must preserve the supplied column name exactly.`
    );
    assert(
      fromTable.foreignKeys.has(fromColumnName),
      `${path}.from_column must be listed in "${fromTable.table.table_name}".foreign_keys.`
    );
    if (!(toTable.primaryKey === toColumnName || toTable.uniqueKeys.has(toColumnName))) {
      const validTargets = [toTable.primaryKey, ...toTable.uniqueKeys]
        .map((key) => toTable.sourceTable.columns.get(key)?.name)
        .filter(Boolean)
        .join(", ");

      // Name the acceptable targets so the repair attempt is actionable.
      assert(
        false,
        `${path}.to_column "${relationship.to_column}" must reference "${toTable.table.table_name}".primary_key or one of its unique_keys (currently: ${validTargets}). Either point to_column at one of those columns, or add "${relationship.to_column}" to "${toTable.table.table_name}".unique_keys if it is genuinely unique, or remove this relationship together with its foreign_keys entry.`
      );
    }
    assert(
      getTypeFamily(fromColumn.type) === getTypeFamily(toColumn.type),
      `${path} joins incompatible types "${fromColumn.type}" and "${toColumn.type}".`
    );

    const directKey = relationshipKey(relationship);
    const reverseKey = reverseRelationshipKey(relationship);

    assert(!relationshipKeys.has(directKey), `${path} duplicates a relationship.`);
    assert(!relationshipKeys.has(reverseKey), `${path} reverses an existing relationship.`);

    relationshipKeys.add(directKey);

    if (!usedForeignKeys.has(fromTableName)) {
      usedForeignKeys.set(fromTableName, new Set());
    }
    usedForeignKeys.get(fromTableName).add(fromColumnName);
  });

  blueprintTableMap.forEach((tableMetadata, tableName) => {
    const used = usedForeignKeys.get(tableName) || new Set();

    tableMetadata.foreignKeys.forEach((foreignKey) => {
      assert(
        used.has(foreignKey),
        `Foreign key "${tableMetadata.table.table_name}.${tableMetadata.sourceTable.columns.get(foreignKey).name}" is not used by any relationship.`
      );
    });
  });

  return relationshipKeys;
}

// Table pairs reachable within MAX_JOIN_HOPS, in both directions.
//
// A single hop only connects a fact table to a dimension it points at
// directly, which rejects ordinary star-schema questions like "revenue by
// product category" whenever category lives one table past the product
// dimension.
//
// This is pinned to 1 until table-service can execute deeper paths:
// analyticsQueryBuilder emits a single hardcoded LEFT JOIN, so accepting a
// two-hop plan here would only move the rejection downstream, after the
// physical tables have already been built. Raise this and
// MAX_FOREIGN_TABLES_PER_ITEM together with the query builder, not before.
const MAX_JOIN_HOPS = 1;

function buildTableConnectivity(relationships, maxHops = MAX_JOIN_HOPS) {
  const adjacency = new Map();

  const link = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    adjacency.get(from).add(to);
  };

  (Array.isArray(relationships) ? relationships : []).forEach((relationship) => {
    const fromTableName = normalizeName(relationship?.from_table);
    const toTableName = normalizeName(relationship?.to_table);

    if (!fromTableName || !toTableName) return;

    link(fromTableName, toTableName);
    link(toTableName, fromTableName);
  });

  // Breadth-first from every table, stopping at maxHops, so the resulting set
  // answers "can these two tables be joined" in one lookup.
  const connectedPairs = new Set();

  adjacency.forEach((_neighbours, origin) => {
    const visited = new Set([origin]);
    let frontier = [origin];

    for (let hop = 0; hop < maxHops; hop += 1) {
      const nextFrontier = [];

      frontier.forEach((tableName) => {
        (adjacency.get(tableName) || new Set()).forEach((neighbour) => {
          if (visited.has(neighbour)) return;

          visited.add(neighbour);
          nextFrontier.push(neighbour);
          connectedPairs.add(`${origin}::${neighbour}`);
        });
      });

      if (nextFrontier.length === 0) break;

      frontier = nextFrontier;
    }
  });

  return connectedPairs;
}

function getSourceColumn(blueprintTableMap, tableName, columnName, path) {
  assert(nonEmptyString(tableName), `${path}.table is required.`);
  assert(nonEmptyString(columnName), `${path}.column is required.`);

  const tableMetadata = blueprintTableMap.get(normalizeName(tableName));

  assert(tableMetadata, `${path}.table "${tableName}" is unknown.`);
  assert(
    tableMetadata.table.table_name === tableName,
    `${path}.table must preserve the supplied table name exactly.`
  );

  const column = tableMetadata.sourceTable.columns.get(normalizeName(columnName));

  assert(
    column,
    `${path}.column "${columnName}" does not exist in uploaded schema "${tableName}".`
  );
  assert(
    column.name === columnName,
    `${path}.column must preserve the supplied column name exactly.`
  );

  return column;
}

function validateFilters(filters, blueprintTableMap, path) {
  assert(Array.isArray(filters), `${path} must be an array.`);

  filters.forEach((filter, index) => {
    const filterPath = `${path}[${index}]`;
    const allowedProperties = new Set(["table", "column", "operator", "value"]);

    assert(isObject(filter), `${filterPath} must be an object.`);
    assertExactProperties(filter, allowedProperties, filterPath);
    getSourceColumn(blueprintTableMap, filter.table, filter.column, filterPath);
    assert(
      VALID_FILTER_OPERATORS.has(filter.operator),
      `${filterPath}.operator is invalid.`
    );

    if (["is_null", "is_not_null"].includes(filter.operator)) {
      assert(filter.value === null, `${filterPath}.value must be null.`);
    }

    if (["in", "not_in"].includes(filter.operator)) {
      assert(Array.isArray(filter.value), `${filterPath}.value must be an array.`);
    }

    if (filter.operator === "between") {
      assert(
        Array.isArray(filter.value) && filter.value.length === 2,
        `${filterPath}.value must contain exactly two values.`
      );
    }
  });
}

function validateQueryIntent(queryIntent, path) {
  const allowedProperties = new Set([
    "business_goal",
    "analysis_type",
    "aggregation_required",
    "dimension_required",
    "time_based",
  ]);

  assert(isObject(queryIntent), `${path} must be an object.`);
  assertExactProperties(queryIntent, allowedProperties, path);
  assert(nonEmptyString(queryIntent.business_goal), `${path}.business_goal is required.`);
  assert(
    VALID_ANALYSIS_TYPES.has(queryIntent.analysis_type),
    `${path}.analysis_type is invalid.`
  );
  assert(typeof queryIntent.aggregation_required === "boolean", `${path}.aggregation_required must be boolean.`);
  assert(typeof queryIntent.dimension_required === "boolean", `${path}.dimension_required must be boolean.`);
  assert(typeof queryIntent.time_based === "boolean", `${path}.time_based must be boolean.`);
}

function validateDashboardRecommendation(recommendation, blueprintTableMap, path) {
  assert(isObject(recommendation), `${path} must be an object.`);
  assert(
    blueprintTableMap.has(normalizeName(recommendation.base_table)),
    `${path}.base_table is unknown.`
  );

  assert(isObject(recommendation.measure), `${path}.measure must be an object.`);
  assert(
    VALID_OPERATIONS.has(recommendation.measure.operation),
    `${path}.measure.operation is invalid.`
  );

  if (!(recommendation.measure.operation === "count" && recommendation.measure.column == null)) {
    const measureColumn = getSourceColumn(
      blueprintTableMap,
      recommendation.measure.table,
      recommendation.measure.column,
      `${path}.measure`
    );

    if (recommendation.measure.operation !== "count") {
      assert(
        isNumericType(measureColumn.type),
        `${path}.measure.column must be numeric for ${recommendation.measure.operation}.`
      );
    }
  }

  if (recommendation.group_by !== null && recommendation.group_by !== undefined) {
    assert(isObject(recommendation.group_by), `${path}.group_by must be an object or null.`);
    getSourceColumn(
      blueprintTableMap,
      recommendation.group_by.table,
      recommendation.group_by.column,
      `${path}.group_by`
    );
  }

  validateFilters(recommendation.filters, blueprintTableMap, `${path}.filters`);

  if (recommendation.sort !== null && recommendation.sort !== undefined) {
    assert(isObject(recommendation.sort), `${path}.sort must be an object or null.`);
    assert(nonEmptyString(recommendation.sort.column), `${path}.sort.column is required.`);
    assert(
      VALID_SORT_DIRECTIONS.has(recommendation.sort.direction),
      `${path}.sort.direction is invalid.`
    );
  }

  const hasGrouping =
    recommendation.group_by !== null &&
    recommendation.group_by !== undefined;

  if (hasGrouping) {
    if (
      recommendation.limit !== null &&
      recommendation.limit !== undefined
    ) {
      assert(
        Number.isInteger(recommendation.limit) &&
        recommendation.limit >= 1 &&
        recommendation.limit <= 20,
        `${path}.limit must be an integer from 1 to 20.`
      );
    }

    if (
      recommendation.chart_type !== null &&
      recommendation.chart_type !== undefined
    ) {
      assert(
        VALID_CHART_TYPES.has(recommendation.chart_type),
        `${path}.chart_type is invalid.`
      );
    }
  }
}

function validateRequestedAnalysis(requestedAnalysis, blueprintTableMap, relationshipKeys) {
  assert(Array.isArray(requestedAnalysis), "blueprint.requested_analysis must be an array.");

  const analysisIds = new Set();
  const linkedDashboardIds = new Set();

  requestedAnalysis.forEach((entry, index) => {
    const path = `blueprint.requested_analysis[${index}]`;

    assert(isObject(entry), `${path} must be an object.`);
    assert(nonEmptyString(entry.id), `${path}.id is required.`);
    assert(!analysisIds.has(entry.id), `${path}.id is duplicated.`);
    assert(nonEmptyString(entry.request), `${path}.request is required.`);
    assert(VALID_REQUEST_STATUSES.has(entry.status), `${path}.status is invalid.`);
    assert(nonEmptyString(entry.reason), `${path}.reason is required.`);

    [
      "required_tables",
      "required_columns",
      "required_relationships",
      "required_calculations",
      "missing_requirements",
      "assumptions",
      "dashboard_object_ids",
    ].forEach((property) => {
      assert(Array.isArray(entry[property]), `${path}.${property} must be an array.`);
    });

    entry.required_tables.forEach((tableName, tableIndex) => {
      assert(
        blueprintTableMap.has(normalizeName(tableName)),
        `${path}.required_tables[${tableIndex}] is unknown.`
      );
    });

    entry.required_columns.forEach((columnReference, columnIndex) => {
      const columnPath = `${path}.required_columns[${columnIndex}]`;

      assert(isObject(columnReference), `${columnPath} must be an object.`);
      getSourceColumn(
        blueprintTableMap,
        columnReference.table_name,
        columnReference.column,
        columnPath
      );
      assert(nonEmptyString(columnReference.purpose), `${columnPath}.purpose is required.`);
    });

    entry.required_relationships.forEach((relationship, relationshipIndex) => {
      const relationshipPath = `${path}.required_relationships[${relationshipIndex}]`;

      assert(isObject(relationship), `${relationshipPath} must be an object.`);
      const directKey = relationshipKey(relationship);
      const reverseKey = reverseRelationshipKey(relationship);
      assert(
        relationshipKeys.has(directKey) || relationshipKeys.has(reverseKey),
        `${relationshipPath} is not a returned top-level relationship.`
      );
    });

    validateQueryIntent(entry.query_intent, `${path}.query_intent`);

    if (entry.status === "executable") {
      assert(entry.dashboard_object_ids.length > 0, `${path}.dashboard_object_ids is required.`);
      assert(entry.missing_requirements.length === 0, `${path}.missing_requirements must be empty.`);
      validateDashboardRecommendation(
        entry.dashboard_recommendation,
        blueprintTableMap,
        `${path}.dashboard_recommendation`
      );
    } else {
      assert(entry.dashboard_object_ids.length === 0, `${path}.dashboard_object_ids must be empty.`);
    }

    if (entry.status === "needs_clarification") {
      assert(entry.assumptions.length > 0, `${path}.assumptions must explain the clarification.`);
    }

    if (entry.status === "unsupported") {
      assert(entry.missing_requirements.length > 0, `${path}.missing_requirements must explain what is missing.`);
    }

    entry.dashboard_object_ids.forEach((id, idIndex) => {
      assert(nonEmptyString(id), `${path}.dashboard_object_ids[${idIndex}] is invalid.`);
      assert(!linkedDashboardIds.has(id), `${id} is linked to multiple requested analyses.`);
      linkedDashboardIds.add(id);
    });

    analysisIds.add(entry.id);
  });

  return linkedDashboardIds;
}

// A ratio measure divides two aggregates on the same table, e.g. margin as
// SUM(profit) / SUM(revenue) * 100. Both sides must be numeric.
function validateMeasureRatio(item, blueprintTableMap, path) {
  if (item.ratio === null || item.ratio === undefined) return false;

  const ratioPath = `${path}.ratio`;

  assert(isObject(item.ratio), `${ratioPath} must be an object.`);
  assertExactProperties(item.ratio, new Set(["operation", "column", "scale"]), ratioPath);
  assert(VALID_OPERATIONS.has(item.ratio.operation), `${ratioPath}.operation is invalid.`);
  assert(item.ratio.operation !== "count", `${ratioPath}.operation cannot be count.`);
  assert(item.operation !== "count", `${path}.operation cannot be count for a ratio measure.`);

  const numerator = getSourceColumn(blueprintTableMap, item.table_name, item.column, path);
  const denominator = getSourceColumn(
    blueprintTableMap,
    item.table_name,
    item.ratio.column,
    ratioPath
  );

  assert(isNumericType(numerator.type), `${path}.column must be numeric for a ratio measure.`);
  assert(isNumericType(denominator.type), `${ratioPath}.column must be numeric.`);

  if (item.ratio.scale !== null && item.ratio.scale !== undefined) {
    assert(
      Number.isFinite(item.ratio.scale) && item.ratio.scale !== 0,
      `${ratioPath}.scale must be a non-zero number.`
    );
  }

  return true;
}

// A difference measure subtracts one column from another and aggregates the
// result, e.g. profit as SUM(price - cost) or a duration as AVG(end - start).
// Unlike a ratio, the subtracted column may live on a directly connected table,
// which is why the subtracted table joins the join-budget check below.
function validateMeasureDifference(item, blueprintTableMap, path) {
  if (item.difference === null || item.difference === undefined) return false;

  const differencePath = `${path}.difference`;

  assert(isObject(item.difference), `${differencePath} must be an object.`);
  assertExactProperties(
    item.difference,
    new Set(["operation", "column", "table", "as_percentage"]),
    differencePath
  );
  assert(VALID_OPERATIONS.has(item.difference.operation), `${differencePath}.operation is invalid.`);
  assert(item.difference.operation !== "count", `${differencePath}.operation cannot be count.`);
  assert(item.operation !== "count", `${path}.operation cannot be count for a difference measure.`);

  // A measure is either a ratio or a difference. Both at once has no defined
  // meaning, and the query builder would have to silently pick one.
  assert(
    item.ratio === null || item.ratio === undefined,
    `${path} cannot combine a ratio and a difference measure.`
  );

  const minuend = getSourceColumn(
    blueprintTableMap,
    item.measure_table || item.table_name,
    item.column,
    path
  );
  const subtrahend = getSourceColumn(
    blueprintTableMap,
    item.difference.table || item.table_name,
    item.difference.column,
    differencePath
  );

  // Numeric minus numeric yields a value, date minus date yields a duration.
  // Mixing the two subtracts a number from a date, which Postgres would either
  // reject or answer with a meaningless interval.
  const bothNumeric = isNumericType(minuend.type) && isNumericType(subtrahend.type);
  const bothDates = isDateType(minuend.type) && isDateType(subtrahend.type);

  assert(
    bothNumeric || bothDates,
    `${differencePath} subtracts "${subtrahend.name}" (${subtrahend.type}) from "${minuend.name}" (${minuend.type}). Both must be numeric, or both must be dates.`
  );

  if (item.difference.as_percentage !== null && item.difference.as_percentage !== undefined) {
    assert(
      typeof item.difference.as_percentage === "boolean",
      `${differencePath}.as_percentage must be true or omitted.`
    );
  }

  if (item.difference.as_percentage === true) {
    assert(
      bothNumeric,
      `${differencePath}.as_percentage requires numeric columns. A percentage of a duration is not meaningful.`
    );

    // The percentage runs as summed difference over summed measure, so any
    // other operation would describe a calculation that never executes.
    assert(
      item.difference.operation === "sum",
      `${differencePath}.operation must be "sum" when as_percentage is true.`
    );

    // Only KPIs carry a format; charts have no such property, so the check
    // applies to whichever items actually declare one.
    if (item.format !== null && item.format !== undefined) {
      assert(
        item.format === "percentage",
        `${path}.format must be "percentage" for a difference percentage, not "${item.format}".`
      );
    }
  }

  return true;
}

// A date difference aggregates the number of days between two dates, so its
// measure column is legitimately a date where a plain aggregate needs a number.
function measuresDateDifference(item) {
  return isObject(item.difference) && item.difference.as_percentage !== true;
}

// Summing or counting percentages is meaningless; a percentage must come from a
// ratio measure, a difference percentage, or an average of an already-percentage
// column.
function validatePercentageFormat(item, isRatio, path, isDifferencePercentage = false) {
  if (item.format !== "percentage") return;

  assert(
    isRatio ||
      isDifferencePercentage ||
      item.operation === "avg" ||
      item.operation === "min" ||
      item.operation === "max",
    `${path}.format "percentage" requires a ratio or difference measure, or an avg/min/max operation, not ${item.operation}.`
  );
}

// Every table referenced by group_by or a filter must be reachable from the
// item's own table within MAX_JOIN_HOPS, because the report resolves them as a
// join path rooted at that table.
//
// Capped separately from hop depth: the query builder emits one LEFT JOIN
// aliased t2, so a single item cannot reach two different foreign tables no
// matter how close they are. Raise alongside the query builder.
const MAX_FOREIGN_TABLES_PER_ITEM = 1;

function assertJoinTargetsReachable(item, ownTableName, extraTableNames, tableConnectivity, path) {
  const foreignTables = new Set();

  extraTableNames.forEach((tableName) => {
    const normalized = normalizeName(tableName);
    if (normalized && normalized !== ownTableName) foreignTables.add(normalized);
  });

  assert(
    foreignTables.size <= MAX_FOREIGN_TABLES_PER_ITEM,
    `${path} may reference at most ${MAX_FOREIGN_TABLES_PER_ITEM} other tables across group_by_table and filters, but found ${foreignTables.size}.`
  );

  foreignTables.forEach((foreignTable) => {
    assert(
      tableConnectivity.has(`${ownTableName}::${foreignTable}`),
      `${path} references "${foreignTable}", which is not reachable from "${item.table_name}" within ${MAX_JOIN_HOPS} relationship hops.`
    );
  });
}

function collectFilterTables(filters, fallbackTableName) {
  return (Array.isArray(filters) ? filters : []).map(
    (filter) => filter?.table || fallbackTableName
  );
}

function validateDashboard(dashboard, blueprintTableMap, hasCustomRequests, linkedDashboardIds, tableConnectivity = new Set()) {
  assert(isObject(dashboard), "blueprint.dashboard must be an object.");

  if (Object.keys(dashboard).length === 0) {
    assert(!hasCustomRequests, "blueprint.dashboard cannot be empty when requested_analysis is present.");
    return;
  }

  assert(Array.isArray(dashboard.kpis), "blueprint.dashboard.kpis must be an array.");
  assert(Array.isArray(dashboard.charts), "blueprint.dashboard.charts must be an array.");

  const generatedIds = new Set();

  dashboard.kpis.forEach((kpi, index) => {
    const path = `blueprint.dashboard.kpis[${index}]`;

    assert(isObject(kpi), `${path} must be an object.`);
    assert(nonEmptyString(kpi.id) && kpi.id.startsWith("kpi_"), `${path}.id is invalid.`);
    assert(!generatedIds.has(kpi.id), `${path}.id is duplicated.`);
    assert(VALID_OPERATIONS.has(kpi.operation), `${path}.operation is invalid.`);
    assert(VALID_FORMATS.has(kpi.format), `${path}.format is invalid.`);

    if (!(kpi.operation === "count" && kpi.column == null)) {
      const column = getSourceColumn(blueprintTableMap, kpi.table_name, kpi.column, path);
      if (kpi.operation !== "count") {
        assert(
          isNumericType(column.type) ||
            (measuresDateDifference(kpi) && isDateType(column.type)),
          `${path}.column must be numeric.`
        );
      }
    }

    const kpiIsRatio = validateMeasureRatio(kpi, blueprintTableMap, path);
    const kpiIsDifference = validateMeasureDifference(kpi, blueprintTableMap, path);

    validatePercentageFormat(
      kpi,
      kpiIsRatio,
      path,
      kpiIsDifference && kpi.difference.as_percentage === true
    );

    if (kpi.filters !== null && kpi.filters !== undefined) {
      validateFilters(kpi.filters, blueprintTableMap, `${path}.filters`);
    }

    // A difference on another table spends the same single join a filter would,
    // so both are counted together rather than given separate budgets.
    if (kpi.filters != null || kpiIsDifference) {
      assertJoinTargetsReachable(
        kpi,
        normalizeName(kpi.table_name),
        [
          ...collectFilterTables(kpi.filters, kpi.table_name),
          ...(kpiIsDifference ? [kpi.difference.table || kpi.table_name] : [])
        ],
        tableConnectivity,
        path
      );
    }

    generatedIds.add(kpi.id);
  });

  dashboard.charts.forEach((chart, index) => {
    const path = `blueprint.dashboard.charts[${index}]`;

    assert(isObject(chart), `${path} must be an object.`);
    assert(nonEmptyString(chart.id) && chart.id.startsWith("chart_"), `${path}.id is invalid.`);
    assert(!generatedIds.has(chart.id), `${path}.id is duplicated.`);
    assert(VALID_OPERATIONS.has(chart.operation), `${path}.operation is invalid.`);
    assert(VALID_CHART_TYPES.has(chart.type), `${path}.type is invalid.`);

    const chartTableName = normalizeName(chart.table_name);

    assert(
      blueprintTableMap.has(chartTableName),
      `${path}.table_name "${chart.table_name}" is unknown.`
    );

    const groupByColumn = getSourceColumn(
      blueprintTableMap,
      chart.group_by_table || chart.table_name,
      chart.group_by,
      `${path}.group_by`
    );

    // Grouping and filtering across tables is executed downstream as a single
    // join, so every referenced table must be directly connected.
    if (chart.filters !== null && chart.filters !== undefined) {
      validateFilters(chart.filters, blueprintTableMap, `${path}.filters`);
    }

    assertJoinTargetsReachable(
      chart,
      chartTableName,
      [
        chart.group_by_table || chart.table_name,
        ...collectFilterTables(chart.filters, chart.table_name),
        // A difference on another table spends the same single join a group_by
        // or filter would, so it shares that budget instead of adding to it.
        ...(isObject(chart.difference)
          ? [chart.difference.table || chart.table_name]
          : [])
      ],
      tableConnectivity,
      path
    );

    if (!(chart.operation === "count" && chart.column == null)) {
      const measureColumn = getSourceColumn(
        blueprintTableMap,
        chart.measure_table || chart.table_name,
        chart.column,
        `${path}.measure`
      );
      if (chart.operation !== "count") {
        assert(
          isNumericType(measureColumn.type) ||
            (measuresDateDifference(chart) && isDateType(measureColumn.type)),
          `${path}.column must be numeric.`
        );
      }
    }

    const chartIsRatio = validateMeasureRatio(chart, blueprintTableMap, path);
    const chartIsDifference = validateMeasureDifference(chart, blueprintTableMap, path);

    validatePercentageFormat(
      chart,
      chartIsRatio,
      path,
      chartIsDifference && chart.difference.as_percentage === true
    );

    if (isDateType(groupByColumn.type)) {
      assert(VALID_TIME_BUCKETS.has(chart.time_bucket), `${path}.time_bucket is required for a date group_by.`);
    } else {
      assert(chart.time_bucket == null, `${path}.time_bucket must be null for a non-date group_by.`);
    }

    if (chart.sort !== null && chart.sort !== undefined) {
      assert(
        VALID_SORT_DIRECTIONS.has(chart.sort),
        `${path}.sort is invalid.`
      );
    }
    if (chart.limit !== null && chart.limit !== undefined) {
      assert(
        Number.isInteger(chart.limit) &&
        chart.limit >= 1 &&
        chart.limit <= 20,
        `${path}.limit must be an integer from 1 to 20.`
      );
    }

    generatedIds.add(chart.id);
  });

  if (hasCustomRequests) {
    generatedIds.forEach((id) => {
      assert(linkedDashboardIds.has(id), `Dashboard object ${id} is not linked to requested_analysis.`);
    });
    linkedDashboardIds.forEach((id) => {
      assert(generatedIds.has(id), `requested_analysis references unknown dashboard object ${id}.`);
    });
  }
}

function isBlueprintLoggingEnabled() {
  return process.env.LOG_AI_BLUEPRINT_RESPONSE !== "false";
}

function logBlueprint(label, blueprint) {
  if (!isBlueprintLoggingEnabled()) return;

  console.log(`\n========== ${label} ==========`);
  console.log(JSON.stringify(blueprint, null, 2));
  console.log(`========== END ${label} ==========\n`);
}

function validateBlueprintResponse(blueprint, schemas) {
  logBlueprint("RAW GROQ BLUEPRINT OBJECT", blueprint);

  assert(isObject(blueprint), "Blueprint must be a JSON object.");

  const allowedTopLevelProperties = new Set([
    "tables",
    "relationships",
    "requested_analysis",
    "dashboard",
  ]);

  assertExactProperties(blueprint, allowedTopLevelProperties, "blueprint");

  ["tables", "relationships", "requested_analysis", "dashboard"].forEach((property) => {
    assert(blueprint[property] !== undefined, `blueprint.${property} is required.`);
  });

  const sourceMaps = buildSourceSchemaMaps(schemas);
  const blueprintTableMap = validateTables(blueprint.tables, sourceMaps);
  const relationshipKeys = validateRelationships(
    blueprint.relationships,
    blueprintTableMap
  );
  const linkedDashboardIds = validateRequestedAnalysis(
    blueprint.requested_analysis,
    blueprintTableMap,
    relationshipKeys
  );

  validateDashboard(
    blueprint.dashboard,
    blueprintTableMap,
    blueprint.requested_analysis.length > 0,
    linkedDashboardIds,
    buildTableConnectivity(blueprint.relationships)
  );

  logBlueprint("VALIDATED COMPACT BLUEPRINT", blueprint);
  return true;
}

// Validates only the uploaded schemas. These failures come from the input, not
// from the model, so callers can check them once instead of per repair attempt.
function validateSourceSchemas(schemas) {
  buildSourceSchemaMaps(schemas);
  return true;
}

module.exports = {
  validateBlueprintResponse,
  validateSourceSchemas,
  // Exported so the step-1 relationship validator enforces the same key and
  // relationship rules as the one-shot blueprint, instead of a second copy
  // that could drift.
  buildSourceSchemaMaps,
  validateTables,
  validateRelationships,
  logBlueprint,
  // Shared with the step-3 plan validator so both layers classify a column's
  // type the same way when checking difference measures.
  isDateType,
};

const { normalizeIdentifier } = require('../utils/identifierNaming');

const OPERATIONS = new Set(['count', 'sum', 'avg', 'min', 'max']);
// Matches ai-service's VALID_CHART_TYPES and the frontend's registered
// renderers. Scatter is excluded from all three.
const CHART_TYPES = new Set(['bar', 'line', 'pie', 'doughnut']);
const FORMATS = new Set(['number', 'decimal', 'currency', 'percentage']);
const SORTS = new Set(['asc', 'desc']);
const NUMERIC_TYPES = new Set([
  'number', 'int', 'integer', 'tinyint', 'smallint', 'mediumint', 'bigint',
  'decimal', 'float', 'double', 'numeric', 'real', 'money', 'serial', 'bigserial'
]);
// Subtracting two of these yields a duration, which the query builder converts
// to a day count before aggregating.
const DATE_TYPES = new Set([
  'date', 'datetime', 'timestamp', 'timestamptz', 'time',
  'timestamp without time zone', 'timestamp with time zone'
]);
const SAFE_ID = /^[a-z][a-z0-9_]{0,62}$/;

const FILTER_OPERATORS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in',
  'between', 'contains', 'starts_with', 'ends_with', 'is_null', 'is_not_null'
]);

const NULL_ONLY_OPERATORS = new Set(['is_null', 'is_not_null']);
const ARRAY_OPERATORS = new Set(['in', 'not_in']);

function fail(message) {
  const error = new Error(message);
  error.statusCode = 422;
  throw error;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getFields(schemaDefinition) {
  const fields = schemaDefinition?.fields || schemaDefinition?.columns || [];
  return Array.isArray(fields) ? fields : [];
}

function buildContext({ blueprint, schemaBundles, generatedTablesBySchemaId }) {
  const tableMap = new Map();

  for (const table of blueprint.tables || []) {
    const normalizedTableName = normalizeIdentifier(table.table_name);
    const bundle = schemaBundles.find((item) => item.schema.id === table.schema_id);
    const generatedTable = generatedTablesBySchemaId.get(table.schema_id);

    assert(bundle, `Dashboard table "${table.table_name}" has no uploaded schema.`);
    assert(generatedTable, `Dashboard table "${table.table_name}" has no generated table.`);

    const fields = new Map();
    for (const field of getFields(bundle.schemaDefinition)) {
      fields.set(normalizeIdentifier(field.name), field);
    }

    tableMap.set(normalizedTableName, {
      blueprintTable: table,
      bundle,
      generatedTable,
      fields
    });
  }

  return tableMap;
}

function validateMetric(item, path, tableMap) {
  assert(item && typeof item === 'object', `${path} must be an object.`);
  if (!item.id || !SAFE_ID.test(item.id)) {
    item.id = normalizeIdentifier(item.id || 'metric_item');
  }
  assert(OPERATIONS.has(item.operation), `${path}.operation is not allowed.`);

  const tableName = normalizeIdentifier(item.table_name);
  const table = tableMap.get(tableName);
  assert(table, `${path}.table_name does not exist.`);

  let columnName = null;
  let field = null;

  if (item.column !== null && item.column !== undefined && item.column !== '') {
    columnName = normalizeIdentifier(item.column);
    field = table.fields.get(columnName);
    assert(field, `${path}.column does not exist in ${item.table_name}.`);
  }

  if (item.operation !== 'count') {
    assert(field, `${path}.column is required for ${item.operation}.`);
  }

  if (item.operation === 'sum' || item.operation === 'avg') {
    const type = String(field?.type || '').toLowerCase();
    // A date measure column is normally a mistake, but it is exactly what a
    // date difference needs: the aggregate runs on the day count the
    // subtraction produces, not on the raw date. validateDifference() confirms
    // the other side is a date too, so the fallback would corrupt a valid plan.
    const isDateDifference = isObject(item.difference) && DATE_TYPES.has(type);

    if (!NUMERIC_TYPES.has(type) && !isDateDifference) {
      item.operation = 'count'; // Graceful fallback
    }
  }

  return {
    ...item,
    table_name: tableName,
    column: columnName,
    resolvedTable: table
  };
}

// A ratio measure divides two aggregates, e.g. margin as
// SUM(profit) / SUM(revenue) * 100. Both sides must be numeric columns on the
// item's own table, so the division stays inside a single scan.
function validateRatio(item, path, table) {
  const ratio = item.ratio;

  if (ratio === null || ratio === undefined) return null;

  assert(typeof ratio === 'object' && !Array.isArray(ratio), `${path}.ratio must be an object.`);
  assert(OPERATIONS.has(ratio.operation), `${path}.ratio.operation is not allowed.`);
  assert(ratio.operation !== 'count', `${path}.ratio.operation cannot be count.`);
  assert(item.operation !== 'count', `${path}.operation cannot be count for a ratio measure.`);

  const columnName = normalizeIdentifier(ratio.column);
  const field = table.fields.get(columnName);

  assert(field, `${path}.ratio.column does not exist in ${item.table_name}.`);

  const type = String(field.type || '').toLowerCase();
  assert(
    NUMERIC_TYPES.has(type),
    `${path}.ratio.column must be numeric, but "${ratio.column}" is ${type || 'untyped'}.`
  );

  let scale = ratio.scale === null || ratio.scale === undefined ? 1 : Number(ratio.scale);
  if (!Number.isFinite(scale) || scale === 0) scale = 1;

  return { operation: ratio.operation, column: columnName, scale, alias: 't1' };
}

// A difference measure subtracts one column from another and aggregates the
// result: AGG(a - b) for two numeric columns, or the day count between two
// dates. Unlike a ratio, the subtracted column may sit on the joined table,
// which is why the caller folds its table into the single-join budget.
function validateDifference(item, path, baseTable, baseTableName, tableMap) {
  const difference = item.difference;

  if (difference === null || difference === undefined) return null;

  assert(isObject(difference), `${path}.difference must be an object.`);
  assert(OPERATIONS.has(difference.operation), `${path}.difference.operation is not allowed.`);
  assert(difference.operation !== 'count', `${path}.difference.operation cannot be count.`);
  assert(item.operation !== 'count', `${path}.operation cannot be count for a difference measure.`);
  assert(
    item.ratio === null || item.ratio === undefined,
    `${path} cannot combine a ratio and a difference measure.`
  );

  const differenceTableName = difference.table
    ? normalizeIdentifier(difference.table)
    : baseTableName;
  const differenceTable = tableMap.get(differenceTableName);

  assert(differenceTable, `${path}.difference.table "${difference.table}" does not exist.`);

  const columnName = normalizeIdentifier(difference.column);
  const subtrahend = differenceTable.fields.get(columnName);

  assert(
    subtrahend,
    `${path}.difference.column "${difference.column}" does not exist in ${difference.table || item.table_name}.`
  );

  const minuend = baseTable.fields.get(normalizeIdentifier(item.column));

  assert(minuend, `${path}.column is required for a difference measure.`);

  const minuendType = String(minuend.type || '').toLowerCase();
  const subtrahendType = String(subtrahend.type || '').toLowerCase();

  const bothNumeric = NUMERIC_TYPES.has(minuendType) && NUMERIC_TYPES.has(subtrahendType);
  const bothDates = DATE_TYPES.has(minuendType) && DATE_TYPES.has(subtrahendType);

  assert(
    bothNumeric || bothDates,
    `${path}.difference subtracts "${columnName}" (${subtrahendType || 'untyped'}) from "${item.column}" (${minuendType || 'untyped'}). Both must be numeric, or both must be dates.`
  );

  const asPercentage = difference.as_percentage === true;

  if (asPercentage) {
    assert(
      bothNumeric,
      `${path}.difference.as_percentage requires numeric columns. A percentage of a duration is not meaningful.`
    );
    // The percentage is always the summed difference over the summed measure,
    // so any other operation would name a calculation the builder never runs.
    assert(
      difference.operation === 'sum',
      `${path}.difference.operation must be "sum" when as_percentage is true.`
    );
  }

  /*
   * Postgres types the two date cases differently: date - date returns an
   * integer day count, while timestamp, timestamptz and time all return an
   * interval. The builder has to know which, because EXTRACT(EPOCH FROM ...)
   * rejects an integer and a bare interval is not a number of days.
   */
  const subtractsToDays =
    bothDates && minuendType === 'date' && subtrahendType === 'date';

  return {
    operation: difference.operation,
    column: columnName,
    table_name: differenceTableName,
    alias: differenceTableName === baseTableName ? 't1' : 't2',
    as_percentage: asPercentage,
    is_date_difference: bothDates,
    subtracts_to_days: subtractsToDays
  };
}

function validateFilters(rawFilters, path, baseTable, baseTableName, tableMap) {
  if (rawFilters === null || rawFilters === undefined) return [];

  assert(Array.isArray(rawFilters), `${path}.filters must be an array.`);
  assert(rawFilters.length <= 10, `${path}.filters supports at most 10 entries.`);

  return rawFilters.map((filter, index) => {
    const filterPath = `${path}.filters[${index}]`;

    assert(filter && typeof filter === 'object', `${filterPath} must be an object.`);
    assert(FILTER_OPERATORS.has(filter.operator), `${filterPath}.operator is not allowed.`);

    const tableName = filter.table
      ? normalizeIdentifier(filter.table)
      : baseTableName;
    const table = tableMap.get(tableName);

    assert(table, `${filterPath}.table "${filter.table}" does not exist.`);

    const columnName = normalizeIdentifier(filter.column);
    assert(
      table.fields.get(columnName),
      `${filterPath}.column "${filter.column}" does not exist in ${filter.table || baseTable.blueprintTable.table_name}.`
    );

    if (NULL_ONLY_OPERATORS.has(filter.operator)) {
      return { table_name: tableName, column: columnName, operator: filter.operator, value: null };
    }

    if (ARRAY_OPERATORS.has(filter.operator)) {
      assert(
        Array.isArray(filter.value) && filter.value.length > 0,
        `${filterPath}.value must be a non-empty array for ${filter.operator}.`
      );
    } else if (filter.operator === 'between') {
      assert(
        Array.isArray(filter.value) && filter.value.length === 2,
        `${filterPath}.value must contain exactly two values for between.`
      );
    } else {
      assert(
        filter.value !== null && filter.value !== undefined && filter.value !== '',
        `${filterPath}.value is required for ${filter.operator}.`
      );
    }

    return { table_name: tableName, column: columnName, operator: filter.operator, value: filter.value };
  });
}

// The query builder emits at most one LEFT JOIN, so every foreign table
// referenced by a group_by, a filter, or a difference must resolve to the same
// single table.
function resolveForeignTableName(baseTableName, groupByTableName, filters, difference = null) {
  const foreignTables = new Set();

  if (groupByTableName && groupByTableName !== baseTableName) {
    foreignTables.add(groupByTableName);
  }

  filters.forEach((filter) => {
    if (filter.table_name !== baseTableName) foreignTables.add(filter.table_name);
  });

  if (difference && difference.table_name !== baseTableName) {
    foreignTables.add(difference.table_name);
  }

  return foreignTables;
}

// The blueprint expresses cross-table grouping as group_by_table, but the query
// builder joins via an explicit join spec. Derive that spec from the validated
// relationships instead of guessing a join condition.
function findJoinForGroupBy(blueprint, fromTableName, groupByTableName) {
  const relationships = Array.isArray(blueprint?.relationships)
    ? blueprint.relationships
    : [];

  for (const relationship of relationships) {
    const relFrom = normalizeIdentifier(relationship.from_table);
    const relTo = normalizeIdentifier(relationship.to_table);

    // Chart table is the child holding the foreign key.
    if (relFrom === fromTableName && relTo === groupByTableName) {
      return {
        table_name: relationship.to_table,
        local_column: relationship.from_column,
        remote_column: relationship.to_column
      };
    }

    // Chart table is the parent; the group-by table holds the foreign key.
    if (relFrom === groupByTableName && relTo === fromTableName) {
      return {
        table_name: relationship.from_table,
        local_column: relationship.to_column,
        remote_column: relationship.from_column
      };
    }
  }

  return null;
}

function validateAnalyticsPlan({ blueprint, schemaBundles, generatedTablesBySchemaId }) {
  const dashboard = blueprint?.dashboard;
  assert(dashboard && typeof dashboard === 'object', 'Dashboard plan is missing.');
  assert(Array.isArray(dashboard.kpis) && dashboard.kpis.length <= 6, 'Dashboard KPIs are invalid.');
  assert(Array.isArray(dashboard.charts) && dashboard.charts.length <= 6, 'Dashboard charts are invalid.');

  // The blueprint contract has no insights field, so treat it as optional.
  // Still validated strictly when the upstream response does supply it.
  const insights =
    dashboard.insights === undefined || dashboard.insights === null
      ? []
      : dashboard.insights;

  assert(Array.isArray(insights) && insights.length <= 4, 'Dashboard insights are invalid.');

  const tableMap = buildContext({ blueprint, schemaBundles, generatedTablesBySchemaId });
  const usedIds = new Set();

  function makeUniqueId(baseId, suffix = '') {
    let candidate = String(baseId || 'item').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    let finalId = candidate;
    let counter = 1;
    while (usedIds.has(finalId)) {
      finalId = `${candidate}_${suffix ? suffix + '_' : ''}${counter}`;
      counter += 1;
    }
    usedIds.add(finalId);
    return finalId;
  }

  const kpis = dashboard.kpis.map((item, index) => {
    const path = `dashboard.kpis[${index}]`;
    const validated = validateMetric(item, path, tableMap);
    validated.id = makeUniqueId(validated.id || `kpi_${index}`, 'kpi');
    assert(FORMATS.has(validated.format), `${path}.format is invalid.`);

    validated.ratio = validateRatio(item, path, validated.resolvedTable);
    validated.difference = validateDifference(
      item,
      path,
      validated.resolvedTable,
      validated.table_name,
      tableMap
    );

    const filters = validateFilters(
      item.filters,
      path,
      validated.resolvedTable,
      validated.table_name,
      tableMap
    );

    const foreignTables = resolveForeignTableName(
      validated.table_name,
      null,
      filters,
      validated.difference
    );

    assert(
      foreignTables.size <= 1,
      `${path} may reference at most one other table across filters and difference, but found ${foreignTables.size}.`
    );

    let resolvedJoinTable = null;
    let joinSpec = null;

    if (foreignTables.size === 1) {
      const [foreignTableName] = foreignTables;
      joinSpec = findJoinForGroupBy(blueprint, validated.table_name, foreignTableName);

      assert(
        joinSpec,
        `${path} references "${foreignTableName}", which has no relationship to "${item.table_name}".`
      );

      resolvedJoinTable = tableMap.get(normalizeIdentifier(joinSpec.table_name));
      assert(resolvedJoinTable, `${path} references an unknown table.`);
    }

    validated.join = joinSpec
      ? {
          table_name: normalizeIdentifier(joinSpec.table_name),
          local_column: normalizeIdentifier(joinSpec.local_column),
          remote_column: normalizeIdentifier(joinSpec.remote_column),
          resolvedTable: resolvedJoinTable
        }
      : null;

    validated.filters = filters.map((filter) => ({
      ...filter,
      alias: filter.table_name === validated.table_name ? 't1' : 't2'
    }));

    return validated;
  });

  const charts = dashboard.charts.map((item, index) => {
    const path = `dashboard.charts[${index}]`;
    const validated = validateMetric(item, path, tableMap);
    validated.id = makeUniqueId(validated.id || `chart_${index}`, 'chart');
    assert(CHART_TYPES.has(validated.type), `${path}.type is invalid.`);
    assert(SORTS.has(validated.sort), `${path}.sort is invalid.`);
    let limit = Number(validated.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      limit = 10;
    }
    validated.limit = limit;
    item.limit = limit;

    assert(Number.isInteger(validated.limit) && validated.limit >= 1 && validated.limit <= 20,
      `${path}.limit must be 1-20.`);

    const groupBy = normalizeIdentifier(validated.group_by);
    let targetTableFields = validated.resolvedTable.fields;
    let resolvedJoinTable = null;

    let joinSpec =
      item.join && typeof item.join === 'object' ? item.join : null;

    const groupByTableName = item.group_by_table
      ? normalizeIdentifier(item.group_by_table)
      : null;

    validated.ratio = validateRatio(item, path, validated.resolvedTable);
    validated.difference = validateDifference(
      item,
      path,
      validated.resolvedTable,
      validated.table_name,
      tableMap
    );

    const filters = validateFilters(
      item.filters,
      path,
      validated.resolvedTable,
      validated.table_name,
      tableMap
    );

    // group_by, every filter, and any difference must agree on the one table we
    // can join to.
    const foreignTables = resolveForeignTableName(
      validated.table_name,
      groupByTableName,
      filters,
      validated.difference
    );

    assert(
      foreignTables.size <= 1,
      `${path} may reference at most one other table across group_by_table, filters, and difference, but found ${foreignTables.size}.`
    );

    if (!joinSpec && foreignTables.size === 1) {
      const [foreignTableName] = foreignTables;
      joinSpec = findJoinForGroupBy(blueprint, validated.table_name, foreignTableName);

      assert(
        joinSpec,
        `${path} references "${foreignTableName}", which has no relationship to "${item.table_name}".`
      );
    }

    if (joinSpec) {
      const joinTableName = normalizeIdentifier(joinSpec.table_name);
      resolvedJoinTable = tableMap.get(joinTableName);
      assert(resolvedJoinTable, `${path}.join.table_name does not exist.`);

      const localCol = normalizeIdentifier(joinSpec.local_column);
      const remoteCol = normalizeIdentifier(joinSpec.remote_column);

      assert(validated.resolvedTable.fields.has(localCol), `${path}.join.local_column does not exist.`);
      assert(resolvedJoinTable.fields.has(remoteCol), `${path}.join.remote_column does not exist.`);
    }

    // The join may now originate from a filter rather than from group_by_table,
    // so resolve group_by against the table it actually belongs to.
    const groupByOnJoinedTable =
      Boolean(resolvedJoinTable) &&
      groupByTableName &&
      groupByTableName !== validated.table_name;

    targetTableFields = groupByOnJoinedTable
      ? resolvedJoinTable.fields
      : validated.resolvedTable.fields;

    assert(targetTableFields.has(groupBy), `${path}.group_by does not exist in target table.`);

    const TIME_BUCKETS = new Set(['hour', 'day', 'week', 'month', 'quarter', 'year']);
    let timeBucket = null;
    if (item.time_bucket) {
      timeBucket = String(item.time_bucket).toLowerCase();
      assert(TIME_BUCKETS.has(timeBucket), `${path}.time_bucket is invalid.`);
    }

    return {
      ...validated,
      group_by: groupBy,
      group_by_alias: groupByOnJoinedTable ? 't2' : 't1',
      join: joinSpec ? {
        table_name: normalizeIdentifier(joinSpec.table_name),
        local_column: normalizeIdentifier(joinSpec.local_column),
        remote_column: normalizeIdentifier(joinSpec.remote_column),
        resolvedTable: resolvedJoinTable
      } : null,
      filters: filters.map((filter) => ({
        ...filter,
        alias: filter.table_name === validated.table_name ? 't1' : 't2'
      })),
      time_bucket: timeBucket
    };
  });

  return {
    config: {
      version: 1,
      title: dashboard.title,
      subtitle: dashboard.subtitle,
      domain: dashboard.domain || blueprint.domain,
      kpis: dashboard.kpis,
      charts: dashboard.charts,
      insights,
      layout: dashboard.layout
    },
    kpis,
    charts
  };
}

module.exports = {
  validateAnalyticsPlan
};

const { quoteIdentifier } = require('../utils/identifierNaming');

const AGGREGATES = Object.freeze({
  count: 'COUNT',
  sum: 'SUM',
  avg: 'AVG',
  min: 'MIN',
  max: 'MAX'
});

function qualifiedTable(generatedTable) {
  return `${quoteIdentifier(generatedTable.physical_schema_name || 'public')}.${quoteIdentifier(generatedTable.physical_table_name)}`;
}

function aggregateSql(operation, column, alias = null) {
  const aggregate = AGGREGATES[operation];
  if (!aggregate) throw new Error(`Unsupported analytics operation: ${operation}`);
  if (operation === 'count' && !column) return 'COUNT(*)';
  const qualifiedCol = alias ? `${alias}.${quoteIdentifier(column)}` : quoteIdentifier(column);
  return `${aggregate}(${qualifiedCol})`;
}

// A difference measure subtracts one column from another before aggregating:
// AGG(a - b), not AGG(a) - AGG(b), because those only agree for AVG.
//
// Date subtraction has two shapes in Postgres. date - date is already an
// integer number of days and needs no conversion; EXTRACT would in fact reject
// it, since there is no extract(text, integer). timestamp, timestamptz and
// time all subtract to an interval, which is converted to a decimal day count
// so every date difference reports in the same unit.
//
// The join is a LEFT JOIN, so an unmatched row subtracts to NULL and Postgres
// aggregates skip it. That is the wanted behaviour, hence no COALESCE.
function differenceExpressionSql(item, baseAlias) {
  const minuend = `${baseAlias}.${quoteIdentifier(item.column)}`;
  const subtrahend = `${item.difference.alias || baseAlias}.${quoteIdentifier(item.difference.column)}`;
  const subtraction = `${minuend} - ${subtrahend}`;

  if (item.difference.is_date_difference && !item.difference.subtracts_to_days) {
    return `EXTRACT(EPOCH FROM (${subtraction})) / 86400`;
  }

  return subtraction;
}

// A ratio measure divides two aggregates, e.g. profit margin as
// SUM(profit) / SUM(revenue) * 100. Both sides are cast to numeric so Postgres
// does not perform integer division, and NULLIF guards a zero denominator.
function measureSql(item, baseAlias) {
  if (item.difference) {
    const aggregate = AGGREGATES[item.difference.operation];
    if (!aggregate) {
      throw new Error(`Unsupported analytics operation: ${item.difference.operation}`);
    }

    const difference = `${aggregate}(${differenceExpressionSql(item, baseAlias)})`;

    if (!item.difference.as_percentage) return difference;

    /*
     * A difference percentage is blended, not averaged per row: the summed
     * difference over the summed measure. AVG((a - b) / a) would weight a tiny
     * row the same as a huge one, which is the wrong answer for a margin.
     *
     * The validator pins the operation to sum, so both sides here agree with
     * what the dashboard contract says is being computed.
     */
    const base = `${aggregate}(${baseAlias}.${quoteIdentifier(item.column)})`;

    return `(${difference}::numeric / NULLIF(${base}::numeric, 0)) * 100`;
  }

  const numerator = aggregateSql(item.operation, item.column, baseAlias);

  if (!item.ratio) return numerator;

  const denominator = aggregateSql(
    item.ratio.operation,
    item.ratio.column,
    item.ratio.alias || baseAlias
  );

  const scale = Number(item.ratio.scale);
  const scaleSql = Number.isFinite(scale) && scale !== 1 ? ` * ${scale}` : '';

  return `(${numerator}::numeric / NULLIF(${denominator}::numeric, 0))${scaleSql}`;
}

// Filters arrive already resolved: alias and column are validated, values are
// always bound as query parameters so nothing user-supplied reaches the SQL text.
function buildFilterSql(filters, nextParamIndex) {
  const clauses = [];
  const values = [];
  let paramIndex = nextParamIndex;

  (Array.isArray(filters) ? filters : []).forEach((filter) => {
    const column = `${filter.alias}.${quoteIdentifier(filter.column)}`;

    switch (filter.operator) {
      case 'is_null':
        clauses.push(`${column} IS NULL`);
        break;
      case 'is_not_null':
        clauses.push(`${column} IS NOT NULL`);
        break;
      case 'in':
        clauses.push(`${column} = ANY($${paramIndex})`);
        values.push(filter.value);
        paramIndex += 1;
        break;
      case 'not_in':
        clauses.push(`(${column} IS NULL OR ${column} <> ALL($${paramIndex}))`);
        values.push(filter.value);
        paramIndex += 1;
        break;
      case 'between':
        clauses.push(`${column} BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
        values.push(filter.value[0], filter.value[1]);
        paramIndex += 2;
        break;
      case 'contains':
        clauses.push(`${column}::text ILIKE $${paramIndex}`);
        values.push(`%${filter.value}%`);
        paramIndex += 1;
        break;
      case 'starts_with':
        clauses.push(`${column}::text ILIKE $${paramIndex}`);
        values.push(`${filter.value}%`);
        paramIndex += 1;
        break;
      case 'ends_with':
        clauses.push(`${column}::text ILIKE $${paramIndex}`);
        values.push(`%${filter.value}`);
        paramIndex += 1;
        break;
      case 'neq':
        // NULL <> value is NULL in SQL, which would silently drop null rows.
        clauses.push(`(${column} IS NULL OR ${column} <> $${paramIndex})`);
        values.push(filter.value);
        paramIndex += 1;
        break;
      default: {
        const comparison = {
          eq: '=',
          gt: '>',
          gte: '>=',
          lt: '<',
          lte: '<='
        }[filter.operator];

        if (!comparison) {
          throw new Error(`Unsupported analytics filter operator: ${filter.operator}`);
        }

        clauses.push(`${column} ${comparison} $${paramIndex}`);
        values.push(filter.value);
        paramIndex += 1;
      }
    }
  });

  return { clauses, values, nextParamIndex: paramIndex };
}

function buildJoinClause(join, alias, paramIndex) {
  const joinTable = qualifiedTable(join.resolvedTable.generatedTable);
  const localColumn = quoteIdentifier(join.local_column);
  const remoteColumn = quoteIdentifier(join.remote_column);

  // The joined table also stores multiple generations, so it must be pinned to
  // its own generated_table_id or the join would mix generations together.
  return {
    sql: ` LEFT JOIN ${joinTable} ${alias} ON t1.${localColumn} = ${alias}.${remoteColumn} AND ${alias}."__ris_generated_table_id" = $${paramIndex}`,
    value: join.resolvedTable.generatedTable.id
  };
}

function buildKpiQuery(metric) {
  const table = qualifiedTable(metric.resolvedTable.generatedTable);
  const values = [metric.resolvedTable.generatedTable.id];
  let paramIndex = 2;
  let fromClause = `${table} t1`;

  if (metric.join) {
    const join = buildJoinClause(metric.join, 't2', paramIndex);
    fromClause += join.sql;
    values.push(join.value);
    paramIndex += 1;
  }

  const filters = buildFilterSql(metric.filters, paramIndex);
  values.push(...filters.values);

  const conditions = ['t1."__ris_generated_table_id" = $1', ...filters.clauses];

  return {
    text: `
      SELECT ${measureSql(metric, 't1')} AS value
      FROM ${fromClause}
      WHERE ${conditions.join('\n        AND ')}
    `,
    values
  };
}

function buildChartQuery(chart) {
  const table = qualifiedTable(chart.resolvedTable.generatedTable);
  const direction = chart.sort === 'asc' ? 'ASC' : 'DESC';
  const values = [chart.resolvedTable.generatedTable.id];
  let paramIndex = 2;

  let fromClause = `${table} t1`;
  let groupExpr = `t1.${quoteIdentifier(chart.group_by)}`;

  if (chart.join) {
    const join = buildJoinClause(chart.join, 't2', paramIndex);
    fromClause += join.sql;
    values.push(join.value);
    paramIndex += 1;

    // The join can come from a filter instead of group_by_table, in which case
    // group_by still belongs to the base table.
    const groupByAlias = chart.group_by_alias || 't2';
    groupExpr = `${groupByAlias}.${quoteIdentifier(chart.group_by)}`;
  }

  if (chart.time_bucket) {
    // Escape single quotes just in case, though validator ensures it's safe (e.g. 'day')
    const bucket = chart.time_bucket.replace(/'/g, "''");
    groupExpr = `DATE_TRUNC('${bucket}', ${groupExpr})`;
  }

  const filters = buildFilterSql(chart.filters, paramIndex);
  values.push(...filters.values);
  paramIndex = filters.nextParamIndex;

  const conditions = [
    't1."__ris_generated_table_id" = $1',
    `${groupExpr} IS NOT NULL`,
    ...filters.clauses
  ];

  const limitIndex = paramIndex;
  values.push(chart.limit);

  return {
    text: `
      SELECT ${groupExpr} AS label, ${measureSql(chart, 't1')} AS value
      FROM ${fromClause}
      WHERE ${conditions.join('\n        AND ')}
      GROUP BY ${groupExpr}
      ORDER BY value ${direction} NULLS LAST
      LIMIT $${limitIndex}
    `,
    values
  };
}

module.exports = {
  buildKpiQuery,
  buildChartQuery
};

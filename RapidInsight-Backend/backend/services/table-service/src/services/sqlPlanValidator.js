const { Parser } = require('node-sql-parser');
const { normalizeIdentifier } = require('../utils/identifierNaming');

// Experimental: validates SQL the LLM wrote directly (sqlKpiExecutionService.js),
// as an alternative to the plan-based analyticsQueryBuilder.js. The LLM's
// prompt asks nicely for safe SQL, but nothing here trusts that request - every
// rule below is enforced by walking the parsed AST, and anything the walker
// doesn't explicitly recognize is REJECTED, not silently allowed. That
// fail-closed default is what makes a hand-rolled walker acceptable without
// covering every corner of the SQL grammar.
//
// Known limitations of this first pass, accepted for a dev-stage experiment:
// - Correlated subqueries are not supported (a subquery cannot reference a
//   column from its outer query) - the walker treats every subquery as its
//   own isolated scope.
// - Set operations (UNION/INTERSECT/EXCEPT) are rejected outright.

const parser = new Parser();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FUNCTION_ALLOW_LIST = new Set([
  'count', 'sum', 'avg', 'min', 'max',
  'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead',
  'round', 'coalesce', 'nullif', 'date_trunc',
  // Ordered-set aggregates for median/percentile - read-only math, same risk
  // class as avg/sum. See the within_group_orderby handling below.
  'percentile_cont', 'percentile_disc',
  // Needed for relative date filters ("last 90 days"). No arguments, no side
  // effects - just reads the server's current date/time.
  'current_date', 'current_timestamp', 'now'
]);

const TENANT_COLUMN = '__ris_generated_table_id';
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 1000;

function fail(message) {
  const error = new Error(message);
  error.statusCode = 422;
  throw error;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

/**
 * Builds the whitelist a raw SQL query is checked against: physical table
 * name -> { generatedTable, fields: Set<normalized column name> }.
 *
 * Mirrors analyticsPlanValidator.buildContext(), but keyed by the *physical*
 * Postgres table/column names (what the LLM was actually given), not the
 * logical schema names.
 */
function buildPhysicalContext({ schemaBundles, generatedTablesBySchemaId }) {
  const tableMap = new Map();

  for (const bundle of schemaBundles) {
    const generatedTable = generatedTablesBySchemaId.get(bundle.schema.id);
    if (!generatedTable) continue;

    const physicalTableName = normalizeIdentifier(generatedTable.physical_table_name);
    const rawFields = bundle.schemaDefinition?.fields || bundle.schemaDefinition?.columns || [];

    const fields = new Set(
      (Array.isArray(rawFields) ? rawFields : [])
        .map((field) => normalizeIdentifier(field?.name))
        .filter(Boolean)
    );

    // System columns exist on every generated table but never appear in the
    // uploaded schema definition. A query is allowed to reference them.
    fields.add(TENANT_COLUMN);
    fields.add('__ris_id');
    fields.add('__ris_created_by');
    fields.add('__ris_created_at');

    tableMap.set(physicalTableName, { generatedTable, fields });
  }

  return tableMap;
}

function extractFunctionName(expr) {
  if (typeof expr.name === 'string') return expr.name.toLowerCase();

  const parts = expr.name?.name;
  if (Array.isArray(parts)) {
    return parts.map((part) => String(part?.value || '')).join('.').toLowerCase();
  }

  return '';
}

function extractColumnName(columnRef) {
  if (columnRef.column === '*') return '*';
  if (typeof columnRef.column === 'string') return columnRef.column;
  return columnRef.column?.expr?.value || null;
}

// One walker per query scope: a top-level SELECT, a CTE body, or a subquery.
// `resolvable` maps a name (alias, or table name when unaliased) visible in
// THIS scope to either a real whitelist entry ({ real: true, fields }) or a
// pseudo entry ({ real: false }) for a CTE / derived-table result that was
// already validated when it was walked.
function createScope(parentCteNames) {
  return {
    resolvable: new Map(),
    cteNames: new Set(parentCteNames),
    // SELECT-list output aliases (e.g. SUM(revenue) AS total). Postgres lets
    // GROUP BY/ORDER BY/HAVING reference these instead of a real column.
    outputAliases: new Set()
  };
}

function resolveColumnRef(columnRef, scope) {
  const columnName = extractColumnName(columnRef);
  assert(columnName, 'Could not read a column reference.');
  assert(columnName !== '*', 'SELECT * / wildcard columns are not allowed - select explicit columns.');

  const normalizedColumn = normalizeIdentifier(columnName);

  if (!columnRef.table && scope.outputAliases.has(normalizedColumn)) return;

  if (columnRef.table) {
    const alias = normalizeIdentifier(columnRef.table);
    const entry = scope.resolvable.get(alias);
    assert(entry, `Column reference "${columnRef.table}.${columnName}" uses an unknown table alias.`);

    if (entry.real) {
      assert(
        entry.fields.has(normalizedColumn),
        `Column "${columnName}" does not exist on table "${columnRef.table}".`
      );
    }

    return;
  }

  // Bare column: only allowed when exactly one table is in scope, otherwise
  // there is no safe way to know which table it belongs to.
  assert(
    scope.resolvable.size === 1,
    `Column "${columnName}" is not qualified with a table alias, and more than one table is in scope. Qualify every column when a query touches more than one table.`
  );

  const [[, entry]] = scope.resolvable;
  if (entry.real) {
    assert(
      entry.fields.has(normalizedColumn),
      `Column "${columnName}" does not exist on the table in scope.`
    );
  }
}

function walkExpr(expr, scope, ctx) {
  if (expr === null || expr === undefined) return;
  if (Array.isArray(expr)) {
    expr.forEach((item) => walkExpr(item, scope, ctx));
    return;
  }
  if (typeof expr !== 'object') return;

  // A scalar subquery used as a plain expression operand (e.g. inside
  // arithmetic, not an IN-list) has no `type` field of its own - just
  // { ast, tableList, columnList } - unlike the IN-clause case, which wraps
  // it inside an expr_list. Same tables/columns inside still need validating.
  if (expr.type === undefined && expr.ast) {
    walkSelect(expr.ast, scope.cteNames, ctx);
    return;
  }

  switch (expr.type) {
    case 'column_ref':
      resolveColumnRef(expr, scope);
      return;

    case 'aggr_func':
    case 'window_func': {
      const name = extractFunctionName(expr);
      assert(
        FUNCTION_ALLOW_LIST.has(name),
        `Function "${name || '(unknown)'}" is not allowed.`
      );

      const args = expr.args?.expr_list?.value || expr.args?.value || expr.args?.expr || expr.args;
      walkExpr(args, scope, ctx);

      const spec = expr.over?.as_window_specification?.window_specification;
      if (spec) {
        walkExpr(spec.partitionby?.map((item) => item.expr), scope, ctx);
        walkExpr((spec.orderby || []).map((item) => item.expr), scope, ctx);
      }

      // PERCENTILE_CONT/PERCENTILE_DISC (ordered-set aggregates) carry their
      // ORDER BY here instead of in `args` - without walking it, a column
      // inside WITHIN GROUP (ORDER BY ...) would skip whitelist checking.
      if (Array.isArray(expr.within_group_orderby)) {
        walkExpr(expr.within_group_orderby.map((item) => item.expr), scope, ctx);
      }
      return;
    }

    case 'function': {
      const name = extractFunctionName(expr);
      assert(FUNCTION_ALLOW_LIST.has(name), `Function "${name || '(unknown)'}" is not allowed.`);

      const args = expr.args?.value || expr.args;
      walkExpr(args, scope, ctx);
      return;
    }

    case 'binary_expr':
      walkExpr(expr.left, scope, ctx);
      walkExpr(expr.right, scope, ctx);
      return;

    case 'unary_expr':
      walkExpr(expr.expr, scope, ctx);
      return;

    case 'cast':
      walkExpr(expr.expr, scope, ctx);
      return;

    case 'case':
      walkExpr(expr.expr, scope, ctx);
      (expr.args || []).forEach((clause) => {
        walkExpr(clause.cond, scope, ctx);
        walkExpr(clause.result, scope, ctx);
      });
      return;

    case 'expr_list': {
      const values = Array.isArray(expr.value) ? expr.value : [expr.value];
      values.forEach((item) => {
        if (item && item.ast) {
          walkSelect(item.ast, scope.cteNames, ctx);
        } else {
          walkExpr(item, scope, ctx);
        }
      });
      return;
    }

    case 'select':
      walkSelect(expr, scope.cteNames, ctx);
      return;

    // Literals and simple leaf nodes carry nothing to validate.
    case 'number':
    case 'single_quote_string':
    case 'double_quote_string':
    case 'string':
    case 'bool':
    case 'null':
    case 'param':
    case 'origin':
    case 'star':
      return;

    // INTERVAL '90 days' etc. - a fixed literal duration, not a column
    // reference or function call. Needed for relative date filters.
    case 'interval':
      walkExpr(expr.expr, scope, ctx);
      return;

    default:
      // Fail closed: an expression shape this walker was not written for is
      // rejected rather than passed through unchecked.
      fail(`Unsupported SQL construct in query: "${expr.type}".`);
  }
}

function walkFromEntry(entry, scope, ctx) {
  const subAst = entry.expr?.ast || (entry.expr?.type === 'select' ? entry.expr : null);

  if (subAst) {
    assert(entry.as, 'Every derived subquery in FROM/JOIN must have an alias.');

    const innerScope = walkSelect(subAst, scope.cteNames, ctx);
    scope.resolvable.set(normalizeIdentifier(entry.as), { real: false });
    return innerScope;
  }

  assert(entry.table, 'Could not read a FROM/JOIN table reference.');

  const normalizedTable = normalizeIdentifier(entry.table);
  const alias = normalizeIdentifier(entry.as || entry.table);

  if (scope.cteNames.has(normalizedTable)) {
    scope.resolvable.set(alias, { real: false });
    return null;
  }

  const whitelisted = ctx.context.get(normalizedTable);
  assert(whitelisted, `Table "${entry.table}" is not one of the tables provided for this query.`);

  // The LLM was only given bare physical table names, but the table itself
  // may live outside the default Postgres search_path (see
  // analyticsQueryBuilder.js's qualifiedTable()) - schema-qualify it here so
  // execution resolves the same table the whitelist check just validated.
  entry.db = whitelisted.generatedTable.physical_schema_name || 'public';

  scope.resolvable.set(alias, { real: true, fields: whitelisted.fields });

  // Recorded so the caller can inject the tenant-isolation predicate onto
  // the exact AST node this table belongs to, after validation succeeds.
  ctx.tenantInjections.push({
    selectNode: ctx.currentSelectNode,
    alias,
    generatedTableId: whitelisted.generatedTable.id
  });

  return null;
}

/**
 * Validates one SELECT AST node (top-level query, a CTE body, or a
 * subquery) and everything nested inside it. Returns nothing; throws on any
 * rule violation.
 */
function walkSelect(node, parentCteNames, ctx) {
  assert(isObject(node), 'Expected a SELECT statement.');
  assert(node.type === 'select', `Only SELECT statements are allowed, got "${node.type}".`);
  assert(!node._next && !node.union, 'Set operations (UNION/INTERSECT/EXCEPT) are not supported.');

  const scope = createScope(parentCteNames);
  const previousSelectNode = ctx.currentSelectNode;
  ctx.currentSelectNode = node;

  if (Array.isArray(node.with)) {
    node.with.forEach((cte) => {
      const name = cte?.name?.value;
      assert(name, 'A WITH clause entry is missing a name.');

      walkSelect(cte.stmt, scope.cteNames, ctx);
      scope.cteNames.add(normalizeIdentifier(name));
    });
  }

  (node.from || []).forEach((entry) => {
    walkFromEntry(entry, scope, ctx);
    if (entry.on) walkExpr(entry.on, scope, ctx);
  });

  assert(scope.resolvable.size > 0, 'Query must reference at least one table.');

  (node.columns || []).forEach((column) => {
    walkExpr(column.expr, scope, ctx);
    if (column.as) scope.outputAliases.add(normalizeIdentifier(column.as));
  });
  walkExpr(node.where, scope, ctx);
  walkExpr(node.groupby?.columns, scope, ctx);
  walkExpr(node.having, scope, ctx);
  (node.orderby || []).forEach((item) => walkExpr(item.expr, scope, ctx));

  ctx.currentSelectNode = previousSelectNode;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function quotedLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tenantColumnNode() {
  return { expr: { type: 'default', value: TENANT_COLUMN } };
}

function injectTenantFilters(tenantInjections) {
  // Grouped by AST node reference (not by alias string), since the same
  // alias can legitimately be reused across sibling scopes (a CTE and the
  // outer query can both use "t1").
  const byNode = new Map();

  tenantInjections.forEach(({ selectNode, alias, generatedTableId }) => {
    assert(UUID_PATTERN.test(generatedTableId), 'Resolved generated_table_id is not a valid UUID.');

    if (!byNode.has(selectNode)) byNode.set(selectNode, []);
    byNode.get(selectNode).push({ alias, generatedTableId });
  });

  byNode.forEach((injections, selectNode) => {
    let condition = null;

    injections.forEach(({ alias, generatedTableId }) => {
      const predicate = {
        type: 'binary_expr',
        operator: '=',
        left: { type: 'column_ref', table: alias, column: tenantColumnNode() },
        // The value is our own generated_tables.id, looked up server-side -
        // never LLM/user-controlled - so inlining it as a literal is safe.
        // The UUID format assertion above is defense in depth.
        right: { type: 'origin', value: quotedLiteral(generatedTableId) }
      };

      condition = condition
        ? { type: 'binary_expr', operator: 'AND', left: condition, right: predicate }
        : predicate;
    });

    selectNode.where = selectNode.where
      ? { type: 'binary_expr', operator: 'AND', left: selectNode.where, right: condition }
      : condition;
  });
}

function enforceLimit(ast) {
  const values = ast.limit?.value;

  if (!Array.isArray(values) || values.length === 0) {
    ast.limit = { seperator: '', value: [{ type: 'number', value: DEFAULT_LIMIT }] };
    return;
  }

  const current = Number(values[0]?.value);
  if (!Number.isFinite(current) || current > MAX_LIMIT || current < 1) {
    values[0] = { type: 'number', value: MAX_LIMIT };
  }
}

/**
 * Validates a raw SQL string against the project's physical-table whitelist,
 * injects tenant-isolation filters and a row limit, and returns the SQL text
 * ready to execute. Throws (statusCode 422) on any violation.
 */
function validateSqlPlan(sql, context) {
  assert(typeof sql === 'string' && sql.trim().length > 0, 'SQL query is empty.');

  const trimmed = sql.trim().replace(/;+\s*$/, '');
  assert(!trimmed.includes(';'), 'Only a single SQL statement is allowed.');

  let ast;
  try {
    ast = parser.astify(trimmed, { database: 'postgresql' });
  } catch (error) {
    fail(`SQL failed to parse: ${error.message}`);
  }

  assert(!Array.isArray(ast), 'Only a single SQL statement is allowed.');
  assert(ast.type === 'select', `Only SELECT statements are allowed, got "${ast.type}".`);

  const ctx = { context, tenantInjections: [], currentSelectNode: null };

  walkSelect(ast, new Set(), ctx);

  injectTenantFilters(ctx.tenantInjections);
  enforceLimit(ast);

  const text = parser.sqlify(ast, { database: 'postgresql' });

  return { text, values: [] };
}

module.exports = {
  buildPhysicalContext,
  validateSqlPlan
};

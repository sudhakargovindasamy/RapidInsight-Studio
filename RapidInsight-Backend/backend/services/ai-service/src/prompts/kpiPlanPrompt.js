const {
  compactSchemas
} = require("./schemaCompaction");

// Step 3 of the multi-step pipeline: decide what each requested KPI means
// against a data model that is already settled.
//
// The one-shot prompt asked for KPI feasibility at the same time as key
// discovery and dashboard formatting, so the model had to guess at joins it
// had only just invented. Here the relationships arrive as fact, which turns
// "is this KPI possible" into a lookup instead of a second inference.
//
// The output is deliberately plain: a table, a column, an operation, a
// dimension. Formatting into the strict dashboard contract is step 4's job,
// so nothing here competes with business reasoning.

function formatFieldLine(field) {
  const flags = [];

  if (field.primaryKey) flags.push("PK");
  if (field.unique) flags.push("UNIQUE");

  const suffix = flags.length ? ` [${flags.join(", ")}]` : "";

  return `  - ${field.name} (${field.type})${suffix}`;
}

function formatTableBlock(schema, tableTypesByName) {
  const tableType = tableTypesByName.get(schema.table_name);
  const typeLabel = tableType ? ` [${tableType}]` : "";

  return `TABLE: ${schema.table_name}${typeLabel}\n${schema.fields.map(formatFieldLine).join("\n")}`;
}

function formatRelationships(relationships) {
  if (!Array.isArray(relationships) || relationships.length === 0) {
    return "(none - every KPI must stay inside a single table)";
  }

  return relationships
    .map(
      (relationship) =>
        `  - ${relationship.from_table}.${relationship.from_column} -> ` +
        `${relationship.to_table}.${relationship.to_column} (${relationship.relationship_type})`
    )
    .join("\n");
}

function formatRequests(requests) {
  return requests.map((request, index) => `${index + 1}. ${request}`).join("\n");
}

function buildKpiPlanPrompt({ schemas, relationshipModel, requests } = {}) {
  const compactedSchemas = compactSchemas(schemas);

  const tableTypesByName = new Map(
    (relationshipModel?.tables || []).map((table) => [
      table.table_name,
      table.table_type
    ])
  );

  const relationships = relationshipModel?.relationships || [];

  return `You are a business analyst. Decide how to answer each requested metric using the tables below.

DATA MODEL

${compactedSchemas.map((schema) => formatTableBlock(schema, tableTypesByName)).join("\n\n")}

RELATIONSHIPS (already confirmed - treat these as the only ways to join)

${formatRelationships(relationships)}

REQUESTED METRICS

${formatRequests(requests)}

YOUR TASK

For each requested metric, work out how it would actually be calculated, then report your plan for it.

Decide:

1. base_table - the table holding the rows being measured. For money or quantity metrics this is normally the most detailed table that contains the amount column.
2. measure_column - the numeric column being aggregated, or null when counting rows.
3. operation - one of: count, sum, avg, min, max.
   - sum for totals such as revenue or quantity.
   - avg for averages such as average order value, and for a rate or percent that is already stored per row.
   - count for how many rows, with measure_column null.
   - min or max only when the request asks for a single smallest or largest value on its own, such as "highest single order value". Do not use max for a "top N" request.
4. group_by_table and group_by_column - the dimension the metric is broken down by, such as a product name or a region. Use null for both when the metric is a single number with no breakdown.
5. ratio_column - only for margins, rates, and shares that divide one stored column by another. This is the denominator column, so a metric stored as measure_column = profit with ratio_column = revenue is profit divided by revenue. Use null otherwise.
6. difference_table, difference_column, difference_as_percentage - for a metric that subtracts one column from another. See DIFFERENCE MEASURES below. Use null when nothing is subtracted.
7. sort_direction - "desc" for top or highest, "asc" for bottom or lowest, null when there is no ranking.
8. limit - how many rows to return for a ranked metric, such as 10 for "top 10". Use null when there is no ranking.
9. status - can this be answered with the tables and relationships above?
   - "executable" when every column it needs exists and any join it needs is in the relationship list.
   - "unsupported" when a required column or relationship does not exist.
10. reason - one plain sentence explaining your choice, or explaining what is missing when unsupported.
11. business_value - one plain sentence on what a business would learn from this metric.

RANKING REQUESTS

"Top N <things> by <measure>" and "Best/worst <things> by <measure>" are rankings, not single numbers. A ranking always needs a group_by, because the answer is a list of things, not one value.

For "Top 10 products by revenue":
  group_by_column = the product name column   (NOT null)
  measure_column  = the revenue column
  operation       = sum
  sort_direction  = "desc"
  limit           = 10

The same shape applies to "Top 10 products by margin percent", where the measure is the margin column and the operation is avg, because a percent already stored per row is averaged across the rows of each product, never summed.

Never answer a "top N" request with max and a null group_by. That returns one number and throws away the list the user asked for.

Use a null group_by only when the request really is one number for the whole business, such as "total revenue" or "average order value".

DIFFERENCE MEASURES

Some metrics are not a stored column at all. They are the gap between two columns. Recognise the shape of the request, not particular business words.

Shape 1 - "A minus B", reported in the unit of the columns themselves:
  measure_column   = A, the value being subtracted FROM
  difference_column = B, the value being subtracted
  difference_table = the table holding B, or null when B sits on the base_table
  difference_as_percentage = null

  Both columns must be numeric, or both must be dates. Never mix the two.
  Two numeric columns give an amount. Two date columns give a duration in days.

  "Profit per order"           -> measure_column = the price column, difference_column = the cost column
  "Average length of stay"     -> measure_column = the discharge date, difference_column = the admission date
  "Average time to deliver"    -> measure_column = the delivery date, difference_column = the order date

Shape 2 - "A minus B, as a percent of A", reported as a percentage:
  the same three fields as above, plus difference_as_percentage = true
  Only valid for two numeric columns. A percentage of a duration is not meaningful.

  "Profit percentage per product"   -> measure_column = the price column, difference_column = the cost column, difference_as_percentage = true
  "Out-of-pocket percentage"        -> measure_column = the billed amount, difference_column = the amount insurance paid, difference_as_percentage = true

Telling difference from ratio:
- Use difference_column when the metric is one column TAKEN AWAY FROM another. The subtraction is the whole point.
- Use ratio_column when the metric divides two columns that each mean something on their own, such as returns divided by orders.
- A request worded as a percentage is a difference percentage only when the numerator is itself a subtraction. "Profit percentage" is a difference, because profit is price minus cost. "Return rate" is a ratio, because returns is a column of its own.
- Never set both ratio_column and difference_column on the same metric.

JOIN RULES

- A metric may use its base_table plus at most ONE other table, and only if a relationship above directly connects them.
- A difference_table counts against that one other table, exactly like a group_by_table does. A metric that needs its dimension on one table and its difference_column on a different table is asking for two joins, so mark it "unsupported".
- If the dimension you want sits two or more joins away, mark the metric "unsupported" and say which relationship is missing. Do not substitute a different column to make it work.
- If a metric only needs one table, that is fine and preferred.

CHOOSING COLUMNS

- Use only column names exactly as spelled above. Never invent or rename a column.
- The measure_column must be numeric for sum, avg, min, and max. The one exception is a date difference, where measure_column and difference_column are both dates and the aggregate applies to the duration between them.
- Prefer the column that most directly represents the metric. For revenue prefer an explicit revenue or amount column over multiplying other columns.
- If several columns could work, pick one and say why in the reason.
- Never silently replace a requested metric with an easier one. Mark it unsupported instead.

OUTPUT FORMAT

Return exactly one valid JSON object with this shape and no other properties:

{
  "plans": [
    {
      "request": "the requested metric, copied exactly",
      "status": "executable | unsupported",
      "reason": "one sentence",
      "business_value": "one sentence",
      "base_table": "table name or null",
      "measure_column": "column name or null",
      "operation": "count | sum | avg | min | max, or null when unsupported",
      "group_by_table": "table name or null",
      "group_by_column": "column name or null",
      "ratio_column": "column name or null",
      "difference_table": "table name or null",
      "difference_column": "column name or null",
      "difference_as_percentage": "true or null",
      "sort_direction": "asc | desc | null",
      "limit": 10
    }
  ]
}

Return one plan object for every requested metric, in the same order, even when unsupported.
Return only the JSON object. No markdown, no explanation, no SQL.`;
}

// Repair keeps the accepted plans and asks only for the broken one to change,
// which stops a small model from rewriting work that already passed.
function buildKpiPlanRepairPrompt(basePrompt, errorMessage, rejectedResponse) {
  const rejected =
    typeof rejectedResponse === "string"
      ? rejectedResponse
      : JSON.stringify(rejectedResponse, null, 2);

  return `${basePrompt}

PREVIOUS ATTEMPT WAS REJECTED

You returned this JSON:

${rejected}

It was rejected for this reason:

${errorMessage}

Fix only what the rejection reason describes. Keep every other plan exactly as it was. Return the complete corrected JSON object.`;
}

module.exports = {
  buildKpiPlanPrompt,
  buildKpiPlanRepairPrompt,
};

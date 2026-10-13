function compactProject(project) {
  if (!project || typeof project !== "object") return null;

  return {
    id: project.id || null,
    name: project.name || project.project_name || null,
  };
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

function normalizeCustomKpis(customKpis) {
  const clean = (value) =>
    String(value || "")
      .replace(/\t+/g, " - ")
      .replace(/\s+/g, " ")
      .trim();

  if (Array.isArray(customKpis)) {
    return customKpis.map(clean).filter(Boolean);
  }

  if (typeof customKpis === "string") {
    return customKpis
      .split(/\r?\n|,(?=\s*[A-Za-z])/)
      .map(clean)
      .filter(Boolean);
  }

  return [];
}

function formatCustomKpis(customKpis) {
  const list = normalizeCustomKpis(customKpis);
  if (!list.length) return null;

  return list.map((kpi, index) => `${index + 1}. ${kpi}`).join("\n");
}

function buildDataModelBlueprintPrompt(input = {}) {
  const customKpis =
    input.custom_kpis || input.customKpis || input.custom_metrics;

  const customKpiList = normalizeCustomKpis(customKpis);
  const hasCustomKpis = customKpiList.length > 0;

  const safeInput = {
    project: compactProject(input.project),
    schemas: compactSchemas(input.schemas),
    requested_analytics: customKpiList,
  };

  const customKpisFormatted = formatCustomKpis(customKpis);

  const dashboardInstructions = customKpisFormatted
    ? `USER-REQUESTED ANALYTICS\n\nThe user requested only these analytics:\n${customKpisFormatted}\n\nCUSTOM REQUEST RULES\n\n- Create dashboard objects only for these requests.\n- Do not add default or unrelated KPIs or charts.\n- Record every request exactly once in requested_analysis.\n- Link every generated KPI or chart from exactly one executable requested_analysis.dashboard_object_ids array.\n- If a request is unsupported or needs clarification, do not generate a dashboard object for it.\n- Use executable only when every required source column exists and the operation is supported.\n- Use needs_clarification when required data exists but the business rule is unclear.\n- Use unsupported when required data, a reliable relationship, or execution capability is missing.\n- If no request is executable, return empty dashboard.kpis and dashboard.charts.\n- One unsupported request must not block other executable requests.`
    : `AUTOMATIC ANALYTICS\n\nCreate 3 to 6 executable KPIs and 2 to 6 executable charts using only supplied schema metadata. requested_analysis must be an empty array.`;

  return `You are RapidInsight Studio's domain-agnostic data-model and dashboard planner.

Return exactly one complete valid JSON object.
Return no markdown, explanation, SQL, code, commands, or data rows.

OUTPUT RESPONSIBILITY

The backend already owns the complete uploaded schemas.
Use supplied fields for reasoning, key discovery, relationship discovery, KPI feasibility, and dashboard planning.
Do not reproduce complete schemas or complete field lists.

The response must contain exactly these top-level properties:
- tables
- relationships
- requested_analysis
- dashboard

SOURCE-OF-TRUTH RULES

- Use every supplied schema_id exactly once.
- Return exactly one compact table object per supplied schema.
- Preserve every supplied table_name exactly.
- Never invent a table, column, key, relationship, filter value, or data value.
- If a supplied column is referenced anywhere, preserve its name exactly.
- All generated IDs must be lowercase snake_case and at most 63 characters.
- KPI IDs must start with kpi_.
- Chart IDs must start with chart_.

COMPACT TABLE CONTRACT

Every table object must use exactly these properties:
{
  "schema_id": "provided_schema_id",
  "table_name": "provided_table_name",
  "table_type": "fact",
  "primary_key": "existing_key_column",
  "primary_key_source": "supplied",
  "unique_keys": [],
  "foreign_keys": []
}

Never return table.columns.
Never return display_name, field definitions, complete column lists, column role metadata, references metadata, generation metadata, or synthetic-data instructions.

Allowed table_type values:
- fact
- dimension
- bridge
- reference

PRIMARY KEY RULES

- Every table must contain exactly one primary_key string.
- The primary_key must be an existing column from that supplied schema.
- If the schema explicitly marks a primary key, use that exact column and set primary_key_source to supplied.
- Never replace an explicitly supplied primary key.
- If no primary key is explicitly supplied, infer the most reliable existing identifier and set primary_key_source to inferred.
- Never invent a key column.

When inference is required, prefer in this order:
1. A unique, non-null identifier column.
2. A unique column ending in _id.
3. A table-specific identifier such as product_id for a products table.
4. Another reliable existing identifier column.

Do not infer descriptive columns such as name, title, description, label, notes, or address as primary keys unless the schema explicitly marks them as primary keys.

UNIQUE KEY RULES

- unique_keys must be an array of existing column names.
- Include every explicitly supplied unique column except the selected primary_key.
- Infer another unique key only when supplied metadata gives strong evidence that it is unique.
- Never treat a column as unique only because its name looks unique.
- Do not repeat primary_key inside unique_keys.
- Return an empty array when no additional reliable unique key exists.
- Exception: if a returned relationship targets a parent column that is not that table's primary_key, that column must be listed in the parent table's unique_keys. A relationship target is always treated as strong evidence of uniqueness.

FOREIGN KEY RULES

- foreign_keys must be an array of existing column names.
- Include exactly the columns used as from_column by returned top-level relationships.
- foreign_keys and relationships must agree in both directions.
- Every column listed in a table's foreign_keys must appear as the from_column of at least one returned top-level relationship whose from_table is that table.
- If you list a foreign key but return no relationship that uses it, either add the missing relationship or remove that column from foreign_keys.
- Do not include unrelated identifier columns.
- Do not repeat primary_key inside foreign_keys.
- Return an empty array when no reliable foreign key relationship exists.

STRICT RELATIONSHIP OUTPUT CONTRACT

Every relationship object must use exactly these keys:
{
  "from_table": "existing_child_table",
  "from_column": "existing_foreign_key_column",
  "to_table": "existing_parent_table",
  "to_column": "existing_primary_or_unique_key",
  "relationship_type": "many_to_one"
}

Allowed relationship_type values:
- one_to_one
- one_to_many
- many_to_one
- many_to_many

RELATIONSHIP RULES

- Relationship tables and columns must exist in the supplied schemas.
- from_column must appear in the child table's foreign_keys array.
- to_column must equal the target table's primary_key or appear in its unique_keys array.
- Before returning a relationship, confirm its to_column satisfies that rule. If the needed to_column is not the parent's primary_key, add that column to the parent table's unique_keys array in the same response.
- If a join target cannot legally be the parent's primary_key or a unique key, remove the relationship and its foreign_keys entry instead of returning it.
- Relationship columns must have compatible supplied types.
- Foreign-key direction is child.from_column to parent.to_column.
- Prefer matching identifier columns, such as product_id to product_id.
- Never join an identifier to a name, display_name, title, description, label, notes, or other free-text field.
- Never create a relationship without reliable existing matching columns.
- Avoid duplicate, reversed, mutual, and circular relationships.

SCHEMA ANALYSIS OBJECTIVES

1. Classify each table as fact, dimension, bridge, or reference.
2. Use supplied primary keys when present.
3. Infer a primary key only when one is not supplied.
4. Identify reliable unique keys.
5. Identify foreign keys used by relationships.
6. Discover reliable relationships.
7. Determine KPI feasibility.
8. Build dashboard KPIs and charts.

Do not generate dependency_order, join_paths, query_plans, graph traversal instructions, SQL, or synthetic-data instructions.
Backend services will build relationship graphs, join paths, query plans, and SQL.

${dashboardInstructions}

REQUESTED ANALYSIS CONTRACT

For each user request, return one requested_analysis object containing:
- id
- request
- status
- reason
- required_tables
- required_columns
- required_relationships
- required_calculations
- missing_requirements
- assumptions
- dashboard_object_ids
- query_intent
- dashboard_recommendation

Allowed status values:
- executable
- needs_clarification
- unsupported

Every required_columns item must use:
{
  "table_name": "existing_table",
  "column": "existing_column",
  "purpose": "measure"
}

Every required_relationships item must use from_table, from_column, to_table, and to_column. Do not use relationship IDs or strings.

Every query_intent must use:
{
  "business_goal": "Short description of the business question",
  "analysis_type": "ranking",
  "aggregation_required": true,
  "dimension_required": true,
  "time_based": false
}

Allowed analysis_type values:
- ranking
- trend
- comparison
- distribution
- aggregation

Use ranking for top, bottom, highest, lowest, best, worst, or ordered results.
Use trend for change over time.
Use comparison for comparisons across categories or entities.
Use distribution for spread across categories or ranges.
Use aggregation for totals, counts, averages, minimums, maximums, or summaries without ranking or trend.

requested_analysis rules:
- Every user request must appear exactly once.
- required_tables must contain only supplied table names.
- required_columns must contain only existing supplied columns.
- required_relationships must match top-level relationships.
- required_calculations, missing_requirements, assumptions, and dashboard_object_ids must be arrays.
- executable requires at least one dashboard object ID and an empty missing_requirements array.
- needs_clarification requires assumptions and no dashboard object IDs.
- unsupported requires missing_requirements and no dashboard object IDs.
- Never silently ignore, replace, or simplify a request.

DASHBOARD RECOMMENDATION CONTRACT

Every executable requested_analysis item must contain:
{
  "base_table": "existing_table",
  "measure": {
    "table": "existing_table",
    "column": "existing_numeric_column_or_null_for_count",
    "operation": "sum"
  },
  "group_by": {
    "table": "existing_table",
    "column": "existing_dimension_column"
  },
  "filters": [],
  "sort": {
    "column": "existing_column",
    "direction": "desc"
  },
  "limit": 10,
  "chart_type": "bar"
}

FILTER CONTRACT

filters must always be an array.
Each filter must use exactly:
{
  "table": "existing_table",
  "column": "existing_column",
  "operator": "eq",
  "value": "requested_value"
}

Allowed filter operators:
- eq
- neq
- gt
- gte
- lt
- lte
- in
- not_in
- between
- contains
- starts_with
- ends_with
- is_null
- is_not_null

Never invent a filter value.
Use null for is_null and is_not_null.
Use an array for in, not_in, and between.
For between, provide exactly two values.

DASHBOARD CONTRACT

Allowed operations:
- count
- sum
- avg
- min
- max

Allowed chart types:
- bar
- line
- pie
- doughnut

Allowed KPI formats:
- number
- decimal
- currency
- percentage

Allowed sort values:
- asc
- desc

RATIO MEASURES

A KPI or chart may divide two aggregates instead of returning a single total.
Use this for margins, rates, shares, and averages-of-totals.

Add an optional ratio object to the KPI or chart:
{
  "ratio": {
    "operation": "sum",
    "column": "existing_numeric_denominator_column",
    "scale": 100
  }
}

Ratio rules:
- The result is column/operation divided by ratio.column/ratio.operation.
- Both columns must be existing numeric columns on the same table_name.
- Neither operation may be count.
- Use scale 100 to express the result as a percentage, otherwise use 1.
- Use format "percentage" only with scale 100.
- Example: profit margin is column estimated_profit_amount with ratio column item_total and scale 100.
- Omit ratio entirely for a plain total.

DASHBOARD FILTERS

A KPI or chart may exclude rows with an optional filters array using the FILTER CONTRACT above.

Filter rules:
- filters must be an array; omit it or use [] when no exclusion is needed.
- At most 10 filters per object.
- Each filter.table must be the object's own table_name or the single connected table already used by group_by_table.
- All filters and group_by_table together may reference at most one other table.
- Never invent a filter value. Only use values the user explicitly requested.

Rules:
- count may use column = null.
- Other operations require an existing numeric column.
- format "percentage" requires a ratio measure, or an avg, min, or max operation. Never use percentage with sum or count.
- A KPI or chart may use multiple tables when top-level relationships connect them.
- group_by may exist in the base table or in a connected table.
- time_bucket must be null unless group_by is a date.
- A date time_bucket must be day, month, or year.
- Chart limit must be from 1 to 20.
- Custom mode allows 0 to 6 KPIs and 0 to 6 charts.
- Automatic mode requires 3 to 6 KPIs and 2 to 6 charts.

OUTPUT EXAMPLE

{
  "tables": [
    {
      "schema_id": "provided_schema_id",
      "table_name": "provided_table_name",
      "table_type": "fact",
      "primary_key": "existing_key_column",
      "primary_key_source": "supplied",
      "unique_keys": [],
      "foreign_keys": ["existing_foreign_key_column"]
    }
  ],
  "relationships": [
    {
      "from_table": "existing_child_table",
      "from_column": "existing_foreign_key_column",
      "to_table": "existing_parent_table",
      "to_column": "existing_primary_or_unique_key",
      "relationship_type": "many_to_one"
    }
  ],
  "requested_analysis": [],
  "dashboard": {
    "version": 1,
    "title": "Generated Dashboard",
    "subtitle": "Analysis Based On Available Data",
    "domain": "data_analytics",
    "kpis": [],
    "charts": [],
    "layout": {
      "kpi_columns": 4,
      "chart_columns": 2
    }
  }
}

FINAL CHECK
KPI OBJECT CONTRACT

Every KPI must use exactly:

{
  "id": "kpi_revenue",
  "name": "Revenue",
  "operation": "sum",
  "table_name": "existing_table",
  "column": "existing_numeric_column",
  "format": "currency"
}

Never include:

- value
- values
- data
- result
- results
- calculated_output
- sample_numbers

The backend computes KPI values later.
The AI must only describe how the KPI should be calculated.
DASHBOARD KPI CONTRACT

Every KPI must use exactly:

{
  "id": "kpi_x",
  "name": "Revenue",
  "operation": "sum",
  "table_name": "existing_table",
  "column": "existing_numeric_column",
  "format": "currency"
}

Never return:
- value
- values
- result
- results
- calculated numbers

Before returning, verify:
- Exactly one compact table object exists per supplied schema.
- No table contains columns or a complete source field list.
- Every primary_key, unique key, and foreign key exists in its uploaded schema.
- Every supplied primary key is preserved.
- Every relationship uses existing, type-compatible columns.
- Every relationship from_column is listed in foreign_keys.
- Every column listed in foreign_keys is used as the from_column of a returned relationship.
- Every relationship to_column is a target primary_key or unique key.
- Every analytical column reference exists in the uploaded schemas.
- No generation metadata exists.
- No SQL exists.
- The result is valid JSON.
STRICT REQUESTED_ANALYSIS OBJECT EXAMPLE

Every requested_analysis entry MUST follow this exact structure.

{
  "id": "request_top_products",
  "request": "Top 10 products by revenue",
  "status": "executable",
  "reason": "Revenue can be calculated from item_total grouped by item_name.",
  "required_tables": [
    "analysis_item_level_sales",
    "analysis_items"
  ],
  "required_columns": [
    {
      "table_name": "analysis_item_level_sales",
      "column": "item_total",
      "purpose": "measure"
    },
    {
      "table_name": "analysis_items",
      "column": "item_name",
      "purpose": "dimension"
    }
  ],
  "required_relationships": [],
  "required_calculations": [],
  "missing_requirements": [],
  "assumptions": [],
  "dashboard_object_ids": [
    "kpi_top_products",
    "chart_top_products"
  ],
  "query_intent": {
    "business_goal": "Identify highest revenue products",
    "analysis_type": "ranking",
    "aggregation_required": true,
    "dimension_required": true,
    "time_based": false
  },
  "dashboard_recommendation": {
    "base_table": "analysis_item_level_sales",
    "measure": {
      "table": "analysis_item_level_sales",
      "column": "item_total",
      "operation": "sum"
    },
    "group_by": {
      "table": "analysis_items",
      "column": "item_name"
    },
    "filters": [],
    "sort": {
      "column": "item_total",
      "direction": "desc"
    },
    "limit": 10,
    "chart_type": "bar"
  }
}
  MANDATORY DEFAULTS

For every executable dashboard_recommendation:

- limit must always be an integer.
- If no natural limit exists use:
  "limit": 10

- chart_type must always be:
  bar
  line
  pie
  doughnut

- Never use:
  scatter
  area
  bubble
  radar
  heatmap

For every dashboard chart:

- sort must always be:
  asc
  or
  desc

- Never use null sort.

- limit must always be between 1 and 20.

- If unsure use:
  "sort": "desc"
  "limit": 10

STRICT KPI OBJECT CONTRACT

Every dashboard KPI MUST use exactly:

{
  "id": "kpi_total_revenue",
  "name": "Total Revenue",
  "operation": "sum",
  "table_name": "analysis_item_level_sales",
  "column": "item_total",
  "format": "currency"
}

Valid operation values:
- count
- sum
- avg
- min
- max

Valid format values:
- number
- decimal
- currency
- percentage

Never return:
- value
- values
- result
- results
- calculated_output
- sample_numbers
- dashboard_values

The backend computes KPI values later.

STRICT CHART OBJECT CONTRACT

Every dashboard chart MUST use exactly:

{
  "id": "chart_revenue_by_product",
  "name": "Revenue By Product",
  "type": "bar",
  "operation": "sum",
  "table_name": "analysis_item_level_sales",
  "column": "item_total",
  "group_by": "item_name",
  "group_by_table": "analysis_items",
  "sort": "desc",
  "limit": 10,
  "time_bucket": null
}

Valid operation values:
- count
- sum
- avg
- min
- max

Valid chart types:
- bar
- line
- pie
- doughnut

Valid sort values:
- asc
- desc

Chart limit must be between 1 and 20.

A chart may additionally include the optional "ratio" and "filters" fields
described in RATIO MEASURES and DASHBOARD FILTERS. A margin chart looks like:

{
  "id": "chart_profit_margin",
  "name": "Top Products By Profit Margin",
  "type": "bar",
  "operation": "sum",
  "table_name": "analysis_item_level_sales",
  "column": "estimated_profit_amount",
  "ratio": { "operation": "sum", "column": "item_total", "scale": 100 },
  "filters": [
    { "table": "analysis_item_level_sales", "column": "item_total", "operator": "gt", "value": 0 }
  ],
  "group_by": "item_name",
  "group_by_table": "analysis_items",
  "sort": "desc",
  "limit": 10,
  "time_bucket": null
}

Never return:
- data
- labels
- datasets
- chart_data
- chart_values
- rendered_results
- calculated_values

The backend generates chart results later.

LINKING RULES

For every executable requested_analysis:

- dashboard_object_ids must contain at least one KPI or chart ID.
- Every dashboard_object_ids value must exist in dashboard.kpis or dashboard.charts.
- Every dashboard KPI and chart must be linked from exactly one requested_analysis entry.

FINAL RESPONSE RULES

dashboard.kpis and dashboard.charts describe HOW analytics should be calculated.

dashboard.kpis and dashboard.charts MUST NEVER contain:
- values
- results
- sample output
- data arrays
- labels
- datasets
- rendered chart data

Return only metadata and calculation definitions.

The backend will calculate KPI values and chart data later.

Before returning verify:

- Every requested_analysis object contains:
  id
  request
  status
  reason
  required_tables
  required_columns
  required_relationships
  required_calculations
  missing_requirements
  assumptions
  dashboard_object_ids
  query_intent
  dashboard_recommendation

- Every KPI contains:
  id
  name
  operation
  table_name
  column
  format

- Every chart contains:
  id
  name
  type
  operation
  table_name
  column
  group_by
  group_by_table
  sort
  limit
  time_bucket

- No KPI contains a value field.
- No chart contains a data field.

CUSTOM ANALYTICS SUPPLIED: ${hasCustomKpis ? "yes" : "no"}
CUSTOM ANALYTICS COUNT: ${customKpiList.length}

INPUT METADATA:
${JSON.stringify(safeInput)}`.trim();
}

function serializePreviousBlueprint(previousBlueprint) {
  if (!previousBlueprint) return null;

  try {
    return typeof previousBlueprint === "string"
      ? previousBlueprint
      : JSON.stringify(previousBlueprint);
  } catch (error) {
    return null;
  }
}

function buildBlueprintRepairPrompt(basePrompt, rejectionReason, previousBlueprint) {
  const previousJson = serializePreviousBlueprint(previousBlueprint);

  // Without the rejected response the model regenerates from scratch and, at
  // temperature 0, reproduces the same mistake. Repair requires the prior JSON.
  const previousSection = previousJson
    ? `YOUR PREVIOUS RESPONSE

${previousJson}

`
    : "";

  return `${basePrompt}

PREVIOUS ATTEMPT REJECTED

${previousSection}Strict backend validation rejected that response for this reason:
${rejectionReason}

REPAIR RULES

- Start from your previous response and change only what is needed to fix the reported problem.
- Return the complete corrected JSON object, not a fragment or a description of the change.
- Do not invent tables, columns, keys, relationships, filter values, or data values to satisfy the validator.
- Keep every other part of the response that was already correct.

RESOLVING COMMON REJECTIONS

- Unused foreign key: add the missing relationship that uses it, or remove that column from foreign_keys.
- to_column does not reference the parent primary_key or unique_keys: change to_column to the parent's primary_key, or add that column to the parent table's unique_keys, or remove the relationship and its foreign_keys entry.
- from_column is not listed in foreign_keys: add the column to the child table's foreign_keys, or remove the relationship.
- group_by_table has no relationship to the chart table: add the connecting relationship, or group by a column in the chart's own table.
- Column must be numeric: choose a numeric column for that operation, or switch the operation to count.
- Incompatible join types: join columns of the same type family, or remove the relationship.

Re-check the full verification list before returning.`.trim();
}

module.exports = {
  buildDataModelBlueprintPrompt,
  buildBlueprintRepairPrompt,
  compactSchemas,
  normalizeCustomKpis,
};

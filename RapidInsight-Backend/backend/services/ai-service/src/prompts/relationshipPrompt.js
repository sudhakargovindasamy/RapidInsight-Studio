const {
  compactSchemas
} = require("./schemaCompaction");

// Step 1 of the multi-step pipeline: keys and relationships only.
//
// The one-shot blueprint prompt asks the model to infer the data model, triage
// KPI feasibility, and format a large dashboard contract in a single response.
// Small models spend their attention on format compliance and guess badly at
// relationships. This prompt does one job, so the whole budget goes to key
// discovery.
//
// The schema block is placed before the rules on purpose: with a long rule
// list the data ends up far from the instructions that use it, and smaller
// models lose track of it.

function formatFieldLine(field) {
  const flags = [];

  if (field.primaryKey) flags.push("PRIMARY KEY");
  if (field.unique) flags.push("UNIQUE");
  if (field.notNull) flags.push("NOT NULL");

  const suffix = flags.length ? ` [${flags.join(", ")}]` : "";

  return `  - ${field.name} (${field.type})${suffix}`;
}

function formatSchemaBlock(schema, index) {
  const header = `TABLE ${index + 1}: ${schema.table_name}\nschema_id: ${schema.schema_id}\ncolumns:`;

  return `${header}\n${schema.fields.map(formatFieldLine).join("\n")}`;
}

// A readable table listing beats raw JSON here: the model has to compare column
// names across tables to spot foreign keys, and a flat list makes those matches
// visible.
function formatSchemas(schemas) {
  return schemas.map(formatSchemaBlock).join("\n\n");
}

function buildRelationshipPrompt(input = {}) {
  const schemas = compactSchemas(input.schemas);

  return `You are a database modeling expert. Your only job in this task is to identify primary keys and relationships between the tables below.

UPLOADED TABLES

${formatSchemas(schemas)}

YOUR TASK

For each table decide:
1. table_type - one of: fact, dimension, bridge, reference.
   - fact: rows are events or transactions, usually with numeric measures and several foreign keys.
   - dimension: rows are entities being described, such as customers, products, or stores.
   - bridge: rows exist only to connect two other tables in a many-to-many relationship.
   - reference: small lookup lists such as status codes or country codes.
2. primary_key - the column that uniquely identifies a row.
   - If a column is marked PRIMARY KEY above, use it and set primary_key_source to "supplied".
   - Otherwise pick the most likely unique identifier and set primary_key_source to "inferred".
3. unique_keys - other columns that uniquely identify a row. Every column marked UNIQUE above must appear here unless it is already the primary_key. Use an empty array if there are none.
4. foreign_keys - columns in this table that point at another table's primary_key or unique key. Use an empty array if there are none.

Then list every relationship between tables.

HOW TO FIND RELATIONSHIPS

- A foreign key usually repeats the referenced table's key column name, for example customer_id in a sales table pointing at customer_id in a customers table.
- The two joined columns must hold the same kind of value. Never join a text column to a numeric column, or a date column to an id column.
- The target column must be the other table's primary_key or one of its unique_keys. Never point a relationship at an ordinary non-unique column.
- Only create a relationship you can justify from the column names and types above. A missing relationship is better than an invented one.
- Do not repeat a relationship in reverse. Report each table pair connection once.

RELATIONSHIP TYPES

- one_to_many: one row in the target table matches many rows in this table. This is the common case for a fact table pointing at a dimension.
- many_to_one: many rows here match one row in the target table.
- one_to_one: each row matches at most one row in the other table.
- many_to_many: only when a bridge table connects the two sides.

RULES

- Use table names and column names exactly as spelled above. Do not rename, re-case, or pluralize them.
- Every column you list in foreign_keys must be used by exactly one relationship, and every relationship's from_column must appear in that table's foreign_keys.
- Return one entry in "tables" for every table listed above, no more and no fewer.
- Do not return the column list back. Only return the keys and relationships described below.

OUTPUT FORMAT

Return exactly one valid JSON object with this shape and no other properties:

{
  "tables": [
    {
      "schema_id": "the schema_id given above",
      "table_name": "exact table name",
      "table_type": "fact | dimension | bridge | reference",
      "primary_key": "column name",
      "primary_key_source": "supplied | inferred",
      "unique_keys": ["column name"],
      "foreign_keys": ["column name"]
    }
  ],
  "relationships": [
    {
      "from_table": "table holding the foreign key",
      "from_column": "foreign key column",
      "to_table": "table holding the referenced key",
      "to_column": "primary_key or unique key column",
      "relationship_type": "one_to_one | one_to_many | many_to_one | many_to_many"
    }
  ]
}

Return only the JSON object. No markdown, no explanation, no SQL.`;
}

// Repair asks for a targeted fix. Resending the full prompt with only an error
// appended tends to make small models rewrite the parts that were already
// correct, so the rejected JSON and the specific complaint lead here.
function buildRelationshipRepairPrompt(basePrompt, errorMessage, rejectedResponse) {
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

Fix only what the rejection reason describes. Keep every other part of your previous answer exactly as it was. Return the complete corrected JSON object.`;
}

module.exports = {
  buildRelationshipPrompt,
  buildRelationshipRepairPrompt,
};

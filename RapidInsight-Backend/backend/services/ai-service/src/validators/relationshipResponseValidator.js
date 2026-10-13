const {
  buildSourceSchemaMaps,
  validateTables,
  validateRelationships,
  logBlueprint,
} = require("./blueprintResponseValidator");

// Step 1 returns only the key and relationship half of a blueprint, so it is
// checked with the same table and relationship rules the one-shot response
// goes through. Reusing those functions keeps a single definition of what a
// valid data model is: a relationship accepted here is accepted later.

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

function validateRelationshipResponse(response, schemas) {
  logBlueprint("RAW RELATIONSHIP RESPONSE", response);

  assert(isObject(response), "Relationship response must be a JSON object.");

  const allowedTopLevelProperties = new Set(["tables", "relationships"]);

  Object.keys(response).forEach((property) => {
    assert(
      allowedTopLevelProperties.has(property),
      `relationships.${property} is not allowed. Return only tables and relationships.`
    );
  });

  allowedTopLevelProperties.forEach((property) => {
    assert(
      response[property] !== undefined,
      `relationships.${property} is required.`
    );
  });

  const sourceMaps = buildSourceSchemaMaps(schemas);
  const blueprintTableMap = validateTables(response.tables, sourceMaps);

  validateRelationships(response.relationships, blueprintTableMap);

  logBlueprint("VALIDATED RELATIONSHIP RESPONSE", response);

  return true;
}

module.exports = {
  validateRelationshipResponse,
};
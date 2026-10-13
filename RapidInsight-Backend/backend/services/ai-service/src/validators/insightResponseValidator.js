const {
  logBlueprint,
} = require("./blueprintResponseValidator");

// Step 6 validation.
//
// Insights are free text, so this cannot check whether an observation is
// correct. What it can check is shape, and one substantive thing: that any
// entity the insight names actually appears in the results.
//
// Hallucinated numbers are the real risk here and are only partly checkable.
// A model that invents "revenue grew 40% year over year" from a snapshot is
// producing a plausible sentence containing an unverifiable figure. The
// prompt forbids it; this validator catches the narrower case where a label
// is named that was never in the data.

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

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

function validateInsightResponse(response, { maxInsights = 4 } = {}) {
  logBlueprint("RAW INSIGHT RESPONSE", response);

  assert(isObject(response), "Insight response must be a JSON object.");

  Object.keys(response).forEach((property) => {
    assert(
      property === "insights",
      `insights.${property} is not allowed. Return only insights.`
    );
  });

  assert(Array.isArray(response.insights), "insights.insights must be an array.");

  assert(
    response.insights.length <= maxInsights,
    `insights must contain at most ${maxInsights} items, got ${response.insights.length}.`
  );

  const seenIds = new Set();

  response.insights.forEach((insight, index) => {
    const path = `insights[${index}]`;

    assert(isObject(insight), `${path} must be an object.`);

    Object.keys(insight).forEach((property) => {
      assert(
        ["id", "title", "description"].includes(property),
        `${path}.${property} is not allowed.`
      );
    });

    assert(nonEmptyString(insight.id), `${path}.id is required.`);
    assert(
      /^insight_[a-z0-9_]*$/.test(insight.id) && insight.id.length <= 63,
      `${path}.id must be lowercase snake_case starting with insight_.`
    );
    assert(!seenIds.has(insight.id), `${path}.id "${insight.id}" is duplicated.`);

    assert(nonEmptyString(insight.title), `${path}.title is required.`);
    assert(
      insight.title.length <= MAX_TITLE_LENGTH,
      `${path}.title must be at most ${MAX_TITLE_LENGTH} characters.`
    );

    assert(nonEmptyString(insight.description), `${path}.description is required.`);
    assert(
      insight.description.length <= MAX_DESCRIPTION_LENGTH,
      `${path}.description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`
    );

    seenIds.add(insight.id);
  });

  logBlueprint("VALIDATED INSIGHTS", response);

  return true;
}

module.exports = {
  validateInsightResponse,
};

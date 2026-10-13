// Validation for LLM-generated seed rows.
//
// Stricter than the blueprint validators, and deliberately so. A malformed
// blueprint fails loudly at generation time. A bad seed row does not fail at
// all - it is silently learned by SDV and reproduced across every one of the
// thousands of rows sampled from that model. The damage is invisible until
// someone looks at a dashboard and cannot say why it seems wrong.
//
// Rows are checked individually rather than all-or-nothing. One malformed row in
// fifty is normal model behaviour and does not justify spending another provider
// call; the caller decides how many losses are too many.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Shape only - eight-four-four-four-twelve hex. Deliberately not the strict RFC
// pattern that pins the version and variant nibbles: models get those two
// characters wrong constantly, and a rejection here costs a whole row over a
// value that is never used as anything but an opaque identifier. Seed rows only
// need to be structurally valid, not certifiably v4.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function isBlank(value) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

function getEnumValues(field) {
  const values = field.options?.values || field.options || [];

  return Array.isArray(values) ? values : [];
}

/*
 * Returns the coerced value, or a Problem describing why it was refused.
 *
 * Coercion is limited to formatting the model got cosmetically wrong - a number
 * wrapped in quotes, a date with slashes, a boolean spelled "yes". Anything that
 * would require inventing a value is refused instead, because a guess here
 * becomes a pattern SDV treats as real.
 */
function coerceValue(value, field) {
  const type = String(field.type || "string").toLowerCase();

  if (isBlank(value)) {
    if (field.notNull) {
      return { problem: `${field.name} is required but was empty` };
    }

    return { value: null };
  }

  switch (type) {
    case "number": {
      const numeric = typeof value === "number" ? value : Number(String(value).replace(/[, ]/g, ""));

      if (!Number.isFinite(numeric)) {
        return { problem: `${field.name} is not a number: ${JSON.stringify(value)}` };
      }

      const min = field.min ?? field.options?.min;
      const max = field.max ?? field.options?.max;

      if (min !== undefined && min !== null && numeric < Number(min)) {
        return { problem: `${field.name} is below the minimum ${min}: ${numeric}` };
      }

      if (max !== undefined && max !== null && numeric > Number(max)) {
        return { problem: `${field.name} is above the maximum ${max}: ${numeric}` };
      }

      return { value: numeric };
    }

    case "boolean": {
      if (typeof value === "boolean") return { value };

      const text = String(value).trim().toLowerCase();

      if (["true", "yes", "1", "y"].includes(text)) return { value: true };
      if (["false", "no", "0", "n"].includes(text)) return { value: false };

      return { problem: `${field.name} is not a boolean: ${JSON.stringify(value)}` };
    }

    case "date": {
      const text = String(value).trim();

      // Accept slash-separated dates, which models produce often enough to be
      // worth normalising rather than rejecting.
      const normalized = text.replace(/\//g, "-").slice(0, 10);

      if (!DATE_PATTERN.test(normalized) || Number.isNaN(Date.parse(normalized))) {
        return { problem: `${field.name} is not a YYYY-MM-DD date: ${JSON.stringify(value)}` };
      }

      return { value: normalized };
    }

    case "email": {
      const text = String(value).trim();

      if (!EMAIL_PATTERN.test(text)) {
        return { problem: `${field.name} is not a valid email: ${JSON.stringify(value)}` };
      }

      return { value: text };
    }

    case "uuid": {
      const text = String(value).trim();

      if (!UUID_PATTERN.test(text)) {
        return { problem: `${field.name} is not a valid UUID: ${JSON.stringify(value)}` };
      }

      return { value: text };
    }

    case "enum": {
      const allowed = getEnumValues(field);

      if (!allowed.length) return { value: String(value) };

      if (allowed.includes(value)) return { value };

      // Case and whitespace are the usual mismatch, and the intended value is
      // unambiguous. Anything else is a value the model invented.
      const text = String(value).trim().toLowerCase();
      const match = allowed.find(
        (candidate) => String(candidate).trim().toLowerCase() === text
      );

      if (match !== undefined) return { value: match };

      return {
        problem: `${field.name} is not one of the allowed values (${allowed.join(", ")}): ${JSON.stringify(value)}`
      };
    }

    default:
      return { value: String(value) };
  }
}

/*
 * Checks one batch and returns the rows worth keeping.
 *
 * Throws only when the response is structurally unusable - not an object, no
 * rows array. Those are worth a repair call. Individual bad rows are dropped and
 * counted instead.
 */
function validateSeedRowsResponse(response, fields) {
  assert(isObject(response), "Seed rows response must be a JSON object.");
  assert(
    Array.isArray(response.rows),
    'Seed rows response must contain a "rows" array.'
  );
  assert(response.rows.length > 0, "Seed rows response contained no rows.");

  const rows = [];
  const problems = [];

  response.rows.forEach((row, index) => {
    if (!isObject(row)) {
      problems.push(`row ${index + 1}: not an object`);
      return;
    }

    const clean = {};
    const rowProblems = [];

    fields.forEach((field) => {
      const raw = row[field.name];
      const result = coerceValue(raw, field);

      if (result.problem) {
        rowProblems.push(result.problem);
        return;
      }

      clean[field.name] = result.value;
    });

    if (rowProblems.length) {
      problems.push(`row ${index + 1}: ${rowProblems.join("; ")}`);
      return;
    }

    rows.push(clean);
  });

  return { rows, problems };
}

module.exports = {
  validateSeedRowsResponse,
  coerceValue
};
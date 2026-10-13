/*
 * Decides who fills each column, and tells SDV what it needs to know.
 *
 * Three destinations:
 *
 *   key             - primary key. Our counter or a UUID. Never SDV: an id has
 *                     no pattern to learn, and a model asked for one produces
 *                     duplicates.
 *   foreign_key     - sampled from the parent table's real ids. Never SDV:
 *                     referential integrity has to be a guarantee, not a
 *                     probability.
 *   sdv             - everything a dashboard measures or groups by.
 *   seed_vocabulary - free text with too many distinct values for a model to
 *                     learn anything from. Sampled from the seed rows directly.
 *
 * The type sent to SDV is always explicit. Phase 1 measured what happens
 * otherwise: SDV infers meaning from the column *name*, decided a column called
 * "city" held personal information, and replaced Tokyo/Paris/Berlin with
 * invented placeholders. Never let it detect.
 */

const HIGH_CARDINALITY_TYPES = new Set(['email', 'uuid', 'address']);

// Above this share of distinct values, a categorical column is not a category -
// it is free text wearing a category's clothes. A copula given 300 distinct
// names cannot learn a distribution; it just reshuffles them, and we can do
// that ourselves without paying to train a model.
const HIGH_CARDINALITY_RATIO = 0.5;

// Below this many distinct values a column is worth modelling as a category
// regardless of ratio - a 20-row reference table where every value is unique is
// still a category.
const MIN_DISTINCT_FOR_TEXT = 15;

function normalizeColumnName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function getEnumValues(field) {
  const values = field.options?.values || field.options || [];

  return Array.isArray(values) ? values : [];
}

function countDistinct(seedRows, columnName) {
  const seen = new Set();

  seedRows.forEach((row) => {
    const value = row[columnName];

    if (value !== null && value !== undefined) seen.add(String(value));
  });

  return seen.size;
}

function isHighCardinalityText(field, columnName, seedRows) {
  if (HIGH_CARDINALITY_TYPES.has(field.type)) return true;
  if (field.type !== 'string') return false;
  if (!seedRows.length) return false;

  const distinct = countDistinct(seedRows, columnName);

  if (distinct < MIN_DISTINCT_FOR_TEXT) return false;

  return distinct / seedRows.length > HIGH_CARDINALITY_RATIO;
}

function toSdtype(field) {
  switch (String(field.type || 'string').toLowerCase()) {
    case 'number':
      return 'numerical';

    case 'date':
      return 'datetime';

    case 'boolean':
      return 'boolean';

    case 'enum':
    case 'string':
    default:
      return 'categorical';
  }
}

function buildSdvColumn(field, columnName) {
  const column = {
    name: columnName,
    sdtype: toSdtype(field)
  };

  if (column.sdtype === 'datetime') {
    column.datetime_format = '%Y-%m-%d';
  }

  if (column.sdtype === 'numerical') {
    const min = field.min ?? field.options?.min;
    const max = field.max ?? field.options?.max;

    if (min !== undefined && min !== null) column.minimum = Number(min);
    if (max !== undefined && max !== null) column.maximum = Number(max);
  }

  if (field.type === 'enum') {
    const values = getEnumValues(field);

    if (values.length) column.allowed_values = values;
  }

  return column;
}

/*
 * Date columns that must not come out in the wrong order.
 *
 * Structural, not domain-specific: the same rule that stops a delivery date
 * preceding an order date stops a discharge date preceding an admission date.
 * That generality is the whole point - see section 12 of the migration doc.
 *
 * These are NOT sent to SDV as constraints. Measured 2026-08-06 on a sales
 * table whose seed data had segment -> price of 49/293/895:
 *
 *   with SDV inequality constraint   187 / 290 / 254   order broken, 0 date violations
 *   no constraint                    157 / 251 / 541   order kept,   211/400 date violations
 *   date columns removed entirely    119 / 252 / 728   order kept,   0 date violations
 *
 * SDV enforces Inequality by replacing the later column with a difference
 * before fitting, and that transformation distorts every other correlation in
 * the table. The third row is the best outcome on every axis, so the later date
 * is taken out of SDV's hands and derived from the earlier one instead - the
 * same treatment given to any computed column.
 */
const EARLIER_TOKENS = [
  'start', 'begin', 'order', 'ordered', 'admission', 'admitted', 'admit',
  'created', 'open', 'opened', 'from', 'issue', 'issued', 'hire', 'hired',
  'birth', 'purchase', 'purchased', 'booking', 'booked', 'entry'
];

const LATER_TOKENS = [
  'end', 'ended', 'finish', 'finished', 'delivery', 'delivered', 'deliver',
  'discharge', 'discharged', 'updated', 'closed', 'close', 'due', 'complete',
  'completed', 'ship', 'shipped', 'resolved', 'termination', 'terminated',
  'expiry', 'expires', 'expiration', 'return', 'returned', 'exit'
];

const MAX_DATE_PAIRS = 4;

function hasToken(columnName, tokens) {
  const parts = columnName.split('_');

  return tokens.some((token) => parts.includes(token));
}

function parseDate(value) {
  if (!value) return null;

  const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date.getTime());

  next.setUTCDate(next.getUTCDate() + days);

  return next;
}

/*
 * Gaps observed between the two dates in the seed rows.
 *
 * Sampling from these rather than from an invented range is what keeps
 * deliveries looking like deliveries: if the seed data says most orders arrive
 * in 2-5 days with the occasional 20, the generated data says the same.
 */
function collectGaps(seedRows, lowColumn, highColumn) {
  const gaps = [];

  seedRows.forEach((row) => {
    const low = parseDate(row[lowColumn]);
    const high = parseDate(row[highColumn]);

    if (!low || !high) return;

    const days = Math.round((high - low) / 86400000);

    if (days >= 0) gaps.push(days);
  });

  return gaps;
}

/*
 * Finds date pairs and returns them as derivation rules.
 *
 * The later column is removed from SDV's column list by the caller, so SDV never
 * sees it and never has its other correlations distorted by a constraint.
 */
function detectDatePairs(sdvColumns, seedRows) {
  const dateColumns = sdvColumns
    .filter((column) => column.sdtype === 'datetime')
    .map((column) => column.name);

  if (dateColumns.length < 2) return [];

  const earlier = dateColumns.filter((name) => hasToken(name, EARLIER_TOKENS));
  const later = dateColumns.filter((name) => hasToken(name, LATER_TOKENS));

  const pairs = [];
  const claimed = new Set();

  later.forEach((highColumn) => {
    if (pairs.length >= MAX_DATE_PAIRS) return;
    if (claimed.has(highColumn)) return;

    /*
     * Pair with the earlier column sharing the most name parts, so
     * contract_start_date pairs with contract_end_date rather than with an
     * unrelated created_at that happens to also be a date.
     */
    const highParts = new Set(highColumn.split('_'));

    let best = null;
    let bestOverlap = -1;

    earlier.forEach((lowColumn) => {
      if (lowColumn === highColumn || claimed.has(lowColumn)) return;

      const overlap = lowColumn
        .split('_')
        .filter((part) => highParts.has(part)).length;

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        best = lowColumn;
      }
    });

    if (!best) return;

    const gaps = collectGaps(seedRows, best, highColumn);

    // Without observed gaps there is nothing to sample, and inventing a range
    // would be making up the very realism this is meant to preserve. Leaving the
    // column with SDV is the lesser evil.
    if (!gaps.length) return;

    claimed.add(highColumn);

    pairs.push({
      from: best,
      to: highColumn,
      gaps
    });
  });

  return pairs;
}

/*
 * Fills in the derived date columns after SDV has produced the rest.
 *
 * Ordering is guaranteed by construction here - the later date is the earlier
 * one plus a non-negative number of days - rather than by asking a statistical
 * model to respect a rule.
 */
function applyDerivedDates({ rows, datePairs, random }) {
  if (!datePairs.length) return rows;

  return rows.map((row) => {
    const next = { ...row };

    datePairs.forEach((pair) => {
      const from = parseDate(next[pair.from]);

      if (!from) {
        next[pair.to] = null;
        return;
      }

      next[pair.to] = formatDate(addDays(from, random.pick(pair.gaps)));
    });

    return next;
  });
}

/*
 * Column pairs where one value decides another - city/country,
 * product/category, state/region.
 *
 * Phase 1 measured why this matters: a model learns that Tokyo and Japan are
 * correlated, never that Tokyo *determines* Japan, and produced correct pairings
 * only 44-51% of the time. Declaring the pair took that to 100%.
 *
 * Detected from the seed rows rather than a hardcoded list, so it works for any
 * domain: if every value of column A appears with exactly one value of column B
 * across every seed row, that is a determining pair.
 */
const MAX_COMBINATION_CONSTRAINTS = 3;

function detectFixedCombinations(sdvColumns, seedRows) {
  if (seedRows.length < 10) return [];

  const categorical = sdvColumns
    .filter((column) => column.sdtype === 'categorical')
    // An enum's values are already pinned by allowed_values, and pairing two
    // enums tends to over-constrain sampling for no gain.
    .filter((column) => !column.allowed_values)
    .map((column) => column.name)
    .filter((name) => {
      const distinct = countDistinct(seedRows, name);

      // A column that is nearly unique per row determines everything and
      // determines nothing useful. A single-valued column carries no pairing.
      return distinct > 1 && distinct <= seedRows.length * HIGH_CARDINALITY_RATIO;
    });

  const constraints = [];

  for (let i = 0; i < categorical.length; i += 1) {
    for (let j = i + 1; j < categorical.length; j += 1) {
      if (constraints.length >= MAX_COMBINATION_CONSTRAINTS) return constraints;

      const left = categorical[i];
      const right = categorical[j];

      const mapping = new Map();
      let determines = true;

      for (const row of seedRows) {
        const leftValue = row[left];
        const rightValue = row[right];

        if (leftValue === null || leftValue === undefined) continue;
        if (rightValue === null || rightValue === undefined) continue;

        const key = String(leftValue);
        const value = String(rightValue);

        if (mapping.has(key) && mapping.get(key) !== value) {
          determines = false;
          break;
        }

        mapping.set(key, value);
      }

      if (determines && mapping.size > 1) {
        constraints.push({
          type: 'fixed_combinations',
          columns: [left, right]
        });
      }
    }
  }

  return constraints;
}

/*
 * Route every column in a table.
 *
 * relationshipMap is keyed "table.column" and marks foreign keys. seedRows are
 * used only to measure cardinality and spot determining pairs - the values
 * themselves are SDV's business.
 */
function routeColumns({
  fields,
  tableName,
  tableBlueprint = {},
  relationshipMap = new Map(),
  seedRows = []
}) {
  const normalizedTable = normalizeColumnName(tableName);
  const primaryKey = normalizeColumnName(tableBlueprint.primary_key);

  const uniqueKeys = new Set(
    (tableBlueprint.unique_keys || []).map(normalizeColumnName)
  );

  const keyColumns = [];
  const foreignKeyColumns = [];
  const sdvColumns = [];
  const vocabularyColumns = [];

  fields.forEach((field) => {
    const columnName = normalizeColumnName(field.name);

    const isPrimaryKey =
      columnName === primaryKey ||
      field.primaryKey === true ||
      field.primary_key === true;

    if (isPrimaryKey) {
      keyColumns.push({ name: columnName, field });
      return;
    }

    const relationship = relationshipMap.get(`${normalizedTable}.${columnName}`);

    if (relationship) {
      foreignKeyColumns.push({ name: columnName, field, relationship });
      return;
    }

    /*
     * A unique non-key column cannot come from SDV. A model has no concept of
     * uniqueness, and patching duplicates afterwards would break the very
     * correlation the model was trained to produce. Sampling from the seed
     * vocabulary and suffixing is honest about what it is doing.
     */
    const isUnique = field.unique === true || uniqueKeys.has(columnName);

    if (isUnique || isHighCardinalityText(field, columnName, seedRows)) {
      vocabularyColumns.push({ name: columnName, field, unique: isUnique });
      return;
    }

    sdvColumns.push(buildSdvColumn(field, columnName));
  });

  /*
   * Date pairs are resolved before constraints are built, because the later
   * date is taken out of SDV's hands entirely. Leaving it in and adding an
   * inequality constraint was measured to break the table's other correlations
   * - see the comment above EARLIER_TOKENS.
   */
  const datePairs = detectDatePairs(sdvColumns, seedRows);
  const derivedNames = new Set(datePairs.map((pair) => pair.to));

  const remainingSdvColumns = sdvColumns.filter(
    (column) => !derivedNames.has(column.name)
  );

  /*
   * Only fixed_combinations survives as a real SDV constraint. Measured on
   * 2026-08-06: it lifted city/country pairing from 85% to 100% with no effect
   * on numeric ordering, unlike inequality which distorted it badly.
   */
  const constraints = detectFixedCombinations(remainingSdvColumns, seedRows);

  return {
    keyColumns,
    foreignKeyColumns,
    sdvColumns: remainingSdvColumns,
    vocabularyColumns,
    datePairs,
    constraints
  };
}

module.exports = {
  routeColumns,
  normalizeColumnName,
  toSdtype,
  detectDatePairs,
  applyDerivedDates,
  detectFixedCombinations,
  isHighCardinalityText
};
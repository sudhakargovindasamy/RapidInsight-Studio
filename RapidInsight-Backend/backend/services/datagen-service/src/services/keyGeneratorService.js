const { randomUuid } = require('../utils/seededRandom');

/*
 * Primary keys, foreign keys and uniqueness.
 *
 * None of this is SDV's job and none of it ever was Faker's job either - it is
 * integrity logic that happened to be calling faker.* for its randomness. The
 * rules here are guarantees: a counter cannot repeat, and a value picked from a
 * list of parent ids cannot point at a row that does not exist.
 */

// Kept from the previous implementation. These produce readable ids (S0001,
// C0001) that make a generated dataset far easier to eyeball than UUIDs.
const ID_PREFIXES = [
  { match: 'student', prefix: 'S', width: 4 },
  { match: 'course', prefix: 'C', width: 4 },
  { match: 'professor', prefix: 'P', width: 4 },
  { match: 'department', prefix: 'D', width: 3 },
  { match: 'semester', prefix: 'SEM', width: 2 },
  { match: 'hostel', prefix: 'H', width: 3 },
  { match: 'enrollment', prefix: 'E', width: 6 },
  { match: 'customer', prefix: 'CU', width: 4 },
  { match: 'product', prefix: 'PR', width: 4 },
  { match: 'order', prefix: 'O', width: 6 },
  { match: 'invoice', prefix: 'INV', width: 6 },
  { match: 'patient', prefix: 'PA', width: 5 },
  { match: 'employee', prefix: 'EM', width: 4 },
  { match: 'store', prefix: 'ST', width: 3 },
  { match: 'sale', prefix: 'SL', width: 6 }
];

function resolveIdStyle({ columnName, field, strategy }) {
  const explicit = String(strategy || '').toLowerCase();

  if (explicit === 'uuid') return { kind: 'uuid' };
  if (explicit === 'incremental') return { kind: 'incremental' };

  const type = String(field?.type || '').toLowerCase();

  // A column declared as a uuid must hold a real uuid, whatever its name
  // suggests.
  if (type === 'uuid') return { kind: 'uuid' };
  if (type === 'number') return { kind: 'incremental' };

  const match = ID_PREFIXES.find((entry) => columnName.includes(entry.match));

  if (match) {
    return { kind: 'sequence', prefix: match.prefix, width: match.width };
  }

  return { kind: 'sequence', prefix: 'ID', width: 6 };
}

/*
 * Generates the primary key for row `index`.
 *
 * Uniqueness comes from the index, not from randomness, so it holds by
 * construction rather than by retrying until no collision is found.
 */
function generatePrimaryKey({ columnName, field, strategy, index, startAt = 1 }) {
  const style = resolveIdStyle({ columnName, field, strategy });

  switch (style.kind) {
    case 'uuid':
      return randomUuid();

    case 'incremental':
      return startAt + index;

    case 'sequence':
    default:
      return `${style.prefix}${String(index + 1).padStart(style.width, '0')}`;
  }
}

/*
 * A registry of every primary key produced, so child tables can point at them.
 *
 * Keyed "table.column" because a blueprint can reference a unique key rather
 * than the primary key.
 */
function createKeyRegistry() {
  const values = new Map();

  return {
    store(tableName, columnName, keyValues) {
      values.set(`${tableName}.${columnName}`, keyValues);
    },

    get(tableName, columnName) {
      return values.get(`${tableName}.${columnName}`) || [];
    },

    has(tableName, columnName) {
      return values.has(`${tableName}.${columnName}`);
    }
  };
}

/*
 * Picks a parent id for a foreign key.
 *
 * Because the pool contains only ids that were actually generated, every value
 * this returns is valid. That is the property worth protecting, and the reason
 * foreign keys never go near SDV.
 */
function pickForeignKey({ registry, random, parentTable, parentColumn }) {
  const pool = registry.get(parentTable, parentColumn);

  if (!pool.length) {
    const error = new Error(
      `No parent rows exist for ${parentTable}.${parentColumn}. The parent table must be generated first.`
    );
    error.statusCode = 422;
    error.code = 'MISSING_PARENT_ROWS';
    throw error;
  }

  return random.pick(pool);
}

/*
 * Enforces uniqueness on a column SDV does not own.
 *
 * Used for columns like email or a reference code: the value comes from the
 * seed vocabulary, and a suffix is added only when that exact value has already
 * been used.
 */
function createUniqueTracker() {
  const used = new Map();

  return {
    reserve({ tableName, columnName, value, field }) {
      const registryKey = `${tableName}.${columnName}`;

      if (!used.has(registryKey)) used.set(registryKey, new Set());

      const seen = used.get(registryKey);
      const initial = value === null || value === undefined ? '' : String(value);

      let candidate = initial;
      let attempt = 0;

      while (seen.has(candidate.toLowerCase())) {
        attempt += 1;
        candidate = applyUniqueSuffix(initial, attempt, field);

        if (attempt > 10000) {
          const error = new Error(
            `Could not produce a unique value for ${registryKey} after ${attempt} attempts.`
          );
          error.statusCode = 422;
          throw error;
        }
      }

      seen.add(candidate.toLowerCase());

      // Preserve the original type. A numeric column that has been suffixed is
      // no longer a number, so the suffix is added to the number instead.
      if (typeof value === 'number' && attempt === 0) return value;

      return candidate;
    }
  };
}

function applyUniqueSuffix(value, attempt, field) {
  const type = String(field?.type || 'string').toLowerCase();

  if (type === 'number') {
    return String(Number(value || 0) + attempt);
  }

  if (type === 'email') {
    const at = value.lastIndexOf('@');

    if (at > 0) {
      return `${value.slice(0, at)}.${attempt}${value.slice(at)}`;
    }

    return `user.${attempt}@example.com`;
  }

  if (type === 'uuid') {
    return randomUuid();
  }

  return `${value}_${attempt}`;
}

module.exports = {
  generatePrimaryKey,
  createKeyRegistry,
  pickForeignKey,
  createUniqueTracker,
  resolveIdStyle
};
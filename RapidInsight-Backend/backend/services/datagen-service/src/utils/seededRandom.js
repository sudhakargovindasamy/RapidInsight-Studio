const crypto = require('crypto');

/*
 * Deterministic randomness, replacing the faker.* calls used for picking.
 *
 * Faker was doing two unrelated jobs here. Inventing values is now SDV's job.
 * Choosing a parent row for a foreign key was never "fake data" at all - it is
 * just picking from a list, and that job stays.
 *
 * Doing it with a seeded generator buys something Faker never gave us: the same
 * project generates the same data every run, so a bad row can be reproduced
 * rather than merely described.
 *
 * mulberry32: small, fast, and good enough for choosing list positions. Not for
 * anything security-related - see randomUuid below for that.
 */
function createRandom(seed) {
  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) | 0;

    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    next,

    // Inclusive on both ends, matching faker.number.int.
    int(min, max) {
      const low = Math.ceil(min);
      const high = Math.floor(max);

      if (high <= low) return low;

      return low + Math.floor(next() * (high - low + 1));
    },

    float(min, max, decimals = 2) {
      const value = min + next() * (max - min);
      const factor = 10 ** decimals;

      return Math.round(value * factor) / factor;
    },

    pick(items) {
      if (!Array.isArray(items) || items.length === 0) return undefined;

      return items[Math.floor(next() * items.length)];
    },

    // Fisher-Yates on a copy. Used to take a subset of seed rows without
    // always taking the same ones from the front.
    shuffle(items) {
      const copy = [...items];

      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }

      return copy;
    }
  };
}

/*
 * Turns any string into a stable 32-bit seed.
 *
 * Used so a run can be seeded from something meaningful - a project id, a table
 * name - and still land on the same sequence every time.
 */
function seedFromString(value) {
  const text = String(value ?? '');
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

/*
 * Real UUIDs for primary keys.
 *
 * Deliberately not seeded. A primary key has to be unique across every run and
 * every table, and a seeded generator would produce the same ids on every run -
 * which is exactly what a primary key must not do.
 */
function randomUuid() {
  return crypto.randomUUID();
}

module.exports = {
  createRandom,
  seedFromString,
  randomUuid
};
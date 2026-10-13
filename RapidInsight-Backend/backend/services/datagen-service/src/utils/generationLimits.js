const DEFAULT_ROW_COUNT = 100;
const MAX_ROW_COUNT = 10000;
const PREVIEW_ROW_COUNT = 10;

function normalizeRowCount(value) {
  const count = Number(value || DEFAULT_ROW_COUNT);

  if (!Number.isFinite(count) || count <= 0) {
    return DEFAULT_ROW_COUNT;
  }

  return Math.min(Math.floor(count), MAX_ROW_COUNT);
}

module.exports = {
  DEFAULT_ROW_COUNT,
  MAX_ROW_COUNT,
  PREVIEW_ROW_COUNT,
  normalizeRowCount,
};

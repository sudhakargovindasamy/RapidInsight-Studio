/**
 * Detects whether a chosen file carries the user's own data rows or only
 * declares columns, so the upload form can ask which they want before sending.
 *
 * This is a lightweight preview only. schema-service re-parses the file and has
 * the final say on both the row count and the data source.
 */

const DATA = 'data';
const SCHEMA = 'schema';
const UNKNOWN = 'unknown';

function getExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

/**
 * Splits CSV text into records while respecting quoted fields, so a newline
 * inside a quoted value is not miscounted as a new row.
 */
function splitCsvRecords(text) {
  const records = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      if (current.trim()) records.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) records.push(current);

  return records;
}

function countCsvColumns(headerRecord) {
  let columns = 1;
  let inQuotes = false;

  for (let index = 0; index < headerRecord.length; index += 1) {
    const char = headerRecord[index];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      columns += 1;
    }
  }

  return columns;
}

function detectCsv(text) {
  const records = splitCsvRecords(text);

  if (!records.length) {
    return { kind: UNKNOWN, rowCount: 0, columnCount: 0 };
  }

  const [header, ...rows] = records;

  return {
    // A header-only CSV declares columns but has no data to insert.
    kind: rows.length ? DATA : SCHEMA,
    rowCount: rows.length,
    columnCount: countCsvColumns(header)
  };
}

function detectJson(text) {
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.rows) ? parsed.rows : null);

  if (rows) {
    const keys = new Set();
    rows.forEach((row) => {
      if (row && typeof row === 'object') Object.keys(row).forEach((key) => keys.add(key));
    });

    return { kind: DATA, rowCount: rows.length, columnCount: keys.size };
  }

  const fields = parsed?.fields || parsed?.columns;

  if (Array.isArray(fields)) {
    return { kind: SCHEMA, rowCount: 0, columnCount: fields.length };
  }

  return { kind: UNKNOWN, rowCount: 0, columnCount: 0 };
}

export async function detectDataFile(file) {
  const extension = getExtension(file.name);

  try {
    const text = await file.text();

    if (extension === 'csv') return detectCsv(text);
    if (extension === 'json') return detectJson(text);

    // YAML is only ever a schema declaration in this app.
    if (extension === 'yaml' || extension === 'yml') {
      return { kind: SCHEMA, rowCount: 0, columnCount: 0 };
    }

    return { kind: UNKNOWN, rowCount: 0, columnCount: 0 };
  } catch {
    return { kind: UNKNOWN, rowCount: 0, columnCount: 0 };
  }
}

export const FILE_KIND = { DATA, SCHEMA, UNKNOWN };

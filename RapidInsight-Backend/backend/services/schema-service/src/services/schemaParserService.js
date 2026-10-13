const yaml = require('js-yaml');
const Papa = require('papaparse');

const ALLOWED_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'email',
  'uuid',
  'enum',
  'address'
]);

function getFileExtension(filename) {
  const match = String(filename || '').toLowerCase().match(/\.([^.]+)$/);
  return match ? match[1] : '';
}

function normalizeFieldName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

const STRICT_DATE_REGEX = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isStrictDate(value) {
  const str = String(value ?? '').trim();
  if (!STRICT_DATE_REGEX.test(str)) return false;
  return !Number.isNaN(Date.parse(str));
}

/*
 * A run of digits longer than JavaScript can hold exactly is an identifier,
 * not a quantity. Number.MAX_SAFE_INTEGER is 9007199254740991, so anything
 * past 15 digits starts losing its low-order digits the moment it is parsed:
 * 3513278000000046751 becomes 3513278000000046600, and several distinct ids
 * collapse onto the same value, which silently turns a join into a many-to-many
 * explosion.
 *
 * Treating these as text is also the semantically correct answer. Ids are only
 * ever compared and joined, never summed or averaged, and text supports both.
 */
const MAX_EXACT_INTEGER_DIGITS = 15;

function isOversizedIntegerString(value) {
  if (!/^-?\d+$/.test(value)) return false;

  return value.replace('-', '').length > MAX_EXACT_INTEGER_DIGITS;
}

function inferType(values) {
  const filtered = values
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .slice(0, 25);

  if (!filtered.length) return 'string';

  if (filtered.every((value) => /^(true|false)$/i.test(value))) return 'boolean';

  // Checked before the numeric test, which would otherwise claim these.
  if (filtered.some(isOversizedIntegerString)) return 'string';

  if (filtered.every((value) => !Number.isNaN(Number(value)))) return 'number';
  if (filtered.every(isStrictDate)) return 'date';
  if (filtered.every((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return 'email';

  return 'string';
}

function normalizeFields(rawFields) {
  if (!Array.isArray(rawFields) || rawFields.length === 0) {
    throw new Error('Schema must contain a non-empty fields or columns array.');
  }

  const seen = new Set();

  return rawFields.map((field) => {
    const name = normalizeFieldName(field.name || field.column || field.key);

    if (!name) {
      throw new Error('Every field must have a valid name.');
    }

    if (seen.has(name)) {
      throw new Error(`Duplicate field name: ${name}`);
    }

    seen.add(name);

    const type = String(field.type || 'string').toLowerCase();

    if (!ALLOWED_TYPES.has(type)) {
      throw new Error(`Unsupported field type "${type}" for field "${name}".`);
    }

    const normalized = {
      name,
      type,
      primaryKey: Boolean(field.primaryKey || field.primary_key),
      notNull: Boolean(field.notNull || field.not_null || field.required),
      unique: Boolean(field.unique),
      faker: field.faker || null,
      options: field.options || null
    };

    if (type === 'enum') {
      const values = normalized.options?.values || normalized.options;
      if (!Array.isArray(values) || values.length === 0) {
        throw new Error(`Enum field "${name}" must have options.values.`);
      }
      normalized.options = { values };
    }

    return normalized;
  });
}

function parseJson(buffer) {
  const raw = JSON.parse(buffer.toString('utf8'));

  if (Array.isArray(raw)) {
    if (!raw.length) throw new Error('JSON array must not be empty.');

    const keys = new Set();
    raw.forEach((row) => {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach((key) => keys.add(key));
      }
    });

    const headers = Array.from(keys);
    if (!headers.length) throw new Error('JSON objects must have keys.');

    const inferredFields = headers.map((header) => {
      const values = raw.map((row) => row[header]);
      return {
        name: normalizeFieldName(header),
        type: inferType(values)
      };
    });

    return {
      name: 'json_upload',
      fields: normalizeFields(inferredFields),
      rows: raw
    };
  }

  const fields = normalizeFields(raw.fields || raw.columns);
  return {
    name: raw.name || raw.tableName || 'uploaded_schema',
    fields,
    rows: []
  };
}

function parseYaml(buffer) {
  const raw = yaml.load(buffer.toString('utf8'));
  const fields = normalizeFields(raw.fields || raw.columns);
  return {
    name: raw.name || raw.tableName || 'uploaded_schema',
    fields,
    rows: []
  };
}

function parseCsv(buffer) {
  const csv = buffer.toString('utf8');

  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true
  });

  if (parsed.errors?.length) {
    throw new Error(parsed.errors[0].message || 'Invalid CSV file.');
  }

  const rows = parsed.data || [];
  const headers = parsed.meta.fields || [];

  if (!headers.length) {
    throw new Error('CSV must contain a header row.');
  }

  const fields = headers.map((header) => {
    const values = rows.map((row) => row[header]);
    return {
      name: normalizeFieldName(header),
      type: inferType(values)
    };
  });

  return {
    name: 'csv_upload',
    fields: normalizeFields(fields),
    rows
  };
}

function parseSchemaFile(file) {
  const extension = getFileExtension(file.originalname);

  if (extension === 'json') {
    const parsed = parseJson(file.buffer);
    return {
      fileType: 'json',
      schemaDefinition: { name: parsed.name, fields: parsed.fields },
      rows: parsed.rows || []
    };
  }

  if (extension === 'yaml' || extension === 'yml') {
    const parsed = parseYaml(file.buffer);
    return {
      fileType: extension,
      schemaDefinition: { name: parsed.name, fields: parsed.fields },
      rows: []
    };
  }

  if (extension === 'csv') {
    const parsed = parseCsv(file.buffer);
    return {
      fileType: 'csv',
      schemaDefinition: { name: parsed.name, fields: parsed.fields },
      rows: parsed.rows || []
    };
  }

  throw new Error('Unsupported file type. Only .csv, .json, .yaml, .yml are supported.');
}

module.exports = {
  parseSchemaFile,
  getFileExtension
};
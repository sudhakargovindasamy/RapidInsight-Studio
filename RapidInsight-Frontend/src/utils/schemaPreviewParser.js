import yaml from 'js-yaml';
import Papa from 'papaparse';
import { buildTableNameFromFileName, normalizeIdentifier } from './identifierNaming.js';

const SUPPORTED_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'email',
  'uuid',
  'enum',
  'address'
]);

function normalizeColumnName(name) {
  return normalizeIdentifier(name, 'field');
}

function inferType(value) {
  const raw = String(value ?? '').trim();

  if (!raw) return 'string';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return 'email';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 'date';
  if (raw === 'true' || raw === 'false') return 'boolean';
  if (!Number.isNaN(Number(raw))) return 'number';

  return 'string';
}

function normalizeSchemaObject(input, fileName) {
  const tableName = buildTableNameFromFileName(fileName);
  const fields = input.fields || input.columns || [];

  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('Schema must contain fields or columns array.');
  }

  const seen = new Set();
  const columns = fields.map((field) => {
    const name = normalizeColumnName(field.name);

    if (!name) {
      throw new Error('Each field must have a valid name.');
    }

    if (seen.has(name)) {
      throw new Error(`Duplicate field name found: ${name}`);
    }

    seen.add(name);

    const type = String(field.type || 'string').toLowerCase();

    return {
      name,
      type: SUPPORTED_TYPES.has(type) ? type : 'string',
      primaryKey: Boolean(field.primaryKey || field.primary_key),
      notNull: Boolean(field.notNull || field.not_null),
      unique: Boolean(field.unique),
      faker: field.faker || '',
      options: field.options || []
    };
  });

  return { tableName, columns };
}

export async function parseSchemaPreview(file) {
  const text = await file.text();
  const fileName = file.name.toLowerCase();

  if (fileName.endsWith('.json')) {
    const parsed = JSON.parse(text);
    return normalizeSchemaObject(parsed, file.name);
  }

  if (fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
    const parsed = yaml.load(text);
    return normalizeSchemaObject(parsed, file.name);
  }

  if (fileName.endsWith('.csv')) {
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true
    });

    if (parsed.errors?.length) {
      throw new Error(parsed.errors[0].message);
    }

    const rows = parsed.data || [];
    const headers = parsed.meta.fields || [];

    if (headers.length === 0) {
      throw new Error('CSV must have at least one header column.');
    }

    const firstRow = rows[0] || {};
    const seen = new Set();

    return {
      tableName: buildTableNameFromFileName(file.name),
      columns: headers.map((header) => {
        const name = normalizeColumnName(header);

        if (seen.has(name)) {
          throw new Error(`Duplicate field name found: ${name}`);
        }

        seen.add(name);

        return {
          name,
          type: inferType(firstRow[header]),
          primaryKey: false,
          notNull: false,
          unique: false,
          faker: '',
          options: []
        };
      })
    };
  }

  throw new Error('Unsupported schema file format.');
}


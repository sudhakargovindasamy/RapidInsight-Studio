import * as XLSX from 'xlsx';
import { buildTableNameFromFileName } from './identifierNaming.js';

function normalizeIdentifier(name) {
  const norm = buildTableNameFromFileName(name);
  return norm || String(name || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeColumnName(name) {
  const cleaned = String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return cleaned || 'col';
}

function inferSampleType(sampleValues) {
  const nonEmpties = sampleValues
    .map((v) => (v != null ? String(v).trim() : ''))
    .filter(Boolean);

  if (!nonEmpties.length) return 'string';

  if (nonEmpties.every((v) => /^(true|false|1|0|yes|no)$/i.test(v))) {
    return 'boolean';
  }

  if (nonEmpties.every((v) => !Number.isNaN(Number(v.replace(/,/g, ''))))) {
    return 'number';
  }

  const DATE_REGEX = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/;
  if (nonEmpties.every((v) => DATE_REGEX.test(v) && !Number.isNaN(Date.parse(v)))) {
    return 'date';
  }

  return 'string';
}

/**
 * Extracts ONLY metadata and column structure from a file in the browser.
 * NEVER extracts or persists full business data rows.
 */
export async function extractAssetMetadata(file) {
  if (!file) {
    throw new Error('No file provided for metadata extraction.');
  }

  if (file.size <= 0) {
    throw new Error(`File "${file.name}" is empty (0 bytes).`);
  }

  const fileName = file.name;
  const fileExt = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const assetName = normalizeIdentifier(fileName);

  let sheetName = null;
  let rawColumns = []; // [{ name, sampleValues }]

  if (fileExt === 'csv') {
    // Read up to 64 KB to inspect header and sample rows
    const slice = file.slice(0, 65536);
    const text = await slice.text();
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      throw new Error(`CSV file "${fileName}" contains no headers or records.`);
    }

    // Split header row by comma (basic CSV quote handling)
    const headerLine = lines[0];
    const headerTokens = parseCsvLine(headerLine);

    if (!headerTokens.length) {
      throw new Error(`CSV file "${fileName}" does not contain valid column headers.`);
    }

    const sampleLines = lines.slice(1, 15);
    const sampleRows = sampleLines.map((line) => parseCsvLine(line));

    rawColumns = headerTokens.map((header, colIdx) => {
      const sampleValues = sampleRows.map((r) => r[colIdx]);
      return {
        name: normalizeColumnName(header),
        sampleValues
      };
    });
  } else if (fileExt === 'xlsx' || fileExt === 'xls') {
    const arrayBuffer = await file.arrayBuffer();
    // Read ONLY first 15 rows for header and profiling sample
    const workbook = XLSX.read(arrayBuffer, { type: 'array', sheetRows: 15 });

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      throw new Error(`Excel file "${fileName}" contains no sheets.`);
    }

    sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (!rows || rows.length === 0 || !rows[0] || rows[0].length === 0) {
      throw new Error(`Excel sheet "${sheetName}" in "${fileName}" has no column headers.`);
    }

    const headerTokens = rows[0].map((h) => String(h || '').trim()).filter(Boolean);
    if (!headerTokens.length) {
      throw new Error(`Excel file "${fileName}" does not contain valid column headers.`);
    }

    const sampleRows = rows.slice(1, 15);
    rawColumns = headerTokens.map((header, colIdx) => {
      const sampleValues = sampleRows.map((r) => (r ? r[colIdx] : undefined));
      return {
        name: normalizeColumnName(header),
        sampleValues
      };
    });
  } else if (fileExt === 'json') {
    const text = await file.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON file "${fileName}".`);
    }

    if (Array.isArray(parsed)) {
      if (!parsed.length) {
        throw new Error(`JSON array in "${fileName}" is empty.`);
      }
      const firstRow = parsed[0];
      if (!firstRow || typeof firstRow !== 'object') {
        throw new Error(`JSON objects in "${fileName}" must be key-value pairs.`);
      }
      const keys = Object.keys(firstRow);
      const sampleItems = parsed.slice(0, 15);
      rawColumns = keys.map((key) => ({
        name: normalizeColumnName(key),
        sampleValues: sampleItems.map((item) => item[key])
      }));
    } else if (parsed && typeof parsed === 'object') {
      const fieldList = parsed.fields || parsed.columns || [];
      if (Array.isArray(fieldList) && fieldList.length > 0) {
        rawColumns = fieldList.map((f) => ({
          name: normalizeColumnName(f.name || f.column || f.key),
          sampleValues: []
        }));
      } else {
        const keys = Object.keys(parsed);
        rawColumns = keys.map((key) => ({
          name: normalizeColumnName(key),
          sampleValues: [parsed[key]]
        }));
      }
    }
  } else if (fileExt === 'yaml' || fileExt === 'yml') {
    const text = await file.text();
    // Parse key lines or field definitions
    const lines = text.split(/\r?\n/);
    const fieldNames = [];
    for (const line of lines) {
      const match = line.match(/^\s*(?:-\s*name:\s*|name:\s*|([a-zA-Z0-9_]+):)/);
      if (match) {
        const found = (match[1] || match[0].split(':')[0].replace(/[-]/g, '')).trim();
        if (found && !fieldNames.includes(found)) {
          fieldNames.push(found);
        }
      }
    }
    if (!fieldNames.length) {
      throw new Error(`YAML file "${fileName}" contains no identifiable fields.`);
    }
    rawColumns = fieldNames.map((name) => ({
      name: normalizeColumnName(name),
      sampleValues: []
    }));
  } else {
    throw new Error(`Unsupported file format "${fileExt}". Supported: CSV, XLSX, XLS, JSON, YAML.`);
  }

  // Deduplicate and finalize columns
  const seenNames = new Set();
  const columns = [];

  for (let i = 0; i < rawColumns.length; i++) {
    const col = rawColumns[i];
    let name = col.name;
    let counter = 1;
    while (seenNames.has(name)) {
      name = `${col.name}_${counter++}`;
    }
    seenNames.add(name);

    const isPk = i === 0 && (name === 'id' || name.endsWith('_id') || name.startsWith('pk_'));
    const isFk = !isPk && (name.endsWith('_id') || name.startsWith('fk_') || (name === 'id' && i > 0));

    columns.push({
      name,
      type: inferSampleType(col.sampleValues),
      ordinalPosition: i,
      isNullable: true,
      isPk,
      isFk
    });
  }

  if (columns.length === 0) {
    throw new Error(`No valid column definitions could be extracted from "${fileName}".`);
  }

  return {
    originalFileName: fileName,
    assetName,
    fileType: fileExt,
    fileSize: file.size,
    sheetName,
    columnCount: columns.length,
    columns
  };
}

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}


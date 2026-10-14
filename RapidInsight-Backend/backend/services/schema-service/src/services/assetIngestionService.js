const crypto = require('crypto');
const path = require('path');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const yaml = require('js-yaml');
const pool = require('../config/db');
const AppError = require('../errors/AppError');
const logger = require('../config/logger');
const { loadOrReplacePhysicalTable } = require('./physicalTableLoaderService');
const { resolveConnector } = require('../connectors');

/**
 * Retrieves the registered catalog asset and its column definitions for an authorized project.
 */
async function getAssetAndColumns(projectId, assetId) {
  if (!projectId) {
    throw new AppError('projectId is required.', 400, 'PROJECT_ID_REQUIRED');
  }
  if (!assetId) {
    throw new AppError('assetId is required.', 400, 'ASSET_ID_REQUIRED');
  }

  const { rows: assetRows } = await pool.query(
    `SELECT ca.asset_id, ca.schema_id, ca.generated_table_id, ca.asset_name, ca.schema_name, ca.project_id, ca.source_id,
            COALESCE(gt.physical_schema_name, s.physical_schema_name, 'public') as physical_schema_name,
            COALESCE(gt.physical_table_name, s.physical_table_name) as physical_table_name,
            COALESCE(gt.status, s.table_status) as table_status
     FROM public.catalog_asset ca
     LEFT JOIN public.generated_tables gt ON gt.id = ca.generated_table_id
     LEFT JOIN public.schemas s ON s.id = ca.schema_id
     WHERE ca.project_id = $1 AND ca.asset_id = $2 AND ca.status = 'ACTIVE'
     LIMIT 1`,
    [projectId, assetId]
  );

  if (!assetRows.length) {
    throw new AppError('Catalog asset not found or not belonging to this project.', 404, 'ASSET_NOT_FOUND');
  }

  const asset = assetRows[0];

  const { rows: columns } = await pool.query(
    `SELECT column_name, data_type, ordinal_position, is_pk, is_nullable
     FROM public.asset_column
     WHERE asset_id = $1
     ORDER BY ordinal_position ASC`,
    [assetId]
  );

  if (!columns.length) {
    throw new AppError(`Asset "${asset.asset_name}" has no registered columns in the catalog.`, 400, 'NO_COLUMNS_REGISTERED');
  }

  return { asset, columns };
}

/**
 * Parses raw file buffer into structured rows and header list.
 * Supports CSV, Excel (.xlsx, .xls), JSON, and YAML.
 */
function parseDataFile({ buffer, originalFileName }) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new AppError('Incoming file buffer is empty.', 400, 'EMPTY_FILE_BUFFER');
  }

  const ext = path.extname(originalFileName || '').toLowerCase();
  let rows = [];
  let headers = [];

  if (ext === '.csv') {
    const text = buffer.toString('utf-8');
    const firstLine = text.split(/\r?\n/).find(l => l.trim().length > 0) || '';
    const headerParse = Papa.parse(firstLine, { header: false });
    const rawHeaders = (headerParse.data && headerParse.data[0])
      ? headerParse.data[0].map(h => String(h || '').trim())
      : [];

    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false
    });

    if (parsed.errors && parsed.errors.length > 0 && (!parsed.data || parsed.data.length === 0)) {
      throw new AppError(`CSV parse failed: ${parsed.errors[0].message}`, 400, 'FILE_PARSE_FAILED');
    }

    rows = parsed.data || [];
    headers = rawHeaders.length > 0 ? rawHeaders : (parsed.meta && parsed.meta.fields) || (rows.length > 0 ? Object.keys(rows[0]) : []);
  } else if (ext === '.xlsx' || ext === '.xls') {
    let workbook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch (err) {
      throw new AppError(`Excel parse failed: ${err.message}`, 400, 'EXCEL_PARSE_FAILED');
    }

    if (!workbook.SheetNames || !workbook.SheetNames.length) {
      throw new AppError('Excel workbook contains no sheets.', 400, 'EXCEL_EMPTY');
    }

    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawSheetRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
    const rawHeaders = (rawSheetRows && rawSheetRows.length > 0 && Array.isArray(rawSheetRows[0]))
      ? rawSheetRows[0].map(h => String(h ?? '').trim())
      : [];

    rows = XLSX.utils.sheet_to_json(firstSheet, { defval: null });
    headers = rawHeaders.length > 0 ? rawHeaders : (rows.length > 0 ? Object.keys(rows[0]) : []);
  } else if (ext === '.json') {
    const text = buffer.toString('utf-8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new AppError(`JSON parse failed: ${err.message}`, 400, 'JSON_PARSE_FAILED');
    }

    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (Array.isArray(parsed?.data)) {
      rows = parsed.data;
    } else if (Array.isArray(parsed?.rows)) {
      rows = parsed.rows;
    } else {
      throw new AppError('JSON data must be an array of records or an object containing a data/rows array.', 400, 'INVALID_JSON_STRUCTURE');
    }
    headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  } else if (ext === '.yaml' || ext === '.yml') {
    const text = buffer.toString('utf-8');
    let parsed;
    try {
      parsed = yaml.load(text);
    } catch (err) {
      throw new AppError(`YAML parse failed: ${err.message}`, 400, 'YAML_PARSE_FAILED');
    }

    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (Array.isArray(parsed?.data)) {
      rows = parsed.data;
    } else {
      throw new AppError('YAML data must be a sequence of records.', 400, 'INVALID_YAML_STRUCTURE');
    }
    headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  } else {
    throw new AppError(`Unsupported file format "${ext}". Expected .csv, .xlsx, .xls, .json, or .yaml.`, 400, 'UNSUPPORTED_FILE_FORMAT');
  }

  if (!rows || rows.length === 0) {
    throw new AppError('The uploaded data file contains no records to ingest.', 400, 'EMPTY_FILE_ROWS');
  }

  return { rows, headers };
}

function isNumericType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return ['number', 'integer', 'int', 'bigint', 'smallint', 'numeric', 'decimal', 'float', 'real', 'double precision', 'int2', 'int4', 'int8', 'float4', 'float8'].includes(norm);
}

function isBooleanType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return ['boolean', 'bool'].includes(norm);
}

function isDateType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return ['date', 'timestamp', 'timestamptz', 'time', 'datetime'].some(t => norm.includes(t));
}

function isUuidType(type) {
  const norm = String(type || '').trim().toLowerCase();
  return norm === 'uuid';
}

/**
 * Validates incoming file structure against registered asset columns.
 * Performs strict checks:
 * 1. Duplicate column detection in file
 * 2. Column count equality (must match registered asset column count)
 * 3. Exact column presence (detects missing and unexpected extra columns)
 * 4. Column data type and nullability validation against sample rows
 */
function validateFileSchema({ headers = [], rows = [], registeredColumns = [] }) {
  if (!Array.isArray(registeredColumns) || registeredColumns.length === 0) {
    return {
      isValid: false,
      error: 'No registered columns found for this asset.',
      code: 'NO_COLUMNS_REGISTERED',
      details: {}
    };
  }

  // 1. Detect duplicate column names in the uploaded file
  const seenHeaders = new Map();
  const duplicateColumns = [];
  headers.forEach(h => {
    const raw = String(h || '').trim();
    const norm = raw.toLowerCase();
    if (!norm) return;
    if (seenHeaders.has(norm)) {
      duplicateColumns.push(raw);
    } else {
      seenHeaders.set(norm, raw);
    }
  });

  if (duplicateColumns.length > 0) {
    const uniqueDups = [...new Set(duplicateColumns)];
    return {
      isValid: false,
      error: `Duplicate column names detected in uploaded file: ${uniqueDups.join(', ')}`,
      code: 'DUPLICATE_COLUMNS_DETECTED',
      details: { duplicateColumns: uniqueDups }
    };
  }

  const uploadedCount = headers.length;
  const registeredCount = registeredColumns.length;

  const uploadedNormalized = new Set(headers.map(h => String(h || '').trim().toLowerCase()));
  const registeredNormalized = new Map(registeredColumns.map(c => [String(c.column_name || '').trim().toLowerCase(), c.column_name]));

  const matchedColumns = [];
  const missingColumns = [];
  for (const [normReg, originalRegName] of registeredNormalized.entries()) {
    if (uploadedNormalized.has(normReg)) {
      matchedColumns.push(originalRegName);
    } else {
      missingColumns.push(originalRegName);
    }
  }

  const unexpectedColumns = [];
  headers.forEach(h => {
    const norm = String(h || '').trim().toLowerCase();
    if (!registeredNormalized.has(norm)) {
      unexpectedColumns.push(String(h).trim());
    }
  });

  // 2. Strict Column Count Check
  if (uploadedCount !== registeredCount) {
    return {
      isValid: false,
      error: `Upload rejected: the selected asset expects ${registeredCount} columns, but the uploaded file contains ${uploadedCount}. Only ${matchedColumns.length} columns match. Please upload the correct file for this asset.`,
      code: 'COLUMN_COUNT_MISMATCH',
      details: {
        expectedColumnCount: registeredCount,
        receivedColumnCount: uploadedCount,
        matchedColumnCount: matchedColumns.length,
        missingColumns,
        unexpectedColumns,
        duplicateColumns: []
      }
    };
  }

  // 3. Strict Column Names Check
  if (missingColumns.length > 0 || unexpectedColumns.length > 0) {
    const reasons = [];
    if (missingColumns.length > 0) reasons.push(`missing registered columns: [${missingColumns.join(', ')}]`);
    if (unexpectedColumns.length > 0) reasons.push(`unexpected extra columns: [${unexpectedColumns.join(', ')}]`);
    return {
      isValid: false,
      error: `Upload rejected: file columns do not match registered schema (${reasons.join('; ')}).`,
      code: 'SCHEMA_MISMATCH',
      details: {
        expectedColumnCount: registeredCount,
        receivedColumnCount: uploadedCount,
        matchedColumnCount: matchedColumns.length,
        missingColumns,
        unexpectedColumns,
        duplicateColumns: []
      }
    };
  }

  // 4. Data Type & Nullability Validation (inspect sample rows)
  const sampleLimit = Math.min(rows.length, 200);
  const incompatibleTypes = [];

  for (const col of registeredColumns) {
    const colName = col.column_name;
    const targetNorm = colName.trim().toLowerCase();
    const fileHeader = headers.find(h => String(h || '').trim().toLowerCase() === targetNorm);
    if (!fileHeader) continue;

    const dataType = col.data_type;
    const isPk = Boolean(col.is_pk);
    const isNullable = col.is_nullable !== false;

    for (let r = 0; r < sampleLimit; r++) {
      const row = rows[r];
      if (!row || typeof row !== 'object') continue;
      const rawVal = row[fileHeader];

      const strRaw = typeof rawVal === 'string' ? rawVal.trim() : '';
      const isNullOrEmpty = rawVal === null || rawVal === undefined || strRaw === '' ||
        (isNullable && ['-', 'nil', 'na', 'n/a', 'null', 'none', '.'].includes(strRaw.toLowerCase()));
      if (isNullOrEmpty) {
        if (!isNullable && !isPk) {
          incompatibleTypes.push(`Column "${colName}" is marked NOT NULL, but contains null or empty values (row ${r + 1}).`);
          break;
        }
        continue;
      }

      // Check type compatibility
      if (isNumericType(dataType)) {
        if (typeof rawVal === 'number' && !isNaN(rawVal)) {
          // valid number
        } else {
          const cleanStr = String(rawVal).trim().replace(/,/g, '');
          const numVal = Number(cleanStr);
          if (isNaN(numVal) || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(cleanStr)) {
            incompatibleTypes.push(`Column "${colName}" expects ${dataType}, but found incompatible value "${rawVal}" (row ${r + 1}).`);
            break;
          }
        }
      } else if (isBooleanType(dataType)) {
        const boolStr = String(rawVal).trim().toLowerCase();
        const validBools = ['true', 'false', '1', '0', 't', 'f', 'yes', 'no', 'y', 'n'];
        if (!validBools.includes(boolStr)) {
          incompatibleTypes.push(`Column "${colName}" expects boolean, but found incompatible value "${rawVal}" (row ${r + 1}).`);
          break;
        }
      } else if (isDateType(dataType)) {
        if (isNaN(Date.parse(String(rawVal).trim()))) {
          incompatibleTypes.push(`Column "${colName}" expects ${dataType}, but found incompatible value "${rawVal}" (row ${r + 1}).`);
          break;
        }
      } else if (isUuidType(dataType)) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(String(rawVal).trim())) {
          incompatibleTypes.push(`Column "${colName}" expects UUID format, but found incompatible value "${rawVal}" (row ${r + 1}).`);
          break;
        }
      }
    }
  }

  if (incompatibleTypes.length > 0) {
    return {
      isValid: false,
      error: `Upload rejected: data type validation failed. ${incompatibleTypes.slice(0, 3).join('; ')}`,
      code: 'INCOMPATIBLE_DATA_TYPES',
      details: {
        expectedColumnCount: registeredCount,
        receivedColumnCount: uploadedCount,
        matchedColumnCount: matchedColumns.length,
        missingColumns: [],
        unexpectedColumns: [],
        duplicateColumns: [],
        incompatibleTypes
      }
    };
  }

  const details = {
    expectedColumnCount: registeredCount,
    receivedColumnCount: uploadedCount,
    matchedColumnCount: matchedColumns.length,
    missingColumns: [],
    unexpectedColumns: [],
    duplicateColumns: [],
    incompatibleTypes: []
  };

  return {
    isValid: true,
    ...details,
    details
  };
}

/**
 * Validates incoming file records against registered column metadata and aligns keys.
 */
function validateAndAlignRows({ rows, headers = null, registeredColumns }) {
  if (!rows || !rows.length) {
    throw new AppError('No data rows available for ingestion.', 400, 'EMPTY_ROWS');
  }

  const derivedHeaders = (headers && headers.length > 0) ? headers : Object.keys(rows[0] || {});

  const validation = validateFileSchema({
    headers: derivedHeaders,
    rows,
    registeredColumns
  });

  if (!validation.isValid) {
    throw new AppError(validation.error, 400, validation.code, validation.details);
  }

  // Construct aligned rows strictly in registered column order
  return rows.map(row => {
    const aligned = {};
    for (const col of registeredColumns) {
      const targetName = col.column_name;
      const matchingKey = Object.keys(row).find(k => k.trim().toLowerCase() === targetName.toLowerCase());
      let val = matchingKey !== undefined ? row[matchingKey] : null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed === '' || (col.is_nullable !== false && ['-', 'nil', 'na', 'n/a', 'null', 'none', '.'].includes(trimmed.toLowerCase()))) {
          val = null;
        } else if (isNumericType(col.data_type)) {
          const clean = trimmed.replace(/,/g, '');
          const parsed = Number(clean);
          if (!isNaN(parsed)) {
            val = parsed;
          }
        }
      }
      aligned[targetName] = val;
    }
    return aligned;
  });
}

/**
 * Generates realistic synthetic mock values for given column specifications.
 */
function generateMockValue(columnName, dataType, isPk, index) {
  const normCol = columnName.toLowerCase();
  const normType = dataType.toLowerCase();

  // Primary keys and IDs
  if (isPk || normCol.endsWith('_id') || normCol === 'id') {
    if (normType === 'uuid') {
      return crypto.randomUUID();
    }
    if (['number', 'integer', 'int', 'bigint', 'numeric'].includes(normType)) {
      return 1000 + index + 1;
    }
    return `ID-${1000 + index + 1}`;
  }

  // Boolean
  if (normType === 'boolean' || normType === 'bool') {
    return index % 2 === 0;
  }

  // Date and Time
  if (['date', 'timestamp', 'timestamptz', 'time'].some(t => normType.includes(t))) {
    const baseDate = new Date(2025, 0, 1);
    baseDate.setDate(baseDate.getDate() + (index % 365));
    return baseDate.toISOString().split('T')[0];
  }

  // Numbers
  if (['number', 'integer', 'int', 'smallint', 'bigint', 'numeric', 'decimal', 'float', 'real'].some(t => normType.includes(t))) {
    if (normCol.includes('age')) return 20 + (index % 55);
    if (normCol.includes('year')) return 2020 + (index % 6);
    if (normCol.includes('score') || normCol.includes('rating')) return ((index % 5) + 1);
    if (normCol.includes('qty') || normCol.includes('quantity') || normCol.includes('count')) return ((index % 50) + 1);
    if (normCol.includes('price') || normCol.includes('salary') || normCol.includes('amount') || normCol.includes('revenue') || normCol.includes('cost')) {
      return Number((100 + (index * 13.5) % 4500).toFixed(2));
    }
    return (index + 1);
  }

  // Strings / Text
  const sampleNames = ['James Smith', 'Maria Garcia', 'Robert Johnson', 'Emma Wilson', 'David Lee', 'Sophia Martinez', 'Michael Brown', 'Olivia Taylor', 'Liam Anderson', 'Ava Thomas'];
  const sampleCities = ['New York', 'London', 'Tokyo', 'San Francisco', 'Toronto', 'Singapore', 'Berlin', 'Sydney', 'Paris', 'Chicago'];
  const sampleCountries = ['USA', 'UK', 'Japan', 'Canada', 'Singapore', 'Germany', 'Australia', 'France'];
  const sampleDepartments = ['Engineering', 'Marketing', 'Sales', 'Finance', 'Human Resources', 'Product', 'Operations', 'Customer Support'];
  const sampleStatuses = ['Active', 'Pending', 'Completed', 'Approved', 'Under Review'];

  if (normCol.includes('email')) {
    const cleanName = sampleNames[index % sampleNames.length].toLowerCase().replace(/\s+/g, '.');
    return `${cleanName}${index + 1}@example.com`;
  }
  if (normCol.includes('first_name')) {
    return sampleNames[index % sampleNames.length].split(' ')[0];
  }
  if (normCol.includes('last_name')) {
    return sampleNames[index % sampleNames.length].split(' ')[1];
  }
  if (normCol.includes('name') || normCol.includes('customer') || normCol.includes('user') || normCol.includes('author') || normCol.includes('employee')) {
    return sampleNames[index % sampleNames.length];
  }
  if (normCol.includes('city')) {
    return sampleCities[index % sampleCities.length];
  }
  if (normCol.includes('country')) {
    return sampleCountries[index % sampleCountries.length];
  }
  if (normCol.includes('dept') || normCol.includes('department')) {
    return sampleDepartments[index % sampleDepartments.length];
  }
  if (normCol.includes('status') || normCol.includes('state')) {
    return sampleStatuses[index % sampleStatuses.length];
  }
  if (normCol.includes('phone') || normCol.includes('mobile')) {
    return `+1-555-01${String(10 + (index % 80))}`;
  }

  return `${columnName}_val_${index + 1}`;
}

/**
 * Generates synthetic rows adhering strictly to registered asset column types.
 */
function generateSyntheticRows(registeredColumns, count) {
  const safeCount = Math.max(1, Math.min(Number(count) || 100, 1000));
  const rows = [];

  for (let i = 0; i < safeCount; i++) {
    const row = {};
    for (const col of registeredColumns) {
      row[col.column_name] = generateMockValue(col.column_name, col.data_type, col.is_pk, i);
    }
    rows.push(row);
  }

  return rows;
}

/**
 * Method A: Ingests an uploaded file (CSV, Excel, JSON, YAML) into the asset's physical destination table.
 */
async function ingestFileIntoAsset({ project, userId, assetId, fileBuffer, originalFileName }) {
  const { asset, columns } = await getAssetAndColumns(project.id, assetId);
  const { rows, headers } = parseDataFile({ buffer: fileBuffer, originalFileName });
  const alignedRows = validateAndAlignRows({ rows, headers, registeredColumns: columns });

  const fields = columns.map(col => ({
    name: col.column_name,
    type: col.data_type,
    notNull: !col.is_nullable,
    required: !col.is_nullable,
    unique: Boolean(col.is_pk),
    primaryKey: Boolean(col.is_pk)
  }));

  const ext = path.extname(originalFileName || '').replace('.', '').toLowerCase() || 'csv';

  const result = await loadOrReplacePhysicalTable({
    pool,
    supabase: null,
    project,
    userId,
    schemaDefinition: { fields },
    rows: alignedRows,
    sanitizedTableName: asset.asset_name,
    originalFileName,
    fileType: ext,
    displayName: `${project.name} / ${asset.asset_name}`,
    source: {
      sourceName: originalFileName,
      sourceType: 'FILE_UPLOAD'
    }
  });

  return {
    success: true,
    message: `Successfully ingested ${alignedRows.length} rows into destination table "${result.physicalTableName}".`,
    assetId,
    assetName: asset.asset_name,
    rowCount: alignedRows.length,
    physicalSchemaName: result.physicalSchemaName,
    physicalTableName: result.physicalTableName,
    status: 'POPULATED'
  };
}

/**
 * Method B: Generates synthetic mock records and ingests them into the asset's destination table.
 */
async function ingestMockDataIntoAsset({ project, userId, assetId, rowCount = 100 }) {
  const { asset, columns } = await getAssetAndColumns(project.id, assetId);
  const count = Math.max(1, Math.min(Number(rowCount) || 100, 1000));
  const mockRows = generateSyntheticRows(columns, count);

  const fields = columns.map(col => ({
    name: col.column_name,
    type: col.data_type,
    notNull: !col.is_nullable,
    required: !col.is_nullable,
    unique: Boolean(col.is_pk),
    primaryKey: Boolean(col.is_pk)
  }));

  const result = await loadOrReplacePhysicalTable({
    pool,
    supabase: null,
    project,
    userId,
    schemaDefinition: { fields },
    rows: mockRows,
    sanitizedTableName: asset.asset_name,
    originalFileName: `${asset.asset_name}_synthetic.csv`,
    fileType: 'csv',
    displayName: `${project.name} / ${asset.asset_name} (Synthetic)`,
    source: {
      sourceName: 'Synthetic Data Generator',
      sourceType: 'INTERNAL_PROJECT_DB'
    }
  });

  return {
    success: true,
    message: `Successfully generated and loaded ${mockRows.length} synthetic rows into table "${result.physicalTableName}".`,
    assetId,
    assetName: asset.asset_name,
    rowCount: mockRows.length,
    physicalSchemaName: result.physicalSchemaName,
    physicalTableName: result.physicalTableName,
    isSynthetic: true,
    status: 'POPULATED'
  };
}

/**
 * Method C: Connects to an external database, reads rows from a chosen source table, applies column mapping, and loads into destination table.
 */
async function ingestDatabaseIntoAsset({
  project,
  userId,
  assetId,
  connectionConfig,
  sourceSchema = 'public',
  sourceTable,
  columnMapping = {},
  limit = 500
}) {
  if (!connectionConfig) {
    throw new AppError('connectionConfig is required.', 400, 'CONNECTION_CONFIG_REQUIRED');
  }
  if (!sourceTable) {
    throw new AppError('sourceTable is required.', 400, 'SOURCE_TABLE_REQUIRED');
  }

  const { asset, columns } = await getAssetAndColumns(project.id, assetId);
  const { connector, resolvedType } = resolveConnector(connectionConfig);
  const client = await connector.createClient(connectionConfig);

  try {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 5000));
    const safeSchema = String(sourceSchema || 'public').replace(/"/g, '""');
    const safeTable = String(sourceTable).replace(/"/g, '""');

    const sourceResult = await client.query(`SELECT * FROM "${safeSchema}"."${safeTable}" LIMIT $1;`, [safeLimit]);
    const sourceRows = sourceResult.rows || [];

    if (!sourceRows.length) {
      throw new AppError(`Source table "${safeSchema}.${safeTable}" has no records to import.`, 400, 'SOURCE_TABLE_EMPTY');
    }

    // Remap source rows to target registered columns
    const mappedRows = sourceRows.map(srcRow => {
      const mapped = {};
      for (const col of columns) {
        const targetColName = col.column_name;
        const sourceColName = columnMapping[targetColName] || targetColName;
        // Check source row case-insensitively
        const matchingKey = Object.keys(srcRow).find(k => k.trim().toLowerCase() === sourceColName.toLowerCase());
        mapped[targetColName] = matchingKey !== undefined ? srcRow[matchingKey] : null;
      }
      return mapped;
    });

    const fields = columns.map(col => ({
      name: col.column_name,
      type: col.data_type,
      notNull: !col.is_nullable,
      required: !col.is_nullable,
      unique: Boolean(col.is_pk),
      primaryKey: Boolean(col.is_pk)
    }));

    const result = await loadOrReplacePhysicalTable({
      pool,
      supabase: null,
      project,
      userId,
      schemaDefinition: { fields },
      rows: mappedRows,
      sanitizedTableName: asset.asset_name,
      originalFileName: `${sourceTable}`,
      fileType: 'sql',
      displayName: `${project.name} / ${asset.asset_name} (DB Import)`,
      source: {
        sourceName: `Database: ${sourceTable}`,
        sourceType: resolvedType === 'postgres' ? 'EXTERNAL_POSTGRESQL' : `EXTERNAL_${resolvedType.toUpperCase()}`
      }
    });

    return {
      success: true,
      message: `Successfully imported ${mappedRows.length} rows from "${sourceSchema}.${sourceTable}" into destination table "${result.physicalTableName}".`,
      assetId,
      assetName: asset.asset_name,
      rowCount: mappedRows.length,
      physicalSchemaName: result.physicalSchemaName,
      physicalTableName: result.physicalTableName,
      status: 'POPULATED'
    };
  } finally {
    await connector.closeClient(client);
  }
}

module.exports = {
  getAssetAndColumns,
  parseDataFile,
  validateFileSchema,
  validateAndAlignRows,
  generateSyntheticRows,
  ingestFileIntoAsset,
  ingestMockDataIntoAsset,
  ingestDatabaseIntoAsset
};

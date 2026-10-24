const crypto = require('crypto');
const AppError = require('../errors/AppError');
const logger = require('../config/logger');
const { quoteIdentifier, buildPhysicalTableName } = require('../utils/identifierNaming');
const { registerCatalogMetadata } = require('./catalogIngestionService');

function mapSqlType(type) {
  const norm = String(type || 'string').toLowerCase().trim();
  switch (norm) {
    case 'number':
    case 'integer':
    case 'decimal':
    case 'numeric':
    case 'float':
    case 'real':
      return 'numeric';
    case 'boolean':
      return 'boolean';
    case 'date':
      return 'date';
    case 'uuid':
      return 'uuid';
    default:
      return 'text';
  }
}

function computeCanonicalFingerprint(fields = [], rows = []) {
  const canonicalFields = [...fields]
    .map(f => ({
      name: String(f.name || '').toLowerCase().trim(),
      type: String(f.type || 'string').toLowerCase().trim(),
      notNull: Boolean(f.notNull || f.not_null || f.required),
      unique: Boolean(f.unique)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const sampleRows = rows.slice(0, 1000);
  const rowStrings = sampleRows.map(row => {
    if (!row || typeof row !== 'object') return '';
    return canonicalFields
      .map(f => {
        const val = row[f.name] ?? row[Object.keys(row).find(k => k.toLowerCase() === f.name)] ?? '';
        return `${f.name}:${String(val).trim()}`;
      })
      .join(';');
  });

  const payload = JSON.stringify({
    fields: canonicalFields,
    totalRows: rows.length,
    rowSample: rowStrings
  });

  return crypto.createHash('sha256').update(payload).digest('hex');
}

function validateIncomingData(fields, rows = []) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new AppError('Data validation failed: Schema must define at least one valid column.', 400, 'INVALID_SCHEMA_DEFINITION');
  }

  for (const field of fields) {
    if (!field.name || typeof field.name !== 'string' || !field.name.trim()) {
      throw new AppError('Data validation failed: Column name cannot be empty.', 400, 'INVALID_COLUMN_NAME');
    }
  }

  if (rows.length > 0) {
    const isMalformed = rows.some(r => r === null || typeof r !== 'object');
    if (isMalformed) {
      throw new AppError('Data validation failed: Incoming data contains malformed row records.', 400, 'MALFORMED_DATA_ROWS');
    }
  }
}

function buildCreateTableSql({ schemaName, tableName, fields }) {
  const systemColumns = [
    `"__ris_id" uuid primary key default gen_random_uuid()`,
    `"__ris_generated_table_id" uuid not null`,
    `"__ris_created_by" uuid`,
    `"__ris_created_at" timestamptz not null default now()`
  ];

  const userColumns = fields.map(field => {
    const colName = quoteIdentifier(field.name);
    const sqlType = mapSqlType(field.type);
    const constraints = [];
    if (field.notNull || field.not_null || field.required) constraints.push('not null');
    if (field.unique) constraints.push('unique');
    return `${colName} ${sqlType} ${constraints.join(' ')}`.trim();
  });

  return `
    CREATE TABLE ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} (
      ${systemColumns.concat(userColumns).join(',\n      ')}
    );
  `;
}

function normalizeCellValue(val, field) {
  if (val === undefined || val === null || val === '') return null;
  const type = mapSqlType(field.type);
  if (type === 'numeric') {
    const clean = String(val).replace(/,/g, '').trim();
    const num = Number(clean);
    return Number.isNaN(num) ? null : num;
  }
  if (type === 'boolean') {
    const s = String(val).toLowerCase().trim();
    if (s === 'true' || s === '1' || s === 't' || s === 'yes') return true;
    if (s === 'false' || s === '0' || s === 'f' || s === 'no') return false;
    return null;
  }
  if (type === 'date') {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  }
  return String(val);
}

async function insertRowsBatch({ client, schemaName, tableName, fields, rows, generatedTableId, userId }) {
  if (!rows.length) return 0;

  const colNames = fields.map(f => f.name);
  const quotedCols = colNames.map(name => quoteIdentifier(name));
  const allCols = ['"__ris_generated_table_id"', '"__ris_created_by"', ...quotedCols];

  const colsPerRow = allCols.length;
  const CHUNK_SIZE = Math.max(1, Math.floor(30000 / colsPerRow));

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const values = [];
    const placeholders = [];

    chunk.forEach((row, rowIndex) => {
      const offset = rowIndex * colsPerRow;
      values.push(generatedTableId);
      values.push(userId);

      colNames.forEach(col => {
        const rawVal = row[col] ?? row[Object.keys(row).find(k => k.toLowerCase() === col.toLowerCase())];
        const field = fields.find(f => f.name === col);
        values.push(normalizeCellValue(rawVal, field));
      });

      const rowPlaceholders = Array.from({ length: colsPerRow }, (_, cIdx) => `$${offset + cIdx + 1}`);
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    });

    const insertSql = `
      INSERT INTO ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}
      (${allCols.join(', ')})
      VALUES ${placeholders.join(', ')};
    `;

    await client.query(insertSql, values);
  }

  return rows.length;
}

/**
 * Loads or replaces a physical database table and synchronizes metadata.
 */
async function loadOrReplacePhysicalTable({
  pool,
  supabase,
  project,
  userId,
  schemaDefinition,
  rows = [],
  sanitizedTableName,
  originalFileName,
  fileType = 'csv',
  storagePath = null,
  dataStoragePath = null,
  bucket = null,
  displayName = null,
  source = null,
  assetType = null,
  assetId = null
}) {
  const fields = schemaDefinition.fields || schemaDefinition.columns || [];

  // 1. Validate data before modifying existing state
  validateIncomingData(fields, rows);

  // 2. Compute canonical fingerprint
  const fingerprint = computeCanonicalFingerprint(fields, rows);

  // 3. Connect client and begin single ACID transaction with PostgreSQL advisory lock
  const client = await pool.connect();
  let schemaId;
  let generatedTableId;
  let physicalTableName;
  const physicalSchemaName = project.physical_schema_name || 'public';
  let isUpdate = false;

  try {
    await client.query('BEGIN');

    // Advisory transaction lock scoped to (project_id, sanitized_table_name).
    // Serializes concurrent requests targeting the same project and table at the PostgreSQL engine level.
    const lockKey = `${project.id}:${sanitizedTableName}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);

    // Check existing schema within the lock
    const { rows: existingRows } = await client.query(
      `SELECT id, seed_fingerprint, physical_table_name, physical_schema_name, generated_table_id, table_status
       FROM public.schemas
       WHERE project_id = $1 AND sanitized_table_name = $2
       LIMIT 1`,
      [project.id, sanitizedTableName]
    );

    const existingSchema = existingRows[0] || null;

    if (existingSchema) {
      // Check if incoming data and schema are unchanged
      if (existingSchema.seed_fingerprint === fingerprint && existingSchema.table_status === 'BUILT') {
        await client.query('ROLLBACK');
        throw new AppError(
          `Table "${sanitizedTableName}" already exists with identical schema and data. Duplicate upload blocked.`,
          409,
          'DUPLICATE_TABLE_BLOCKED'
        );
      }
    }

    isUpdate = Boolean(existingSchema);
    schemaId = isUpdate ? existingSchema.id : crypto.randomUUID();
    physicalTableName = isUpdate && existingSchema.physical_table_name
      ? existingSchema.physical_table_name
      : buildPhysicalTableName({ schemaId, sourceName: sanitizedTableName });

    generatedTableId = isUpdate && existingSchema.generated_table_id
      ? existingSchema.generated_table_id
      : crypto.randomUUID();

    // 4. Safe replacement: Drop existing table if updating
    if (isUpdate) {
      await client.query(
        `DROP TABLE IF EXISTS ${quoteIdentifier(physicalSchemaName)}.${quoteIdentifier(physicalTableName)} CASCADE;`
      );
    }

    // Create target physical table
    const createSql = buildCreateTableSql({
      schemaName: physicalSchemaName,
      tableName: physicalTableName,
      fields
    });
    await client.query(createSql);

    // Insert actual data rows if present
    if (rows.length > 0) {
      await insertRowsBatch({
        client,
        schemaName: physicalSchemaName,
        tableName: physicalTableName,
        fields,
        rows,
        generatedTableId,
        userId
      });
    }

    // 5. Update or insert public.schemas within transaction
    const finalDisplayName = displayName || `${project.name} / ${originalFileName}`;
    if (isUpdate) {
      await client.query(
        `UPDATE public.schemas
         SET field_count = $1,
             table_status = 'BUILT',
             seed_fingerprint = $2,
             uploaded_row_count = $3,
             physical_schema_name = $4,
             physical_table_name = $5,
             data_source = $6,
             seed_status = 'not_required',
             data_storage_path = coalesce($8, data_storage_path),
             updated_at = now()
         WHERE id = $7`,
        [fields.length, fingerprint, rows.length, physicalSchemaName, physicalTableName, rows.length > 0 ? 'uploaded' : 'faker', schemaId, dataStoragePath]
      );
    } else {
      const finalBucket = bucket || process.env.SCHEMA_STORAGE_BUCKET || 'schemas';
      const finalStoragePath = storagePath || `${userId}/${project.id}/${schemaId}/schema.json`;
      await client.query(
        `INSERT INTO public.schemas (
          id, user_id, project_id, original_file_name, display_name, storage_bucket, storage_path,
          file_type, field_count, status, table_status, sanitized_table_name, physical_schema_name,
          physical_table_name, data_source, seed_fingerprint, uploaded_row_count,
          seed_status, data_storage_path, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'uploaded', 'BUILT', $10, $11, $12, $13, $14, $15, 'not_required', $16, now(), now())`,
        [schemaId, userId, project.id, originalFileName, finalDisplayName, finalBucket, finalStoragePath, fileType, fields.length, sanitizedTableName, physicalSchemaName, physicalTableName, rows.length > 0 ? 'uploaded' : 'faker', fingerprint, rows.length, dataStoragePath]
      );
    }

    // 6. Update or insert public.generated_tables within transaction
    const { rows: existingGtRows } = await client.query(
      `SELECT id FROM public.generated_tables WHERE id = $1 OR schema_id = $2 LIMIT 1`,
      [generatedTableId, schemaId]
    );

    if (existingGtRows.length) {
      generatedTableId = existingGtRows[0].id;
      await client.query(
        `UPDATE public.generated_tables
         SET row_count = $1,
             status = $2,
             source_file_name = $3,
             physical_schema_name = $4,
             physical_table_name = $5,
             updated_at = now()
         WHERE id = $6`,
        [rows.length, rows.length > 0 ? 'POPULATED' : 'CREATED', originalFileName, physicalSchemaName, physicalTableName, generatedTableId]
      );
    } else {
      await client.query(
        `INSERT INTO public.generated_tables (
          id, schema_id, project_id, created_by, physical_schema_name, physical_table_name,
          row_count, status, sanitized_table_name, source_file_name, version, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, now(), now())`,
        [generatedTableId, schemaId, project.id, userId, physicalSchemaName, physicalTableName, rows.length, rows.length > 0 ? 'POPULATED' : 'CREATED', sanitizedTableName, originalFileName]
      );
    }

    // Link generated_table_id on public.schemas within transaction
    await client.query(
      `UPDATE public.schemas SET generated_table_id = $1 WHERE id = $2`,
      [generatedTableId, schemaId]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof AppError) throw err;
    logger.error({ err, tableName: sanitizedTableName }, 'Transaction rolled back during physical table load/replace');
    throw new AppError(`Physical table load failed: ${err.message}`, 500, 'PHYSICAL_TABLE_LOAD_FAILED');
  } finally {
    client.release();
  }

  // 7. Update Catalog Metadata
  await registerCatalogMetadata({
    project,
    userId,
    source: source || {
      sourceName: 'Uploaded Schema Files',
      sourceType: 'FILE_UPLOAD'
    },
    asset: {
      assetId,
      schemaId,
      generatedTableId,
      schemaName: physicalSchemaName,
      assetName: sanitizedTableName,
      assetType: assetType || (source?.sourceType === 'EXTERNAL_POSTGRESQL' ? 'TABLE' : 'FILE_SCHEMA')
    },
    columns: fields
  });

  // Ensure catalog asset is flagged as populated
  await pool.query(
    `UPDATE public.catalog_asset
     SET generated_table_id = $1, updated_at = now()
     WHERE project_id = $2 AND schema_id = $3`,
    [generatedTableId, project.id, schemaId]
  );

  return {
    schemaId,
    generatedTableId,
    physicalSchemaName,
    physicalTableName,
    rowCount: rows.length,
    isUpdate,
    status: rows.length > 0 ? 'POPULATED' : 'CREATED'
  };
}

module.exports = {
  computeCanonicalFingerprint,
  validateIncomingData,
  buildCreateTableSql,
  loadOrReplacePhysicalTable
};

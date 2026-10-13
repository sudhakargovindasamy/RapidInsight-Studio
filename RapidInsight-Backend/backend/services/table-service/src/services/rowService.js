const pool = require('../config/postgres');
const { quoteIdentifier } = require('../utils/identifierNaming');
const { normalizeRowForInsert, getFields } = require('./tableSqlBuilder');

async function insertRows({
  generatedTable,
  schemaDefinition,
  rows,
  userId
}) {
  if (!rows.length) return 0;

  const fields = getFields(schemaDefinition);
  const userColumns = fields.map((field) => field.name);

  const allColumns = [
    '__ris_generated_table_id',
    '__ris_created_by',
    ...userColumns
  ];

  const columnsPerRow = allColumns.length;
  const MAX_PARAMS = 30000;
  const chunkLimit = Math.max(1, Math.floor(MAX_PARAMS / columnsPerRow));

  const client = await pool.connect();

  /*
   * One transaction for the whole table.
   *
   * Chunks previously committed independently, so a failure partway through
   * left the table holding some of its rows with no way to roll back - and the
   * caller would then record a row count that did not match what was inserted.
   * All or nothing is the only sane outcome here.
   */
  try {
    await client.query('begin');

    for (let i = 0; i < rows.length; i += chunkLimit) {
      const chunkRows = rows.slice(i, i + chunkLimit);

      const normalizedChunk = chunkRows.map((row) => {
        const clean = normalizeRowForInsert(row, schemaDefinition);

        return [
          generatedTable.id,
          userId,
          ...userColumns.map((column) => clean[column] ?? null)
        ];
      });

      const values = [];
      const placeholders = normalizedChunk.map((row, rowIndex) => {
        const offset = rowIndex * columnsPerRow;

        row.forEach((value) => values.push(value));

        return `(${row.map((_, columnIndex) => `$${offset + columnIndex + 1}`).join(', ')})`;
      });

      const sql = `
        insert into ${quoteIdentifier(generatedTable.physical_schema_name)}.${quoteIdentifier(generatedTable.physical_table_name)}
          ("__ris_generated_table_id", "__ris_created_by"${userColumns.length ? ', ' + userColumns.map(quoteIdentifier).join(', ') : ''})
        values ${placeholders.join(', ')}
      `;

      await client.query(sql, values);
    }

    await client.query('commit');
  } catch (error) {
    // Rolling back can itself fail if the connection died. That must not mask
    // the original error, which is the one that explains what went wrong.
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      console.error('Rollback failed after insert error:', rollbackError.message);
    }

    throw error;
  } finally {
    client.release();
  }

  return rows.length;
}

async function readRows({ generatedTable, pageSize, offset }) {
  const client = await pool.connect();

  try {
    const countResult = await client.query(
      `select count(*)::int as count from ${quoteIdentifier(generatedTable.physical_schema_name)}.${quoteIdentifier(generatedTable.physical_table_name)}`
    );

    const rowsResult = await client.query(
      `select * from ${quoteIdentifier(generatedTable.physical_schema_name)}.${quoteIdentifier(generatedTable.physical_table_name)}
       order by "__ris_created_at" desc
       limit $1 offset $2`,
      [pageSize, offset]
    );

    return {
      total: Number(countResult.rows[0]?.count || 0),
      rows: rowsResult.rows
    };
  } finally {
    client.release();
  }
}

module.exports = {
  insertRows,
  readRows
};
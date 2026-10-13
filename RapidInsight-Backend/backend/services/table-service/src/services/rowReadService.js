const pool = require('../config/db');
const { quoteQualifiedIdentifier } = require('../utils/identifierUtils');

async function readRows({ schemaName = 'public', tableName, userId, limit, offset }) {
  const qualifiedName = quoteQualifiedIdentifier(schemaName, tableName);

  const dataQuery = `
    SELECT *
    FROM ${qualifiedName}
    WHERE "__ris_created_by" = $1
    ORDER BY "__ris_created_at" DESC
    LIMIT $2 OFFSET $3
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM ${qualifiedName}
    WHERE "__ris_created_by" = $1
  `;

  let dataResult, countResult;
  try {
    [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, [userId, limit, offset]),
      pool.query(countQuery, [userId]),
    ]);
  } catch (error) {
    if (error.code === '42P01') {
      // 42P01 is the PostgreSQL error code for undefined_table
      const notFoundError = new Error(`Table ${tableName} does not exist in the database. Please rebuild the table.`);
      notFoundError.statusCode = 404;
      throw notFoundError;
    }
    throw error;
  }

  return {
    rows: dataResult.rows,
    total: countResult.rows[0]?.total || 0,
  };
}

module.exports = {
  readRows,
};

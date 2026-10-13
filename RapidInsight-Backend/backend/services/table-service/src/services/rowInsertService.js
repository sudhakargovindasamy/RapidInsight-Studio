const pool = require('../config/db');
const { buildInsertSql } = require('../utils/buildInsertSql');

async function insertRows({ schemaName = 'public', tableName, schemaDefinition, rows, generatedTableId, userId }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const { sql, values } = buildInsertSql({
    schemaName,
    tableName,
    schemaDefinition,
    rows,
    generatedTableId,
    userId,
  });

  try {
    await pool.query(sql, values);
    return rows.length;
  } catch (error) {
    if (error.code === '42P01') {
      const notFoundError = new Error(`Table ${tableName} does not exist. Please rebuild the table from the schema first.`);
      notFoundError.statusCode = 404;
      throw notFoundError;
    }
    throw error;
  }
}

module.exports = {
  insertRows,
};

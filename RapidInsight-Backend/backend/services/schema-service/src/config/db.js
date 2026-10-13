const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.DATABASE_URL,

  ssl: env.DATABASE_URL.includes('localhost')
    ? false
    : {
        rejectUnauthorized: false
      }
});

module.exports = pool;

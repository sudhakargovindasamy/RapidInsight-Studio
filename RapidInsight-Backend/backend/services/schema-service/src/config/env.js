const { cleanEnv, str, port, num } = require('envalid');

const env = cleanEnv(process.env, {
  NODE_ENV: str({
    choices: ['development', 'test', 'production'],
    default: 'development'
  }),

  PORT: port({
    default: 3001
  }),

  SHUTDOWN_TIMEOUT_MS: num({
    default: 10000
  }),

  DATABASE_URL: str(),

  SUPABASE_URL: str(),

  SUPABASE_PUBLISHABLE_KEY: str(),

  SUPABASE_SERVICE_ROLE_KEY: str(),

  INTERNAL_SERVICE_KEY: str(),

  // Used to generate SDV seed rows in the background when a schema is uploaded
  // with "Generate mock data".
  AI_SERVICE_URL: str({
    default: 'http://localhost:3005'
  }),

  SCHEMA_STORAGE_BUCKET: str({
    default: 'schemas'
  }),

  MAX_SCHEMA_FILE_SIZE_MB: num({
    default: 5
  }),

  LOG_LEVEL: str({
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
    default: 'info'
  })
});

module.exports = env;
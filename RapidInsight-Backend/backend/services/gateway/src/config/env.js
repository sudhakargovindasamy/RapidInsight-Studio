const {
    cleanEnv,
    str,
    port,
    url,
    num,
    bool
} = require('envalid');

const env = cleanEnv(process.env, {
    NODE_ENV: str({
        choices: ['development', 'test', 'production'],
        default: 'development'
    }),

    PORT: port({
        default: 3000
    }),

    FRONTEND_ORIGIN: str({
        default: '*'
    }),

    TRUST_PROXY: bool({
        default: false
    }),

    SHUTDOWN_TIMEOUT_MS: num({
        default: 10000
    }),

    SUPABASE_URL: url(),
    SUPABASE_PUBLISHABLE_KEY: str(),
    SUPABASE_SERVICE_ROLE_KEY: str(),
    INTERNAL_SERVICE_KEY: str(),

    PROJECT_SERVICE_URL: url(),
    SCHEMA_SERVICE_URL: url(),
    TABLE_SERVICE_URL: url(),
    DATAGEN_SERVICE_URL: url(),
    REPORT_SERVICE_URL: url(),
    EXPORT_SERVICE_URL: url()
});

module.exports = env;
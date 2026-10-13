const pino = require('pino');
const env = require('./env');

const isProduction = env.NODE_ENV === 'production';

const logger = pino({
  name: 'schema-service',

  level: env.LOG_LEVEL,

  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'headers.authorization',
      'headers.cookie',
      'password',
      'confirmPassword'
    ],
    censor: '[REDACTED]'
  },

  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          singleLine: false,
          ignore: 'pid,hostname'
        }
      }
    : undefined
});

module.exports = logger;
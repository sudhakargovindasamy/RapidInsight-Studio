const pino = require('pino');
const env = require('./env');

const logger = pino({
    level: env.NODE_ENV === 'production' ? 'info' : 'debug',

    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.confirmPassword'
        ],
        censor: '[REDACTED]'
    },

    transport:
        env.NODE_ENV === 'development'
            ? {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname'
                }
            }
            : undefined
});

module.exports = logger;
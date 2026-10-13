const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const applicationState = require('./config/applicationState');

const authRoutes = require('./routes/authRoutes');

const authenticateUser = require('./middlewares/authenticateUser');
const proxyWithUserContext = require('./middlewares/proxyWithUserContext');
const requestLogger = require('./middlewares/requestLogger');
const notFoundHandler = require('./middlewares/notFoundHandler');
const errorHandler = require('./middlewares/errorHandler');

const {
    apiRateLimiter,
    authRateLimiter
} = require('./middlewares/rateLimiters');

const app = express();

if (env.TRUST_PROXY) {
    app.set('trust proxy', 1);
}

// Request ID and structured logging
app.use(requestLogger);

// Security headers
app.use(helmet());

// Allow only the configured frontend
app.use(
    cors({
        origin: env.FRONTEND_ORIGIN === '*' ? true : env.FRONTEND_ORIGIN,
        methods: [
            'GET',
            'POST',
            'PUT',
            'PATCH',
            'DELETE',
            'OPTIONS'
        ],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Request-Id'
        ],
        exposedHeaders: [
            'X-Request-Id',
            'RateLimit'
        ],
        credentials: false,
        optionsSuccessStatus: 204
    })
);

// Protect Gateway APIs against excessive requests
app.use(apiRateLimiter);

// Liveness check:
// Is the Gateway process running?
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        service: 'gateway',
        status: 'healthy',
        requestId: req.id
    });
});

// Readiness check:
// Is the Gateway ready to receive traffic?
app.get('/ready', (req, res) => {
    if (!applicationState.isReady()) {
        return res.status(503).json({
            success: false,
            service: 'gateway',
            status: 'not-ready',
            requestId: req.id
        });
    }

    return res.status(200).json({
        success: true,
        service: 'gateway',
        status: 'ready',
        requestId: req.id
    });
});

// Authentication routes have stronger rate limiting
app.use(
    '/auth',
    authRateLimiter,
    express.json({ limit: '1mb' }),
    authRoutes
);

// Protected service routes
app.use(
    '/me',
    authenticateUser,
    proxyWithUserContext(env.PROJECT_SERVICE_URL)
);

app.use(
    '/projects',
    authenticateUser,
    proxyWithUserContext(env.PROJECT_SERVICE_URL)
);

app.use(
    '/schema',
    authenticateUser,
    proxyWithUserContext(env.SCHEMA_SERVICE_URL)
);

app.use(
    '/tables',
    authenticateUser,
    proxyWithUserContext(env.TABLE_SERVICE_URL)
);

app.use(
    '/datagen',
    authenticateUser,
    proxyWithUserContext(env.DATAGEN_SERVICE_URL)
);

app.use(
    '/reports',
    authenticateUser,
    proxyWithUserContext(env.REPORT_SERVICE_URL)
);

app.use(
    '/export',
    authenticateUser,
    proxyWithUserContext(env.EXPORT_SERVICE_URL)
);

// These must remain last
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
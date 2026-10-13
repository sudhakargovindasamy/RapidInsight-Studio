require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const tableRoutes = require('./routes/tableRoutes');
const verifyInternalRequest = require('./middlewares/verifyInternalRequest');

const app = express();

const PORT =
  Number.parseInt(process.env.TABLE_SERVICE_PORT, 10) || 3003;

const JSON_BODY_LIMIT =
  process.env.JSON_BODY_LIMIT || '10mb';

app.disable('x-powered-by');

app.use(cors());

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  morgan(':method :url :status :response-time ms')
);

app.use(
  express.json({
    limit: JSON_BODY_LIMIT,
    strict: true
  })
);

app.use(
  express.urlencoded({
    extended: false,
    limit: JSON_BODY_LIMIT
  })
);

/*
 * Public health endpoint.
 * Do not put verifyInternalRequest before this endpoint.
 */
app.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    service: 'table-service',
    status: 'healthy',
    aiServiceUrl:
      process.env.AI_SERVICE_URL ||
      'http://localhost:3005'
  });
});

/*
 * All /tables routes are internal routes.
 *
 * verifyInternalRequest validates:
 * - x-internal-service-key
 * - x-user-id
 *
 * It also creates:
 * req.user = { id, email }
 */
app.use(
  '/tables',
  verifyInternalRequest,
  tableRoutes
);

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: 'TABLE_ROUTE_NOT_FOUND',
    message: 'Table service route not found.'
  });
});

app.use((error, req, res, next) => {
  const isPayloadTooLarge =
    error?.type === 'entity.too.large' ||
    error?.status === 413 ||
    error?.statusCode === 413;

  const statusCode = isPayloadTooLarge
    ? 413
    : error?.statusCode ||
    error?.status ||
    500;

  const code = isPayloadTooLarge
    ? error?.code || 'REQUEST_PAYLOAD_TOO_LARGE'
    : error?.code || 'TABLE_SERVICE_ERROR';

  const message = isPayloadTooLarge
    ? error?.message ||
    'The AI blueprint request or response exceeded the accepted size.'
    : error?.message ||
    'Internal table service error.';

  console.error('Table service request failed', {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    message,
    details: error?.details || null
  });

  if (res.headersSent) {
    return next(error);
  }

  return res.status(statusCode).json({
    success: false,
    code,
    message,
    details:
      process.env.NODE_ENV === 'production'
        ? undefined
        : error?.details || undefined
  });
});

const server = app.listen(PORT, () => {
  console.log(`Table service running on port ${PORT}`);

  console.log(
    `AI service URL: ${process.env.AI_SERVICE_URL ||
    'http://localhost:3005'
    }`
  );

  console.log(`JSON body limit: ${JSON_BODY_LIMIT}`);
});

function shutdown(signal) {
  console.log(
    `${signal} received. Shutting down table service.`
  );

  server.close((error) => {
    if (error) {
      console.error(
        'Failed to close table service cleanly',
        {
          message: error.message
        }
      );

      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forcing table service shutdown.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGUSR2', () => {
  server.close(() => {
    process.kill(process.pid, 'SIGUSR2');
  });
});

module.exports = {
  app,
  server
};
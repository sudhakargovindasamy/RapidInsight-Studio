require('dotenv').config(); // Trigger restart again

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const aiRoutes = require('./routes/aiRoutes');

const app = express();

const PORT = Number.parseInt(
  process.env.AI_SERVICE_PORT,
  10
) || 3005;

const JSON_BODY_LIMIT =
  process.env.JSON_BODY_LIMIT ||
  '10mb';

app.disable('x-powered-by');

app.use(cors());

app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);

app.use(
  morgan(
    ':method :url :status :response-time ms'
  )
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

app.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    service: 'ai-service',
    status: 'healthy',
    provider:
      process.env.AI_PROVIDER ||
      'gemini',
    model:
      process.env.AI_MODEL ||
      'gemini-3-flash'
  });
});

app.use('/ai', aiRoutes);

app.use((req, res) => {
  return res.status(404).json({
    success: false,
    code: 'AI_ROUTE_NOT_FOUND',
    message: 'AI service route not found.'
  });
});

app.use((error, req, res, next) => {
  const isPayloadTooLarge =
    error?.type === 'entity.too.large' ||
    error?.status === 413 ||
    error?.statusCode === 413;

  const statusCode = isPayloadTooLarge
    ? 413
    : error.statusCode ||
    error.status ||
    500;

  const code = isPayloadTooLarge
    ? 'AI_REQUEST_PAYLOAD_TOO_LARGE'
    : error.code ||
    'AI_SERVICE_ERROR';

  const message = isPayloadTooLarge
    ? `AI service request body exceeded the configured ${JSON_BODY_LIMIT} limit.`
    : error.message ||
    'Internal AI service error.';

  console.error('AI service request failed', {
    method: req.method,
    path: req.originalUrl,
    statusCode,
    code,
    message,
    details: error.details || null
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
        : error.details || undefined
  });
});

const server = app.listen(PORT, () => {
  console.log(`AI service running on port ${PORT}`);
  console.log(`AI provider: ${process.env.AI_PROVIDER || 'gemini'}`);
  console.log(`AI model: ${process.env.AI_MODEL || 'gemini-3-flash'}`);
  console.log(`JSON body limit: ${JSON_BODY_LIMIT}`);
});

function shutdown(signal) {
  console.log(`${signal} received. Shutting down AI service.`);

  server.close((error) => {
    if (error) {
      console.error('Failed to close AI service cleanly', {
        message: error.message
      });

      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forcing AI service shutdown.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = {
  app,
  server
};
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const applicationState = require('./config/applicationState');

const requestLogger = require('./middlewares/requestLogger');
const verifyInternalRequest = require('./middlewares/verifyInternalRequest');
const notFoundHandler = require('./middlewares/notFoundHandler');
const errorHandler = require('./middlewares/errorHandler');

const schemaRoutes = require('./routes/schemaRoutes');
const catalogRoutes = require('./routes/catalogRoutes');

const app = express();


app.use(requestLogger);

app.use(cors());

app.use(helmet());


app.get('/health', (req, res) => {
  return res.status(200).json({
    success: true,
    service: 'schema-service',
    status: 'healthy',
    requestId: req.id
  });
});

app.get('/ready', (req, res) => {
  const ready = applicationState.isReady();

  return res.status(ready ? 200 : 503).json({
    success: ready,
    service: 'schema-service',
    status: ready ? 'ready' : 'not_ready',
    requestId: req.id
  });
});

app.use(verifyInternalRequest);

app.use(express.json({ limit: '10mb' }));

app.use('/schema/catalog', catalogRoutes);
app.use('/schema', schemaRoutes);

/*
 * These must remain after all routes.
 */
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const applicationState = require('./config/applicationState');

let isShuttingDown = false;

const SCHEMA_PORT = process.env.SCHEMA_SERVICE_PORT || 3001;

const server = app.listen(SCHEMA_PORT, () => {
  applicationState.markReady();

  logger.info(
    {
      port: SCHEMA_PORT
    },
    'Schema service started and is ready'
  );
});

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  applicationState.markNotReady();

  logger.info(
    {
      signal
    },
    'Schema service graceful shutdown started'
  );

  const shutdownTimer = setTimeout(() => {
    logger.error(
      {
        timeoutMs: env.SHUTDOWN_TIMEOUT_MS
      },
      'Graceful shutdown timed out. Forcing termination'
    );

    server.closeAllConnections?.();
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);

  shutdownTimer.unref();

  server.close((error) => {
    clearTimeout(shutdownTimer);

    if (error) {
      logger.error(
        {
          err: error
        },
        'Schema service failed to close cleanly'
      );

      process.exit(1);
    }

    logger.info('Schema service shutdown completed');

    process.exit(0);
  });
}

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  logger.fatal(
    {
      err: error
    },
    'Uncaught exception'
  );

  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal(
    {
      err: reason
    },
    'Unhandled promise rejection'
  );

  gracefulShutdown('unhandledRejection');
});

module.exports = server;
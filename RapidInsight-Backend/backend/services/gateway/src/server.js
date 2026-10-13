const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const applicationState = require('./config/applicationState');

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      environment: env.NODE_ENV
    },
    'Gateway started successfully'
  );
});

let shutdownStarted = false;

function gracefulShutdown(signal) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  applicationState.markNotReady();

  logger.info(
    { signal },
    'Gateway graceful shutdown started'
  );

  server.close((error) => {
    if (error) {
      logger.error(
        { err: error },
        'Gateway failed to shut down cleanly'
      );

      process.exitCode = 1;
      return;
    }

    logger.info('Gateway shut down successfully');
    process.exitCode = 0;
  });

  const forceShutdownTimer = setTimeout(() => {
    logger.error(
      {
        timeoutMs: env.SHUTDOWN_TIMEOUT_MS
      },
      'Gateway shutdown timed out'
    );

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }

    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);

  forceShutdownTimer.unref();
}

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  logger.fatal(
    { err: error },
    'Uncaught exception'
  );

  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal(
    { reason },
    'Unhandled promise rejection'
  );

  gracefulShutdown('unhandledRejection');
});

module.exports = server;
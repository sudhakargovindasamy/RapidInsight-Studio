const env = require('../config/env');

function errorHandler(error, req, res, next) {
  const statusCode = error.statusCode || 500;
  const code = error.code || 'INTERNAL_SERVER_ERROR';

  const isOperationalClientError =
    error.isOperational && statusCode >= 400 && statusCode < 500;
  if (isOperationalClientError) {
    req.log.warn(
      {
        requestId: req.id,
        statusCode,
        code,
        message: error.message
      },
      'Schema service request rejected'
    );
  } else {
 
    req.log.error(
      {
        err: error,
        requestId: req.id,
        statusCode,
        code
      },
      'Schema service request failed'
    );
  }

  const isUnexpectedServerError =
    statusCode >= 500 && !error.isOperational;

  const message =
    env.NODE_ENV === 'production' && isUnexpectedServerError
      ? 'Internal schema service error.'
      : error.message || 'Internal schema service error.';

  const response = {
    success: false,
    message,
    code,
    requestId: req.id
  };

  if (
    error.details &&
    (env.NODE_ENV !== 'production' || statusCode < 500)
  ) {
    response.details = error.details;
  }

  return res.status(statusCode).json(response);
}

module.exports = errorHandler;
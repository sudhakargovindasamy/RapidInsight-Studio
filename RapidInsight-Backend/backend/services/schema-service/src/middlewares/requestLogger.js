const crypto = require('crypto');
const pinoHttp = require('pino-http');

const logger = require('../config/logger');

const requestLogger = pinoHttp({
  logger,

  genReqId(req, res) {
    const incomingRequestId = req.headers['x-request-id'];

    const requestId =
      typeof incomingRequestId === 'string' &&
      incomingRequestId.trim()
        ? incomingRequestId.trim()
        : crypto.randomUUID();

    res.setHeader('x-request-id', requestId);

    return requestId;
  },

  customProps(req) {
    return {
      requestId: req.id
    };
  },

  customLogLevel(req, res, error) {
    if (error || res.statusCode >= 500) {
      return 'error';
    }

    if (res.statusCode >= 400) {
      return 'warn';
    }

    return 'info';
  },

  serializers: {
    req(req) {
      return {
        requestId: req.id,
        method: req.method,
        url: req.url
      };
    },

    res(res) {
      return {
        statusCode: res.statusCode
      };
    }
  }
});

module.exports = requestLogger;
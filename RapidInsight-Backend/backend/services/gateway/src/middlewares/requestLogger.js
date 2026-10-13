const crypto = require('crypto');
const pinoHttp = require('pino-http');

const logger = require('../config/logger');

const requestLogger = pinoHttp({
    logger,

    genReqId(req, res) {
        const requestId =
            req.headers['x-request-id'] || crypto.randomUUID();

        res.setHeader('x-request-id', requestId);
        return requestId;
    },

    serializers: {
        req(req) {
            return {
                id: req.id,
                method: req.method,
                url: req.url
            };
        },

        res(res) {
            return {
                statusCode: res.statusCode
            };
        }
    },

    customProps(req) {
        return {
            requestId: req.id,
            service: 'gateway'
        };
    }
});

module.exports = requestLogger;
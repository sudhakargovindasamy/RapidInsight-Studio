const { createProxyMiddleware } = require('http-proxy-middleware');
const env = require('../config/env');

function proxyWithUserContext(target) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,

    pathRewrite: (path, req) => req.originalUrl,

    on: {
      proxyReq(proxyReq, req) {
        if (req.user?.id) {
          proxyReq.setHeader('x-user-id', req.user.id);
        }

        if (req.user?.email) {
          proxyReq.setHeader('x-user-email', req.user.email);
        }

        if (req.id) {
          proxyReq.setHeader('x-request-id', req.id);
        }

        proxyReq.setHeader(
          'x-internal-service-key',
          env.INTERNAL_SERVICE_KEY
        );

        if (req.headers.authorization) {
          proxyReq.setHeader(
            'authorization',
            req.headers.authorization
          );
        }
      },

      error(error, req, res) {
        req.log.error(
          {
            err: error,
            requestId: req.id,
            target
          },
          'Gateway proxy request failed'
        );

        if (!res.headersSent) {
          res.status(502).json({
            success: false,
            message: 'Bad gateway. Target service unavailable.',
            requestId: req.id
          });
        }
      }
    }
  });
}

module.exports = proxyWithUserContext;
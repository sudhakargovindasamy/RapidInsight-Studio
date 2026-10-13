const env = require('../config/env');

function errorHandler(error, req, res, next) {
    const statusCode = error.statusCode || 500;

    req.log.error(
        {
            err: error,
            requestId: req.id,
            statusCode
        },
        'Gateway request failed'
    );

    const isProduction = env.NODE_ENV === 'production';

    const message =
        isProduction && statusCode === 500
            ? 'Internal gateway error.'
            : error.message || 'Internal gateway error.';

    res.status(statusCode).json({
        success: false,
        message,
        code: error.code || 'INTERNAL_ERROR',
        requestId: req.id
    });
}

module.exports = errorHandler;
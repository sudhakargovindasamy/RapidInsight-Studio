const { rateLimit } = require('express-rate-limit');

function buildRateLimitResponse(req, message) {
    return {
        success: false,
        message,
        code: 'RATE_LIMIT_EXCEEDED',
        requestId: req.id
    };
}

// General protection for Gateway APIs
const apiRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 500,

    standardHeaders: 'draft-8',
    legacyHeaders: false,

    skip: (req) => {
        return req.path === '/health' || req.path === '/ready';
    },

    handler: (req, res) => {
        req.log.warn(
            {
                requestId: req.id,
                ip: req.ip
            },
            'Gateway API rate limit exceeded'
        );

        res.status(429).json(
            buildRateLimitResponse(
                req,
                'Too many requests. Please try again later.'
            )
        );
    }
});

// Stronger protection for login and signup
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,

    standardHeaders: 'draft-8',
    legacyHeaders: false,

    handler: (req, res) => {
        req.log.warn(
            {
                requestId: req.id,
                ip: req.ip
            },
            'Authentication rate limit exceeded'
        );

        res.status(429).json(
            buildRateLimitResponse(
                req,
                'Too many authentication attempts. Please try again later.'
            )
        );
    }
});

module.exports = {
    apiRateLimiter,
    authRateLimiter
};
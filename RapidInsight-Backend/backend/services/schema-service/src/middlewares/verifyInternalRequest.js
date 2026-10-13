const crypto = require('crypto');

const env = require('../config/env');
const AppError = require('../errors/AppError');

function safelyCompareKeys(receivedKey, expectedKey) {
  if (
    typeof receivedKey !== 'string' ||
    typeof expectedKey !== 'string'
  ) {
    return false;
  }

  const receivedBuffer = Buffer.from(receivedKey);
  const expectedBuffer = Buffer.from(expectedKey);

  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    receivedBuffer,
    expectedBuffer
  );
}

function verifyInternalRequest(req, res, next) {
  const internalKey = req.headers['x-internal-service-key'];
  const userId = req.headers['x-user-id'];
  const userEmail = req.headers['x-user-email'];

  if (!internalKey) {
    return next(
      new AppError(
        'Internal service key is required.',
        403,
        'INTERNAL_SERVICE_KEY_REQUIRED'
      )
    );
  }

  if (!safelyCompareKeys(internalKey, env.INTERNAL_SERVICE_KEY)) {
    return next(
      new AppError(
        'Forbidden internal request.',
        403,
        'INVALID_INTERNAL_SERVICE_KEY'
      )
    );
  }

  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return next(
      new AppError(
        'Missing user context.',
        401,
        'USER_CONTEXT_REQUIRED'
      )
    );
  }

  req.user = {
    id: userId.trim(),
    email:
      typeof userEmail === 'string' && userEmail.trim()
        ? userEmail.trim()
        : null
  };

  return next();
}

module.exports = verifyInternalRequest;

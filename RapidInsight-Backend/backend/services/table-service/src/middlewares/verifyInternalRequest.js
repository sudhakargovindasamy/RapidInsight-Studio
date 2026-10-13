const crypto = require('crypto');

function safeCompare(leftValue, rightValue) {
  const leftBuffer = Buffer.from(
    String(leftValue || ''),
    'utf8'
  );

  const rightBuffer = Buffer.from(
    String(rightValue || ''),
    'utf8'
  );

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(
    leftBuffer,
    rightBuffer
  );
}

function extractAccessToken(authorizationHeader) {
  if (
    !authorizationHeader ||
    typeof authorizationHeader !== 'string'
  ) {
    return null;
  }

  if (!authorizationHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader
    .slice('Bearer '.length)
    .trim();

  return token || null;
}

function verifyInternalRequest(req, res, next) {
  try {
    const configuredInternalKey =
      process.env.INTERNAL_SERVICE_KEY;

    const receivedInternalKey =
      req.headers['x-internal-service-key'];

    const userId =
      req.headers['x-user-id'];

    const userEmail =
      req.headers['x-user-email'] || null;

    if (!configuredInternalKey) {
      return res.status(500).json({
        success: false,
        code: 'INTERNAL_SERVICE_KEY_NOT_CONFIGURED',
        message:
          'INTERNAL_SERVICE_KEY is not configured.'
      });
    }

    if (!receivedInternalKey) {
      return res.status(401).json({
        success: false,
        code: 'INTERNAL_SERVICE_KEY_REQUIRED',
        message:
          'Missing internal service authentication.'
      });
    }

    if (
      !safeCompare(
        receivedInternalKey,
        configuredInternalKey
      )
    ) {
      return res.status(403).json({
        success: false,
        code: 'INVALID_INTERNAL_SERVICE_KEY',
        message: 'Forbidden internal request.'
      });
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        code: 'USER_CONTEXT_MISSING',
        message: 'Missing user context.'
      });
    }

    req.user = {
      id: String(userId),
      email: userEmail
        ? String(userEmail)
        : null
    };

    req.accessToken = extractAccessToken(
      req.headers.authorization
    );

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = verifyInternalRequest;

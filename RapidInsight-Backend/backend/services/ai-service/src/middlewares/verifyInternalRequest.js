function verifyInternalRequest(req, res, next) {
  const internalKey = req.headers['x-internal-service-key'];
  const userId = req.headers['x-user-id'];

  if (!process.env.INTERNAL_SERVICE_KEY) {
    return res.status(500).json({
      success: false,
      message: 'INTERNAL_SERVICE_KEY is not configured.'
    });
  }

  if (internalKey !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden internal request.'
    });
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Missing user context.'
    });
  }

  req.user = {
    id: userId,
    email: req.headers['x-user-email'] || null
  };

  next();
}

module.exports = verifyInternalRequest;

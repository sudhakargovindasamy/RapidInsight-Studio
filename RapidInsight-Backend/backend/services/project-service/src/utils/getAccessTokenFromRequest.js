function getAccessTokenFromRequest(req) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    const error = new Error('Missing Authorization Bearer token.');
    error.statusCode = 401;
    throw error;
  }

  return authorization.replace('Bearer ', '').trim();
}

module.exports = getAccessTokenFromRequest;
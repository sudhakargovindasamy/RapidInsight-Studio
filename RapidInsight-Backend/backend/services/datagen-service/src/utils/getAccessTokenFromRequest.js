function getAccessTokenFromRequest(req) {
  const authorization = req.headers.authorization || '';

  if (!authorization.startsWith('Bearer ')) {
    throw new Error('Missing Authorization Bearer token.');
  }

  return authorization.replace('Bearer ', '').trim();
}

module.exports = getAccessTokenFromRequest;

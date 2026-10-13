
const AppError = require('../errors/AppError');

function notFoundHandler(req, res, next) {
  const error = new AppError(
    `Route ${req.method} ${req.originalUrl} was not found.`,
    404,
    'ROUTE_NOT_FOUND'
  );

  next(error);
}



module.exports = notFoundHandler;
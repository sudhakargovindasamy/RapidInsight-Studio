const AppError = require('../errors/AppError');

function validateRequest(schema, source = 'body') {
  return function validationMiddleware(req, res, next) {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message
      }));

      return next(
        new AppError(
          'Request validation failed.',
          400,
          'VALIDATION_ERROR',
          details
        )
      );
    }

  
    req[source] = result.data;

    return next();
  };
}

module.exports = validateRequest;
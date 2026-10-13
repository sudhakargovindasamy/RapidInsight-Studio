const { supabase } = require('../config/supabase');

async function authenticateUser(req, res, next) {
  try {
    const authorization = req.headers.authorization || '';

    if (!authorization.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Missing Authorization Bearer token.'
      });
    }

    const token = authorization.replace('Bearer ', '').trim();

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.'
      });
    }

    req.user = {
      id: data.user.id,
      email: data.user.email
    };

    next();
  } catch (error) {
    next(error);
  }
}

module.exports = authenticateUser;
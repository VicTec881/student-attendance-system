const { AppError } = require('./errorMiddleware');

// Usage: requireRole('admin')  or  requireRole('admin', 'teacher')
const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return next(new AppError('You are not logged in. Please log in to continue.', 401));
  }

  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError('You are not authorized to perform this action.', 403));
  }

  next();
};

module.exports = { requireRole };
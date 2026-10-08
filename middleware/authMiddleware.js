const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AppError } = require('./errorMiddleware');

// Protects private routes: verifies the JWT and attaches the user to req.user
const protect = async (req, res, next) => {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.split(' ')[1] : null;

  if (!token) {
    throw new AppError('You are not logged in. Please log in to continue.', 401);
  }

  // Throws TokenExpiredError / JsonWebTokenError, handled by errorMiddleware
  const decoded = jwt.verify(token, process.env.JWT_SECRET);

  const user = await User.findById(decoded.id);
  if (!user) {
    throw new AppError('The account for this token no longer exists.', 401);
  }

  if (user.status !== 'active') {
    throw new AppError('Your account is inactive. Please contact the administrator.', 403);
  }

  // Tokens issued before a password change are no longer valid
  if (
    user.passwordChangedAt &&
    Math.floor(user.passwordChangedAt.getTime() / 1000) > decoded.iat
  ) {
    throw new AppError('Your password was changed recently. Please log in again.', 401);
  }

  req.user = user;
  next();
};

module.exports = { protect };
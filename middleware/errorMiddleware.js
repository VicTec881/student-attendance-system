// Custom error for expected problems (wrong password, not found, etc.)
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

// Handles requests to routes that do not exist
const notFound = (req, res, next) => {
  next(new AppError('The requested resource was not found.', 404));
};

// Turns any error into a safe, friendly JSON response
const resolveError = (err) => {
  // 1. Errors we threw ourselves
  if (err.isOperational) {
    return { status: err.statusCode, message: err.message };
  }

  // 2. Mongoose validation errors
  if (err.name === 'ValidationError' && err.errors) {
    const messages = Object.values(err.errors).map((e) =>
      e.name === 'CastError' ? `Invalid value for ${e.path}.` : e.message
    );
    return { status: 422, message: messages.join(' ') };
  }

  // 3. Invalid MongoDB ID or value type
  if (err.name === 'CastError') {
    return { status: 400, message: 'Invalid ID or value provided.' };
  }

  // 4. Duplicate records (unique index violations)
  if (err.code === 11000) {
    const keys = Object.keys(err.keyPattern || err.keyValue || {});
    if (keys.includes('date') && keys.includes('session')) {
      return {
        status: 409,
        message:
          'Attendance has already been recorded for this student on this date, class and session.',
      };
    }
    const messages = {
      email: 'An account with this email already exists.',
      studentId: 'A student with this Student ID already exists.',
      registrationNumber: 'A student with this registration number already exists.',
    };
    return {
      status: 409,
      message: messages[keys[0]] || `A record with this ${keys[0] || 'value'} already exists.`,
    };
  }

  // 5. JWT errors
  if (err.name === 'TokenExpiredError') {
    return { status: 401, message: 'Your session has expired. Please log in again.' };
  }
  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return { status: 401, message: 'Invalid token. Please log in again.' };
  }

  // 6. Malformed JSON in the request body
  if (err.type === 'entity.parse.failed') {
    return { status: 400, message: 'Invalid JSON in the request body.' };
  }

  // 7. Database connection problems
  if (
    ['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError'].includes(
      err.name
    )
  ) {
    return {
      status: 503,
      message: 'Unable to connect to the database. Please try again later.',
    };
  }

  // 8. Anything unexpected
  return { status: 500, message: 'Something went wrong. Please try again later.' };
};

const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const { status, message } = resolveError(err);

  // Log technical details on the server only (never passwords or request bodies)
  if (status >= 500) {
    console.error(`[${status}] ${err.name}: ${err.message}`);
    if (process.env.NODE_ENV === 'development') console.error(err.stack);
  }

  res.status(status).json({ success: false, message });
};

module.exports = { AppError, notFound, errorHandler };
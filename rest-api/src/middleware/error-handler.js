const { ERROR_CODES } = require('../config/constants');
const { buildError } = require('../utils/response-builder');

/**
 * Global Error Handler Middleware
 * Catches all errors and returns standardized error responses
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging
  console.error('[ERROR]', err.message);
  if (err.stack && process.env.NODE_ENV === 'development') {
    console.error(err.stack);
  }

  // Determine error code and status
  const errorCode = err.code || 'INTERNAL_ERROR';
  const errorInfo = ERROR_CODES[errorCode] || ERROR_CODES.INTERNAL_ERROR;

  // Build error response
  const response = buildError(
    errorInfo.code,
    err.message || 'An unexpected error occurred',
    err.details || {},
    req.query.debug === 'true' && process.env.NODE_ENV !== 'production' ? err.stack : null
  );

  // Send response
  res.status(errorInfo.status).json(response);
}

/**
 * Create custom error with code
 * @param {string} code - Error code from ERROR_CODES
 * @param {string} message - Error message
 * @param {Object} details - Optional error details
 * @returns {Error} Custom error object
 */
function createError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

module.exports = {
  errorHandler,
  createError,
};

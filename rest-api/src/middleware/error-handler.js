const { ERROR_CODES } = require('../config/constants');
const { buildError } = require('../utils/response-builder');
const environment = require('../config/environment');
const appLogger = require('../utils/app-logger');

/**
 * Global Error Handler Middleware
 * Catches all errors and returns standardized error responses
 */
function errorHandler(err, req, res, next) {
  // Log error for debugging
  appLogger.error('Request failed', {
    error: err.message,
    code: err.code || 'INTERNAL_ERROR',
    method: req.method,
    path: req.path,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Determine error code and status
  const errorCode = err.code || 'INTERNAL_ERROR';
  const errorInfo = ERROR_CODES[errorCode] || ERROR_CODES.INTERNAL_ERROR;

  // Build error response
  const response = buildError(
    errorInfo.code,
    err.message || 'An unexpected error occurred',
    err.details || {},
    req.query.debug === 'true' && environment.api.allowDebugOutput ? err.stack : null
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

/**
 * Query Parameter Key Normalizer Middleware
 * Converts all query parameter keys to lowercase for case-insensitive parameter handling
 * Must run BEFORE validation middleware
 */
const appLogger = require('../utils/app-logger');

/**
 * Normalize query parameter keys to lowercase
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function normalizeQueryKeys(req, res, next) {
  const debugEnabled = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.DEBUG_QUERY_NORMALIZER || '').trim().toLowerCase()
  );
  const debug = (message, meta) => {
    if (debugEnabled) {
      appLogger.debug(message, meta);
    }
  };

  debug('Query normalizer before keys', { keys: Object.keys(req.query || {}) });
  if (req.query && Object.keys(req.query).length > 0) {
    // Create new object with lowercase keys
    const normalized = Object.create(null);
    for (const [key, value] of Object.entries(req.query)) {
      const lowerKey = key.toLowerCase();
      debug('Query normalizer converting key', { from: key, to: lowerKey });
      normalized[lowerKey] = value;
    }
    debug('Query normalizer normalized keys', { keys: Object.keys(normalized) });
    // Replace req.query with normalized object
    req.query = normalized;
  }
  debug('Query normalizer after keys', { keys: Object.keys(req.query || {}) });
  next();
}

module.exports = normalizeQueryKeys;

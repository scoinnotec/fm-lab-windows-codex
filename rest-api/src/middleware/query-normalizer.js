/**
 * Query Parameter Key Normalizer Middleware
 * Converts all query parameter keys to lowercase for case-insensitive parameter handling
 * Must run BEFORE validation middleware
 */

/**
 * Normalize query parameter keys to lowercase
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function normalizeQueryKeys(req, res, next) {
  console.log('[Query Normalizer] Before - Keys:', Object.keys(req.query));
  if (req.query && Object.keys(req.query).length > 0) {
    // Create new object with lowercase keys
    const normalized = Object.create(null);
    for (const [key, value] of Object.entries(req.query)) {
      const lowerKey = key.toLowerCase();
      console.log(`  Converting: "${key}" => "${lowerKey}"`);
      normalized[lowerKey] = value;
    }
    console.log('  Normalized object keys:', Object.keys(normalized));
    // Replace req.query with normalized object
    req.query = normalized;
    console.log('  req.query keys after assignment:', Object.keys(req.query));
  }
  console.log('[Query Normalizer] After - Keys:', Object.keys(req.query));
  next();
}

module.exports = normalizeQueryKeys;

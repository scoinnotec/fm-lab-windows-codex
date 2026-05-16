/**
 * Small application logger for REST API runtime messages.
 *
 * It intentionally stays dependency-free so config loading, database setup,
 * middleware, and tests can use the same logger without circular imports.
 */

const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function configuredLevel() {
  const raw = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? raw : 'info';
}

function configuredFormat() {
  return String(process.env.LOG_FORMAT || 'text').toLowerCase() === 'json' ? 'json' : 'text';
}

function isEnabled(level) {
  return LEVELS[level] <= LEVELS[configuredLevel()];
}

function normalizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined;
  return Object.fromEntries(
    Object.entries(meta)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => {
        if (value instanceof Error) {
          return [key, { message: value.message, stack: value.stack }];
        }
        return [key, value];
      })
  );
}

function stringify(value) {
  return JSON.stringify(value, (_key, entry) => (
    typeof entry === 'bigint' ? Number(entry) : entry
  ));
}

function write(level, message, meta) {
  if (!isEnabled(level)) return;

  const safeMeta = normalizeMeta(meta);
  if (configuredFormat() === 'json') {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
        message,
        ...safeMeta,
      };
      console[level === 'debug' ? 'log' : level](stringify(payload));
      return;
    }

    const suffix = safeMeta ? ` ${stringify(safeMeta)}` : '';
    console[level === 'debug' ? 'log' : level](`[${level.toUpperCase()}] ${message}${suffix}`);
  }

module.exports = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  isEnabled,
};

const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const environment = require('../config/environment');

/**
 * HTTP Request Logger using Morgan
 */

// Create logs directory if it doesn't exist
const logsDir = path.resolve(__dirname, '../../', path.dirname(environment.logging.file));
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create write stream for log file
const logFilePath = path.resolve(__dirname, '../../', environment.logging.file);
const accessLogStream = fs.createWriteStream(logFilePath, { flags: 'a' });

// Define custom Morgan format
morgan.token('body', (req) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    return JSON.stringify(req.body);
  }
  return '-';
});

morgan.token('query', (req) => {
  return Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : '-';
});

// Custom format string
const logFormat = ':remote-addr - :method :url :status :res[content-length] - :response-time ms - query: :query';

// Create Morgan middleware
const logger = morgan(logFormat, {
  stream: accessLogStream,
  skip: (req) => {
    // Skip logging for health checks in production
    return environment.nodeEnv === 'production' && req.url === '/api/version';
  },
});

// Console logger for development
const consoleLogger = morgan('dev', {
  skip: (req) => environment.nodeEnv === 'test',
});

/**
 * Combined logger middleware
 */
function loggerMiddleware(req, res, next) {
  // Log to file
  logger(req, res, () => {});

  // Log to console in development
  if (environment.nodeEnv === 'development') {
    consoleLogger(req, res, () => {});
  }

  next();
}

module.exports = loggerMiddleware;

const cors = require('cors');
const environment = require('../config/environment');

/**
 * CORS Middleware Configuration
 */

const corsOptions = {
  origin: environment.cors.origin === '*' ? '*' : environment.cors.origin.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // 24 hours
};

const corsMiddleware = cors(corsOptions);

module.exports = corsMiddleware;

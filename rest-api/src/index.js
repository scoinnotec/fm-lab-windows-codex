const express = require('express');
const environment = require('./config/environment');
const db = require('./config/database');
const routes = require('./routes');
const { errorHandler } = require('./middleware/error-handler');
const logger = require('./middleware/logger');
const corsMiddleware = require('./middleware/cors');
const normalizeQueryKeys = require('./middleware/query-normalizer');
const appLogger = require('./utils/app-logger');

/**
 * FileMaker DuckDB Analysis API
 * Express application setup
 */

const app = express();

// Custom query parser that normalizes keys to lowercase
app.set('query parser', (queryString) => {
  const parsed = require('querystring').parse(queryString);
  const normalized = {};
  for (const [key, value] of Object.entries(parsed)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
});

// Middleware
app.use(corsMiddleware);
app.use(logger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(normalizeQueryKeys);

// API Routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'FileMaker DuckDB Analysis API',
    version: require('../package.json').version,
    endpoints: {
      version: '/api/version',
      info: '/api/info',
      get: '/api/get?uuid=<uuid>',
      getDetails: '/api/get-details?uuid=<uuid>',
      list: '/api/list?type=<type>',
      count: '/api/count',
      search: '/api/search?name=<pattern>',
      searchCount: '/api/search/count?name=<pattern>',
      scriptSearch: '/api/search/scripts?q=<text>',
      scriptSearchCount: '/api/search/scripts/count?q=<text>',
      tableOccurrenceUsage: '/api/analysis/table-occurrences/usage',
      objectUsage: '/api/analysis/objects/usage',
      apiIntegrations: '/api/analysis/api-integrations',
      apiIntegrationSummary: '/api/analysis/api-integrations/summary',
      serverLogTopCalls: '/api/analysis/server-logs/top-calls',
      serverLogTopCallSummary: '/api/analysis/server-logs/top-calls/summary',
      references: '/api/references?uuid=<uuid>',
      query: '/api/query?template=<name>',
      report: '/api/report?template=<name>',
      pluginDocs: '/api/plugin-docs/:source/:function',
      referenceCategories: '/api/reference/categories?lang=<lang>',
      referenceSteps: '/api/reference/steps?lang=<lang>',
      referenceStepDetail: '/api/reference/steps/:idOrSlug?lang=<lang>&content=<meta|summary|full>',
      referenceFunctions: '/api/reference/functions?lang=<lang>',
      referenceFunctionDetail: '/api/reference/functions/:nameOrId?lang=<lang>&content=<meta|summary|full>',
      referenceLookup: '/api/reference/lookup?token=<token>&lang=<lang>',
      referenceHelp: '/api/reference/help/:lang/:slug',
      referenceHelpStatus: '/api/reference/help/status',
      localizationLabels: '/api/localization/labels?language=<de|en>',
      aiProviders: '/api/ai/providers',
      aiConversations: '/api/ai/conversations',
      aiConversation: '/api/ai/conversations/:id',
      aiMessage: 'POST /api/ai/conversations/:id/messages',
      aiMarkdown: '/api/ai/conversations/:id/markdown',
      adminReload: 'POST /api/admin/reload',
    },
    documentation: 'See README.md for full API documentation',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

/**
 * Start server
 */
async function start() {
  try {
    // Initialize database connection
    appLogger.info('Initializing database connection');
    await db.initialize();

    // Start HTTP server
    const server = app.listen(environment.port, environment.host, () => {
      appLogger.info('FileMaker DuckDB Analysis API started', {
        environment: environment.nodeEnv,
        server: `http://${environment.host}:${environment.port}`,
        api: `http://${environment.host}:${environment.port}/api`,
      });
      appLogger.debug('Available API endpoints', {
        endpoints: [
          'GET /api/version',
          'GET /api/info',
          'GET /api/get',
          'GET /api/get-details',
          'GET /api/list',
          'GET /api/count',
          'GET /api/search',
          'GET /api/search/count',
          'GET /api/search/scripts',
          'GET /api/analysis/table-occurrences/usage',
          'GET /api/analysis/objects/usage',
          'GET /api/analysis/api-integrations',
          'GET /api/analysis/server-logs/top-calls',
          'GET /api/references',
          'GET /api/query',
          'GET /api/report',
          'GET /api/plugin-docs',
          'GET /api/reference/*',
          'GET /api/localization/labels',
          'GET /api/ai/providers',
          'POST /api/ai/conversations/:id/messages',
        ],
      });
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      appLogger.info('SIGTERM signal received: closing HTTP server');
      server.close(async () => {
        appLogger.info('HTTP server closed');
        await db.close();
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      appLogger.info('SIGINT signal received: closing HTTP server');
      server.close(async () => {
        appLogger.info('HTTP server closed');
        await db.close();
        process.exit(0);
      });
    });
  } catch (error) {
    appLogger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Start if not in test mode
if (require.main === module) {
  start();
}

module.exports = app;

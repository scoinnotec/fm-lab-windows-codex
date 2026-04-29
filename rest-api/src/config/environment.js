const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

/**
 * Environment configuration with defaults and validation
 */
const environment = {
  // Server Configuration
  port: parseInt(process.env.PORT) || 3003,
  host: process.env.HOST || 'localhost',
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database Configuration (paths relative to rest-api/)
  // Default: lokale READ_ONLY-Kopie der Master-DB, die von convert-xml
  // synchronisiert wird. Siehe project/plan-db-architektur.md.
  duckdb: {
    path: process.env.DUCKDB_PATH || './db/fm_catalog.duckdb',
    maxMemory: process.env.DUCKDB_MAX_MEMORY || '2GB',
    threads: parseInt(process.env.DUCKDB_THREADS) || 4,
  },

  // Admin-Endpoint (Reload-Token). Leer = offener Zugriff (Dev-Default).
  admin: {
    reloadToken: process.env.ADMIN_RELOAD_TOKEN || '',
  },

  // Template Configuration
  templates: {
    dir: process.env.TEMPLATE_DIR || path.resolve(__dirname, '../../templates/sql'),
    customDir: process.env.TEMPLATE_CUSTOM_DIR || path.resolve(__dirname, '../../templates/sql-custom'),
    cacheEnabled: process.env.TEMPLATE_CACHE_ENABLED !== 'false',
    cacheTTL: parseInt(process.env.TEMPLATE_CACHE_TTL) || 3600000, // 1 hour
  },

  // XML Import Configuration
  xml: {
    dir: process.env.XML_DIR || '../xml',
    convertScript: process.env.CONVERT_XML_SCRIPT || '../sql/convert_xml.sql',
    catalogsScript: process.env.CREATE_CATALOGS_SCRIPT || '../sql/create_universal_catalogs.sql',
  },

  // Obsidian Documentation
  obsidian: {
    vaultPath: process.env.OBSIDIAN_VAULT_PATH || null,
  },

  // API Configuration
  api: {
    defaultLimit: parseInt(process.env.DEFAULT_LIMIT) || 100,
    maxLimit: parseInt(process.env.MAX_LIMIT) || 10000,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000,
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/api.log',
  },

  // CORS Configuration
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origin: process.env.CORS_ORIGIN || '*',
  },
};

/**
 * Validate required environment variables
 */
function validate() {
  const errors = [];

  // Check if DuckDB path exists (when not in development mode for initial setup)
  if (environment.nodeEnv !== 'development') {
    const fs = require('fs');
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);
    if (!fs.existsSync(dbPath)) {
      errors.push(`DuckDB database not found at: ${dbPath}`);
    }
  }

  if (errors.length > 0) {
    console.error('Environment validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

// Validate on module load
if (process.env.NODE_ENV !== 'test') {
  validate();
}

module.exports = environment;

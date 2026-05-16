const dotenv = require('dotenv');
const path = require('path');
const appLogger = require('../utils/app-logger');

// Load environment variables from .env file
dotenv.config();

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

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

  // AI chat/agent configuration.
  // Conversations are stored as JSON files so the DuckDB catalog can stay READ_ONLY.
  ai: {
    chatsDir: process.env.AI_CHAT_DIR || './data/ai-chats',
    chatRetentionDays: parseInt(process.env.AI_CHAT_RETENTION_DAYS) || 30,
    chatMaxConversations: parseInt(process.env.AI_CHAT_MAX_CONVERSATIONS) || 200,
    chatMaxMessages: parseInt(process.env.AI_CHAT_MAX_MESSAGES) || 60,
    chatMaxFileBytes: parseInt(process.env.AI_CHAT_MAX_FILE_BYTES) || 1048576,
    defaultProvider: process.env.AI_PROVIDER || 'openai',
    maxContextRows: parseInt(process.env.AI_MAX_CONTEXT_ROWS) || 40,
    openai: {
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    },
    anthropic: {
      baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.1',
    },
  },

  // Plugin-Funktions-Dokumentation (MBS, künftig weitere Quellen)
  // Pfade relativ zur rest-api/ — Default zeigt auf docs/mbs/ im Projekt-Root.
  pluginDocs: {
    mbsPath: process.env.PLUGIN_DOCS_MBS_PATH || '../docs/mbs',
    cacheTTL: parseInt(process.env.PLUGIN_DOCS_CACHE_TTL_MS) || 3600000, // 1h
    cacheMaxDocs: parseInt(process.env.PLUGIN_DOCS_CACHE_MAX_DOCS) || 500,
    cacheMaxPaths: parseInt(process.env.PLUGIN_DOCS_CACHE_MAX_PATHS) || 1000,
  },

  // Reference-DB (Script Steps + Functions, lokalisierte Claris-Metadaten)
  // Pfade relativ zur rest-api/. ATTACH-Alias 'ref' wird in database.js gesetzt.
  // htmlCacheRoot zeigt auf den vom Skill `install-claris-docs` gepflegten Mirror.
  reference: {
    duckdbPath:    process.env.REFERENCE_DUCKDB_PATH    || './db/fm_reference.duckdb',
    htmlCacheRoot: process.env.REFERENCE_HTML_ROOT     || '../docs/claris-help',
    htmlSubdir:    'content',                                  // <lang>/content/<slug>.html
    cacheTtlMs:    parseInt(process.env.REFERENCE_CACHE_TTL_MS) || 3600000,       // DB-Meta 1h
    htmlCacheTtlMs: parseInt(process.env.REFERENCE_HTML_CACHE_TTL_MS) || 86400000, // HTML 24h
    defaultLang:   process.env.REFERENCE_DEFAULT_LANG || 'de',
  },

  // API Configuration
  api: {
    defaultLimit: parseInt(process.env.DEFAULT_LIMIT) || 100,
    maxLimit: parseInt(process.env.MAX_LIMIT) || 10000,
    requestTimeout: parseInt(process.env.REQUEST_TIMEOUT_MS) || 30000,
    allowDebugOutput: environmentSafeDebugAllowed(),
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'text',
    file: process.env.LOG_FILE || './logs/api.log',
  },

  // CORS Configuration
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origin: process.env.CORS_ORIGIN || '*',
  },
};

function environmentSafeDebugAllowed() {
  return process.env.NODE_ENV !== 'production' && parseBooleanEnv(process.env.ALLOW_DEBUG_OUTPUT, false);
}

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
    appLogger.error('Environment validation failed', { errors });
    process.exit(1);
  }
}

// Validate on module load
if (process.env.NODE_ENV !== 'test') {
  validate();
}

module.exports = environment;

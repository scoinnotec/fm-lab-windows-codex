const { DuckDBInstance } = require('@duckdb/node-api');
const fs = require('fs');
const path = require('path');
const environment = require('./environment');
const appLogger = require('../utils/app-logger');

let instance   = null;
let connection = null;
let reloading  = false;
let referenceAttached = false;

async function initialize() {
  if (connection) {
    return connection;
  }

  const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);
  appLogger.info('Connecting to DuckDB', { path: dbPath });

  instance = await DuckDBInstance.create(dbPath, {
    access_mode: 'READ_ONLY',
    max_memory: environment.duckdb.maxMemory,
    threads: String(environment.duckdb.threads),
  });

  connection = await instance.connect();

  appLogger.info('DuckDB connection established', {
    accessMode: 'READ_ONLY',
    maxMemory: environment.duckdb.maxMemory,
    threads: environment.duckdb.threads,
  });

  await attachReferenceDb();

  return connection;
}

async function attachReferenceDb() {
  referenceAttached = false;
  const refPath = path.resolve(__dirname, '../../', environment.reference.duckdbPath);
  if (!fs.existsSync(refPath)) {
    appLogger.warn('Reference-DB not found; /api/reference endpoints will return 503', { path: refPath });
    return false;
  }
  // ATTACH erlaubt READ_ONLY-Modus selbst auf einer READ_ONLY-Hauptverbindung
  // (siehe PRD §9 Risiko 1, getestet mit DuckDB 1.5.x).
  const escaped = refPath.replace(/'/g, "''");
  const stmt = await connection.prepare(`ATTACH '${escaped}' AS ref (READ_ONLY)`);
  await stmt.run();
  referenceAttached = true;
  appLogger.info('Reference-DB attached', { alias: 'ref', path: refPath });
  return true;
}

function isReferenceAttached() {
  return referenceAttached;
}

async function reload() {
  if (reloading) {
    throw new Error('Reload already in progress');
  }
  reloading = true;
  try {
    await close();
    await initialize();

    const result = await executeQuery('SELECT COUNT(*) AS c FROM duckdb_tables()');
    const tableCount = result.rows[0]?.c;
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);

    return {
      status: 'reloaded',
      tables: typeof tableCount === 'bigint' ? Number(tableCount) : tableCount,
      path: dbPath,
    };
  } finally {
    reloading = false;
  }
}

function getConnection() {
  if (!connection) {
    throw new Error('Database not initialized. Call initialize() first.');
  }
  return connection;
}

async function executeQuery(sql, params = []) {
  if (!connection) {
    await initialize();
  }

  const startTime = Date.now();

  try {
    const stmt = await connection.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const result = await stmt.run();
    const rows = await result.getRowObjectsJS();

    return {
      rows,
      meta: {
        execution_time_ms: Date.now() - startTime,
        result_count: rows.length,
      },
    };
  } catch (err) {
    const meta = {
      error: err.message,
      executionTimeMs: Date.now() - startTime,
      paramCount: params.length,
    };
    if (environment.api.allowDebugOutput) {
      meta.sql = sql;
      meta.params = params;
    }
    appLogger.error('Query execution failed', meta);
    throw err;
  }
}

async function close() {
  if (!instance) {
    return;
  }

  try {
    if (connection) {
      connection.disconnectSync();
    }
    instance.closeSync();
    appLogger.info('Database connection closed');
  } catch (err) {
    appLogger.error('Error closing database', { error: err });
    throw err;
  } finally {
    instance   = null;
    connection = null;
    referenceAttached = false;
  }
}

async function getDatabaseStats() {
  const stats = {};

  try {
    const fs = require('fs');
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);

    if (fs.existsSync(dbPath)) {
      const fileStats = fs.statSync(dbPath);
      stats.size_mb = Math.round((fileStats.size / 1024 / 1024) * 100) / 100;
    } else {
      stats.size_mb = 0;
    }

    const tableResult = await executeQuery(`
      SELECT COUNT(*) as table_count
      FROM duckdb_tables()
    `);
    const tableCount = tableResult.rows[0]?.table_count || 0;
    stats.table_count = typeof tableCount === 'bigint' ? Number(tableCount) : tableCount;

    stats.database_path = path.resolve(__dirname, '../../', environment.duckdb.path);
    stats.connected = !!connection;
    stats.max_memory = environment.duckdb.maxMemory;
    stats.threads = environment.duckdb.threads;
  } catch (error) {
    appLogger.error('Error getting database stats', { error });
  }

  return stats;
}

module.exports = {
  initialize,
  getConnection,
  executeQuery,
  close,
  reload,
  getDatabaseStats,
  isReferenceAttached,
};

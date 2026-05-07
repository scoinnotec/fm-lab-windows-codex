const { DuckDBInstance } = require('@duckdb/node-api');
const path = require('path');
const environment = require('./environment');

let instance   = null;
let connection = null;
let reloading  = false;

async function initialize() {
  if (connection) {
    return connection;
  }

  const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);
  console.log(`Connecting to DuckDB at: ${dbPath}`);

  instance = await DuckDBInstance.create(dbPath, {
    access_mode: 'READ_ONLY',
    max_memory: environment.duckdb.maxMemory,
    threads: String(environment.duckdb.threads),
  });

  connection = await instance.connect();

  console.log('DuckDB connection established successfully (READ_ONLY)');
  console.log(`  - Max Memory: ${environment.duckdb.maxMemory}`);
  console.log(`  - Threads: ${environment.duckdb.threads}`);

  return connection;
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
    console.error('Query execution failed:', err.message);
    console.error('SQL:', sql);
    console.error('Params:', params);
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
    console.log('Database connection closed');
  } catch (err) {
    console.error('Error closing database:', err);
    throw err;
  } finally {
    instance   = null;
    connection = null;
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
    console.error('Error getting database stats:', error);
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
};

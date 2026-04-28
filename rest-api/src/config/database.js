const duckdb = require('duckdb');
const path = require('path');
const environment = require('./environment');

/**
 * DuckDB Database Connection Manager
 * Implements single-connection pattern with internal thread pooling
 */

let database = null;
let connection = null;
let reloading = false;

/**
 * Initialize DuckDB database connection
 * @returns {Promise<Connection>} DuckDB connection
 */
async function initialize() {
  if (connection) {
    return connection;
  }

  return new Promise((resolve, reject) => {
    try {
      // Resolve database path relative to rest-api/ directory
      const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);

      console.log(`Connecting to DuckDB at: ${dbPath}`);

      // Create database instance with configuration
      // READ_ONLY: die REST-API liest aus einer Kopie der Master-DB, die von
      // convert-xml beschrieben wird. Siehe project/plan-db-architektur.md.
      database = new duckdb.Database(dbPath, {
        access_mode: 'READ_ONLY',
        max_memory: environment.duckdb.maxMemory,
        threads: environment.duckdb.threads.toString(),
      });

      // Create connection
      connection = database.connect();

      console.log('DuckDB connection established successfully (READ_ONLY)');
      console.log(`  - Max Memory: ${environment.duckdb.maxMemory}`);
      console.log(`  - Threads: ${environment.duckdb.threads}`);

      resolve(connection);
    } catch (error) {
      console.error('Failed to connect to DuckDB:', error);
      reject(error);
    }
  });
}

/**
 * Reload DuckDB connection from disk.
 * Closes the current connection and reopens it — used after convert-xml has
 * written a new copy to rest-api/db/fm_catalog.duckdb.
 * @returns {Promise<{status: string, tables: number, path: string}>}
 */
async function reload() {
  if (reloading) {
    throw new Error('Reload already in progress');
  }
  reloading = true;
  try {
    await close();
    await initialize();

    // Quick sanity check: count tables in the freshly opened DB
    const result = await new Promise((resolve, reject) => {
      connection.all('SELECT COUNT(*) AS c FROM duckdb_tables()', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
    const tableCount = result[0]?.c;
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

/**
 * Get the current database connection
 * @returns {Connection} DuckDB connection
 */
function getConnection() {
  if (!connection) {
    throw new Error('Database not initialized. Call initialize() first.');
  }
  return connection;
}

/**
 * Execute a SQL query with parameters
 * @param {string} sql - SQL query string
 * @param {Array} params - Query parameters
 * @returns {Promise<{rows: Array, meta: Object}>} Query results with metadata
 */
async function executeQuery(sql, params = []) {
  if (!connection) {
    await initialize();
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    // DuckDB expects individual parameters, not an array
    const callback = (err, rows) => {
      const executionTime = Date.now() - startTime;

      if (err) {
        console.error('Query execution failed:', err.message);
        console.error('SQL:', sql);
        console.error('Params:', params);
        reject(err);
      } else {
        resolve({
          rows,
          meta: {
            execution_time_ms: executionTime,
            result_count: rows.length,
          },
        });
      }
    };

    // Call with spread parameters
    if (params.length === 0) {
      connection.all(sql, callback);
    } else {
      connection.all(sql, ...params, callback);
    }
  });
}

/**
 * Close the database connection
 * @returns {Promise<void>}
 */
async function close() {
  return new Promise((resolve, reject) => {
    if (!database) {
      resolve();
      return;
    }

    database.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
        reject(err);
      } else {
        console.log('Database connection closed');
        database = null;
        connection = null;
        resolve();
      }
    });
  });
}

/**
 * Get database statistics
 * @returns {Promise<Object>} Database statistics
 */
async function getDatabaseStats() {
  const stats = {};

  try {
    // Get actual database file size from filesystem
    const fs = require('fs');
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);

    if (fs.existsSync(dbPath)) {
      const fileStats = fs.statSync(dbPath);
      stats.size_mb = Math.round((fileStats.size / 1024 / 1024) * 100) / 100;
    } else {
      stats.size_mb = 0;
    }

    // Get table count
    const tableResult = await executeQuery(`
      SELECT COUNT(*) as table_count
      FROM duckdb_tables()
    `);
    const tableCount = tableResult.rows[0]?.table_count || 0;
    stats.table_count = typeof tableCount === 'bigint' ? Number(tableCount) : tableCount;

    // Get connection info
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

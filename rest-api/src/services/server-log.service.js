const db = require('../config/database');
const environment = require('../config/environment');
const { createError } = require('../middleware/error-handler');

function convertBigInts(obj) {
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (obj !== null && typeof obj === 'object') {
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = typeof value === 'bigint' ? Number(value) : convertBigInts(value);
    }
    return converted;
  }
  return obj;
}

function escapeLikeLiteral(value) {
  return value.replace(/[!%_]/g, (char) => `!${char}`);
}

function normalizeSearchPattern(q) {
  const raw = String(q || '').trim();
  if (!raw) return null;
  const escaped = raw.split('*').map(escapeLikeLiteral).join('%');
  return raw.includes('*') ? escaped : `%${escaped}%`;
}

let serverLogTablesChecked = false;

async function ensureServerLogTables() {
  if (serverLogTablesChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS object_count
    FROM (
      SELECT table_name AS name FROM duckdb_tables()
      UNION ALL
      SELECT view_name AS name FROM duckdb_views()
    )
    WHERE name IN ('ServerTopCallLogRaw', 'ServerTopCallObjectMatches', 'ServerTopCallOptimizationSummary')
  `);

  const objectCount = Number(result.rows[0]?.object_count || 0);
  if (objectCount < 3) {
    throw createError(
      'DATABASE_ERROR',
      'Server log analysis is missing. Run tools/import_server_logs.ps1 after copying/downloading FileMaker Server logs.',
      { expected_objects: 3, found_objects: objectCount }
    );
  }

  serverLogTablesChecked = true;
}

function buildSummaryParams({ q, file, objectType, matchedOnly }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    objectType || null,
    objectType || null,
    !!matchedOnly,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
  ];
}

function buildSummaryQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        Object_Type,
        Object_UUID,
        Object_Name,
        File_Name,
        Related_TO_Name,
        Related_Table_Name,
        Match_Confidence,
        Call_Count,
        Total_Elapsed_Microseconds,
        Max_Elapsed_Microseconds,
        Interval_Elapsed_Microseconds,
        Wait_Time_Microseconds,
        IO_Time_Microseconds,
        Network_Bytes_In,
        Network_Bytes_Out,
        Total_Elapsed_Milliseconds,
        Max_Elapsed_Milliseconds,
        Wait_Time_Milliseconds,
        IO_Time_Milliseconds,
        Operations,
        Last_Seen_Text,
        Optimization_Hint`;

  const orderLimit = countOnly ? '' : `
    ORDER BY Total_Elapsed_Microseconds DESC, Max_Elapsed_Microseconds DESC, lower(Object_Name)
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM ServerTopCallOptimizationSummary
    WHERE (? IS NULL OR File_Name = ?)
      AND (? IS NULL OR Object_Type = ?)
      AND (? = FALSE OR Object_UUID IS NOT NULL)
      AND (
        ? IS NULL
        OR Object_Name ILIKE ? ESCAPE '!'
        OR File_Name ILIKE ? ESCAPE '!'
        OR COALESCE(Related_TO_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Related_Table_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Operations, '') ILIKE ? ESCAPE '!'
      )
    ${orderLimit}
  `;
}

function buildCallParams({ q, file, objectType, matchedOnly, minElapsedMs }) {
  const pattern = normalizeSearchPattern(q);
  const minElapsedMicros = minElapsedMs ? Number(minElapsedMs) * 1000 : null;
  return [
    file || null,
    file || null,
    objectType || null,
    objectType || null,
    !!matchedOnly,
    minElapsedMicros,
    minElapsedMicros,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
  ];
}

function buildCallQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        Log_File,
        Row_Number,
        Timestamp_Text,
        Total_Elapsed_Microseconds,
        Operation,
        Target,
        Elapsed_Time_Microseconds,
        Wait_Time_Microseconds,
        IO_Time_Microseconds,
        Network_Bytes_In,
        Network_Bytes_Out,
        Client_Name,
        Target_File_Name,
        Target_Kind,
        Object_UUID,
        Object_Type,
        Object_Name,
        Object_File,
        Related_TO_Name,
        Related_Table_Name,
        Match_Source,
        Match_Confidence`;

  const orderLimit = countOnly ? '' : `
    ORDER BY Total_Elapsed_Microseconds DESC, Elapsed_Time_Microseconds DESC, Timestamp_Text DESC
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM ServerTopCallObjectMatches
    WHERE (? IS NULL OR COALESCE(Object_File, Target_File_Name) = ?)
      AND (? IS NULL OR Object_Type = ?)
      AND (? = FALSE OR Object_UUID IS NOT NULL)
      AND (? IS NULL OR Total_Elapsed_Microseconds >= ?)
      AND (
        ? IS NULL
        OR Target ILIKE ? ESCAPE '!'
        OR Operation ILIKE ? ESCAPE '!'
        OR COALESCE(Object_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Object_File, Target_File_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Related_TO_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Related_Table_Name, '') ILIKE ? ESCAPE '!'
      )
    ${orderLimit}
  `;
}

function buildFilteredCallRowsCte() {
  return `
    WITH filtered AS (
      SELECT
        *,
        try_strptime(Timestamp_Text, '%Y-%m-%d %H:%M:%S.%g %z') AS Parsed_Timestamp
      FROM ServerTopCallObjectMatches
      WHERE (? IS NULL OR COALESCE(Object_File, Target_File_Name) = ?)
        AND (? IS NULL OR Object_Type = ?)
        AND (? = FALSE OR Object_UUID IS NOT NULL)
        AND (? IS NULL OR Total_Elapsed_Microseconds >= ?)
        AND (
          ? IS NULL
          OR Target ILIKE ? ESCAPE '!'
          OR Operation ILIKE ? ESCAPE '!'
          OR COALESCE(Object_Name, '') ILIKE ? ESCAPE '!'
          OR COALESCE(Object_File, Target_File_Name, '') ILIKE ? ESCAPE '!'
          OR COALESCE(Related_TO_Name, '') ILIKE ? ESCAPE '!'
          OR COALESCE(Related_Table_Name, '') ILIKE ? ESCAPE '!'
        )
    )
  `;
}

async function listTopCallSummary(options) {
  try {
    await ensureServerLogTables();
    const { q, file, objectType, matchedOnly = false, limit = environment.api.defaultLimit, offset = 0 } = options;
    const params = buildSummaryParams({ q, file, objectType, matchedOnly });
    const sql = buildSummaryQuery({ includeLimit: limit > 0 });
    if (limit > 0) params.push(limit, offset);
    const result = await db.executeQuery(sql, params);
    return { data: convertBigInts(result.rows), meta: result.meta };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function countTopCallSummary(options) {
  try {
    await ensureServerLogTables();
    const params = buildSummaryParams(options);
    const result = await db.executeQuery(buildSummaryQuery({ countOnly: true, includeLimit: false }), params);
    return { data: convertBigInts(result.rows), meta: result.meta };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function getTopCallWaitAnalysis(options) {
  try {
    await ensureServerLogTables();

    const summaryParams = buildSummaryParams(options);
    const hotspotSql = `
      WITH filtered AS (
        SELECT *
        FROM ServerTopCallOptimizationSummary
        WHERE (? IS NULL OR File_Name = ?)
          AND (? IS NULL OR Object_Type = ?)
          AND (? = FALSE OR Object_UUID IS NOT NULL)
          AND (
            ? IS NULL
            OR Object_Name ILIKE ? ESCAPE '!'
            OR File_Name ILIKE ? ESCAPE '!'
            OR COALESCE(Related_TO_Name, '') ILIKE ? ESCAPE '!'
            OR COALESCE(Related_Table_Name, '') ILIKE ? ESCAPE '!'
            OR COALESCE(Operations, '') ILIKE ? ESCAPE '!'
          )
      ),
      scored AS (
        SELECT
          Object_Type,
          Object_UUID,
          Object_Name,
          File_Name,
          Related_TO_Name,
          Related_Table_Name,
          Match_Confidence,
          Call_Count,
          Total_Elapsed_Microseconds,
          Max_Elapsed_Microseconds,
          Wait_Time_Microseconds,
          IO_Time_Microseconds,
          Total_Elapsed_Milliseconds,
          Max_Elapsed_Milliseconds,
          Wait_Time_Milliseconds,
          IO_Time_Milliseconds,
          Operations,
          Optimization_Hint,
          CASE
            WHEN SUM(COALESCE(Wait_Time_Microseconds, 0)) OVER () > 0
              THEN 100.0 * COALESCE(Wait_Time_Microseconds, 0) / SUM(COALESCE(Wait_Time_Microseconds, 0)) OVER ()
            ELSE 0
          END AS Wait_Share_Percent
        FROM filtered
      )
      SELECT *
      FROM scored
      ORDER BY Wait_Time_Microseconds DESC, Total_Elapsed_Microseconds DESC, lower(Object_Name)
      LIMIT 12
    `;

    const callParams = buildCallParams(options);
    const cte = buildFilteredCallRowsCte();
    const weekdaySql = `
      ${cte},
      with_parts AS (
        SELECT
          CASE CAST(strftime(Parsed_Timestamp, '%w') AS INTEGER)
            WHEN 0 THEN 7
            ELSE CAST(strftime(Parsed_Timestamp, '%w') AS INTEGER)
          END AS Time_Bucket_Order,
          CASE CAST(strftime(Parsed_Timestamp, '%w') AS INTEGER)
            WHEN 1 THEN 'Montag'
            WHEN 2 THEN 'Dienstag'
            WHEN 3 THEN 'Mittwoch'
            WHEN 4 THEN 'Donnerstag'
            WHEN 5 THEN 'Freitag'
            WHEN 6 THEN 'Samstag'
            ELSE 'Sonntag'
          END AS Time_Bucket_Label_DE,
          CASE CAST(strftime(Parsed_Timestamp, '%w') AS INTEGER)
            WHEN 1 THEN 'Monday'
            WHEN 2 THEN 'Tuesday'
            WHEN 3 THEN 'Wednesday'
            WHEN 4 THEN 'Thursday'
            WHEN 5 THEN 'Friday'
            WHEN 6 THEN 'Saturday'
            ELSE 'Sunday'
          END AS Time_Bucket_Label_EN,
          COALESCE(Wait_Time_Microseconds, 0) AS Wait_Time_Microseconds,
          COALESCE(Total_Elapsed_Microseconds, 0) AS Total_Elapsed_Microseconds
        FROM filtered
        WHERE Parsed_Timestamp IS NOT NULL
      )
      SELECT
        'weekday' AS Bucket_Type,
        Time_Bucket_Order,
        Time_Bucket_Label_DE,
        Time_Bucket_Label_EN,
        COUNT(*) AS Call_Count,
        SUM(Wait_Time_Microseconds) AS Wait_Time_Microseconds,
        SUM(Wait_Time_Microseconds) / 1000.0 AS Wait_Time_Milliseconds,
        AVG(Wait_Time_Microseconds) / 1000.0 AS Avg_Wait_Time_Milliseconds,
        SUM(Total_Elapsed_Microseconds) / 1000.0 AS Total_Elapsed_Milliseconds,
        CASE
          WHEN SUM(SUM(Wait_Time_Microseconds)) OVER () > 0
            THEN 100.0 * SUM(Wait_Time_Microseconds) / SUM(SUM(Wait_Time_Microseconds)) OVER ()
          ELSE 0
        END AS Wait_Share_Percent
      FROM with_parts
      GROUP BY Time_Bucket_Order, Time_Bucket_Label_DE, Time_Bucket_Label_EN
      ORDER BY Time_Bucket_Order
    `;

    const hourSql = `
      ${cte},
      with_parts AS (
        SELECT
          CAST(strftime(Parsed_Timestamp, '%H') AS INTEGER) AS Time_Bucket_Order,
          lpad(CAST(CAST(strftime(Parsed_Timestamp, '%H') AS INTEGER) AS VARCHAR), 2, '0') || ':00-' ||
            lpad(CAST(CAST(strftime(Parsed_Timestamp, '%H') AS INTEGER) AS VARCHAR), 2, '0') || ':59' AS Time_Bucket_Label_DE,
          lpad(CAST(CAST(strftime(Parsed_Timestamp, '%H') AS INTEGER) AS VARCHAR), 2, '0') || ':00-' ||
            lpad(CAST(CAST(strftime(Parsed_Timestamp, '%H') AS INTEGER) AS VARCHAR), 2, '0') || ':59' AS Time_Bucket_Label_EN,
          COALESCE(Wait_Time_Microseconds, 0) AS Wait_Time_Microseconds,
          COALESCE(Total_Elapsed_Microseconds, 0) AS Total_Elapsed_Microseconds
        FROM filtered
        WHERE Parsed_Timestamp IS NOT NULL
      )
      SELECT
        'hour' AS Bucket_Type,
        Time_Bucket_Order,
        Time_Bucket_Label_DE,
        Time_Bucket_Label_EN,
        COUNT(*) AS Call_Count,
        SUM(Wait_Time_Microseconds) AS Wait_Time_Microseconds,
        SUM(Wait_Time_Microseconds) / 1000.0 AS Wait_Time_Milliseconds,
        AVG(Wait_Time_Microseconds) / 1000.0 AS Avg_Wait_Time_Milliseconds,
        SUM(Total_Elapsed_Microseconds) / 1000.0 AS Total_Elapsed_Milliseconds,
        CASE
          WHEN SUM(SUM(Wait_Time_Microseconds)) OVER () > 0
            THEN 100.0 * SUM(Wait_Time_Microseconds) / SUM(SUM(Wait_Time_Microseconds)) OVER ()
          ELSE 0
        END AS Wait_Share_Percent
      FROM with_parts
      GROUP BY Time_Bucket_Order, Time_Bucket_Label_DE, Time_Bucket_Label_EN
      ORDER BY Time_Bucket_Order
    `;

    const operationSql = `
      ${cte}
      SELECT
        COALESCE(NULLIF(TRIM(Operation), ''), '(unknown)') AS Operation,
        COUNT(*) AS Call_Count,
        SUM(COALESCE(Total_Elapsed_Microseconds, 0)) / 1000.0 AS Total_Elapsed_Milliseconds,
        AVG(COALESCE(Total_Elapsed_Microseconds, 0)) / 1000.0 AS Avg_Elapsed_Milliseconds,
        MAX(COALESCE(Total_Elapsed_Microseconds, 0)) / 1000.0 AS Max_Elapsed_Milliseconds,
        SUM(COALESCE(Wait_Time_Microseconds, 0)) / 1000.0 AS Wait_Time_Milliseconds,
        SUM(COALESCE(IO_Time_Microseconds, 0)) / 1000.0 AS IO_Time_Milliseconds,
        CASE
          WHEN SUM(SUM(COALESCE(Total_Elapsed_Microseconds, 0))) OVER () > 0
            THEN 100.0 * SUM(COALESCE(Total_Elapsed_Microseconds, 0)) / SUM(SUM(COALESCE(Total_Elapsed_Microseconds, 0))) OVER ()
          ELSE 0
        END AS Total_Share_Percent
      FROM filtered
      GROUP BY COALESCE(NULLIF(TRIM(Operation), ''), '(unknown)')
      ORDER BY Total_Elapsed_Milliseconds DESC, Call_Count DESC, Operation
      LIMIT 20
    `;

    const timelineSql = `
      ${cte},
      range_info AS (
        SELECT
          MIN(Parsed_Timestamp) AS Min_Timestamp,
          MAX(Parsed_Timestamp) AS Max_Timestamp
        FROM filtered
        WHERE Parsed_Timestamp IS NOT NULL
      ),
      with_parts AS (
        SELECT
          CASE
            WHEN date_diff('day', range_info.Min_Timestamp, range_info.Max_Timestamp) > 14
              THEN date_trunc('day', Parsed_Timestamp)
            ELSE date_trunc('hour', Parsed_Timestamp)
          END AS Bucket_Start,
          CASE
            WHEN date_diff('day', range_info.Min_Timestamp, range_info.Max_Timestamp) > 14
              THEN 'day'
            ELSE 'hour'
          END AS Bucket_Granularity,
          COALESCE(Total_Elapsed_Microseconds, 0) AS Total_Elapsed_Microseconds,
          COALESCE(Wait_Time_Microseconds, 0) AS Wait_Time_Microseconds,
          COALESCE(IO_Time_Microseconds, 0) AS IO_Time_Microseconds
        FROM filtered
        CROSS JOIN range_info
        WHERE Parsed_Timestamp IS NOT NULL
      )
      SELECT
        strftime(Bucket_Start, '%Y-%m-%d %H:%M') AS Bucket_Start_Text,
        CASE
          WHEN Bucket_Granularity = 'day' THEN strftime(Bucket_Start, '%Y-%m-%d')
          ELSE strftime(Bucket_Start, '%Y-%m-%d %H:00')
        END AS Bucket_Label,
        Bucket_Granularity,
        COUNT(*) AS Call_Count,
        SUM(Total_Elapsed_Microseconds) / 1000.0 AS Total_Elapsed_Milliseconds,
        AVG(Total_Elapsed_Microseconds) / 1000.0 AS Avg_Elapsed_Milliseconds,
        MAX(Total_Elapsed_Microseconds) / 1000.0 AS Max_Elapsed_Milliseconds,
        SUM(Wait_Time_Microseconds) / 1000.0 AS Wait_Time_Milliseconds,
        SUM(IO_Time_Microseconds) / 1000.0 AS IO_Time_Milliseconds,
        CASE
          WHEN SUM(SUM(Total_Elapsed_Microseconds)) OVER () > 0
            THEN 100.0 * SUM(Total_Elapsed_Microseconds) / SUM(SUM(Total_Elapsed_Microseconds)) OVER ()
          ELSE 0
        END AS Total_Share_Percent
      FROM with_parts
      GROUP BY Bucket_Start, Bucket_Granularity
      ORDER BY Bucket_Start
      LIMIT 240
    `;

    const [hotspots, byWeekday, byHour, byOperation, timeline] = await Promise.all([
      db.executeQuery(hotspotSql, summaryParams),
      db.executeQuery(weekdaySql, callParams),
      db.executeQuery(hourSql, callParams),
      db.executeQuery(operationSql, callParams),
      db.executeQuery(timelineSql, callParams),
    ]);

    return {
      data: {
        hotspots: convertBigInts(hotspots.rows),
        by_weekday: convertBigInts(byWeekday.rows),
        by_hour: convertBigInts(byHour.rows),
        by_operation: convertBigInts(byOperation.rows),
        timeline: convertBigInts(timeline.rows),
      },
      meta: {
        hotspots: hotspots.meta,
        by_weekday: byWeekday.meta,
        by_hour: byHour.meta,
        by_operation: byOperation.meta,
        timeline: timeline.meta,
      },
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function listTopCallRows(options) {
  try {
    await ensureServerLogTables();
    const { q, file, objectType, matchedOnly = false, minElapsedMs, limit = environment.api.defaultLimit, offset = 0 } = options;
    const params = buildCallParams({ q, file, objectType, matchedOnly, minElapsedMs });
    const sql = buildCallQuery({ includeLimit: limit > 0 });
    if (limit > 0) params.push(limit, offset);
    const result = await db.executeQuery(sql, params);
    return { data: convertBigInts(result.rows), meta: result.meta };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function countTopCallRows(options) {
  try {
    await ensureServerLogTables();
    const params = buildCallParams(options);
    const result = await db.executeQuery(buildCallQuery({ countOnly: true, includeLimit: false }), params);
    return { data: convertBigInts(result.rows), meta: result.meta };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function getTopCallDashboard() {
  try {
    await ensureServerLogTables();
    const result = await db.executeQuery(`
      SELECT Metric_Key, Metric_Label, Metric_Value, Sort_Order
      FROM ServerTopCallDashboard
      ORDER BY Sort_Order
    `);
    return { data: convertBigInts(result.rows), meta: result.meta };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message);
  }
}

module.exports = {
  listTopCallSummary,
  countTopCallSummary,
  getTopCallWaitAnalysis,
  listTopCallRows,
  countTopCallRows,
  getTopCallDashboard,
};

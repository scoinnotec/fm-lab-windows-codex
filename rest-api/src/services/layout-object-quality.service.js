const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const environment = require('../config/environment');

let analysisTableChecked = false;

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

async function ensureAnalysisTable() {
  if (analysisTableChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS table_count
    FROM duckdb_tables()
    WHERE table_name = 'LayoutObjectQualityFindings'
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 1) {
    throw createError(
      'DATABASE_ERROR',
      'Layout object quality analysis is missing. Run sql/create_layout_object_quality_analysis.sql after importing the FileMaker XML.',
      { expected_tables: 1, found_tables: tableCount }
    );
  }

  analysisTableChecked = true;
}

function buildFilterParams({ q, file, category, severity }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    category || null,
    category || null,
    severity || null,
    severity || null,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
  ];
}

function buildQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        Finding_ID,
        Issue_Category,
        Issue_Type,
        Severity,
        Layout_UUID,
        Layout_Name,
        Layout_TO_Name,
        File_Name,
        Layout_ID,
        Object_UUID,
        Object_ID,
        Object_Name,
        Object_Type,
        Abs_Top,
        Abs_Left,
        Abs_Bottom,
        Abs_Right,
        Width,
        Height,
        Z_Order,
        Nesting_Level,
        Parent_Object_ID,
        Related_Object_UUID,
        Related_Object_ID,
        Related_Object_Name,
        Related_Object_Type,
        Related_Z_Order,
        Overlap_Area,
        Overlap_Ratio,
        Detail_Text`;

  const orderLimit = countOnly ? '' : `
    ORDER BY
      CASE Severity WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      Sort_Order,
      lower(Layout_Name),
      COALESCE(Z_Order, Object_ID),
      Object_ID
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM LayoutObjectQualityFindings
    WHERE (? IS NULL OR File_Name = ?)
      AND (? IS NULL OR Issue_Category = ?)
      AND (? IS NULL OR Severity = ?)
      AND (
        ? IS NULL
        OR Issue_Category ILIKE ? ESCAPE '!'
        OR Issue_Type ILIKE ? ESCAPE '!'
        OR Layout_Name ILIKE ? ESCAPE '!'
        OR COALESCE(Object_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Object_Type, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Related_Object_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Detail_Text, '') ILIKE ? ESCAPE '!'
      )
    ${orderLimit}
  `;
}

async function listLayoutObjectQualityFindings(options) {
  try {
    await ensureAnalysisTable();

    const {
      q,
      file,
      category,
      severity,
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const params = buildFilterParams({ q, file, category, severity });
    const sql = buildQuery({ includeLimit: limit > 0 });
    if (limit > 0) params.push(limit, offset);

    const result = await db.executeQuery(sql, params);
    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function countLayoutObjectQualityFindings(options) {
  try {
    await ensureAnalysisTable();

    const { q, file, category, severity } = options;
    const params = buildFilterParams({ q, file, category, severity });
    const sql = buildQuery({ countOnly: true, includeLimit: false });
    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

module.exports = {
  listLayoutObjectQualityFindings,
  countLayoutObjectQualityFindings,
};

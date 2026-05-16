const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const environment = require('../config/environment');

let qualityTablesChecked = false;

function convertBigInts(obj) {
  if (Array.isArray(obj)) {
    return obj.map(convertBigInts);
  }
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

async function ensureQualityTables() {
  if (qualityTablesChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS table_count
    FROM duckdb_tables()
    WHERE table_name IN ('QualityFindings', 'AnalysisDashboard')
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 2) {
    throw createError(
      'DATABASE_ERROR',
      'Quality analysis is missing. Run sql/create_quality_analysis.sql after importing the FileMaker XML.',
      { expected_tables: 2, found_tables: tableCount }
    );
  }

  qualityTablesChecked = true;
}

function buildFilterParams({ q, file, area, category, severity, type }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    area || null,
    area || null,
    category || null,
    category || null,
    severity || null,
    severity || null,
    type || null,
    type || null,
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

function buildQualityQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        Finding_ID,
        Area,
        Issue_Category,
        Issue_Type,
        Severity,
        Object_Type,
        Object_UUID,
        Object_Name,
        File_Name,
        Source_Table,
        Object_ID,
        Source_UUID,
        Source_Type,
        Source_Name,
        Source_File,
        Step_Number,
        Source_Location,
        Detail_Text,
        Usage_Count,
        Related_UUID,
        Related_Type,
        Related_Name`;

  const orderLimit = countOnly ? '' : `
    ORDER BY
      CASE Severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      Sort_Order,
      lower(Area),
      lower(Issue_Category),
      lower(COALESCE(Object_Name, Source_Name, ''))
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM QualityFindings
    WHERE (? IS NULL OR File_Name = ?)
      AND (? IS NULL OR Area = ?)
      AND (? IS NULL OR Issue_Category = ?)
      AND (? IS NULL OR Severity = ?)
      AND (? IS NULL OR Object_Type = ?)
      AND (
        ? IS NULL
        OR Area ILIKE ? ESCAPE '!'
        OR Issue_Category ILIKE ? ESCAPE '!'
        OR Issue_Type ILIKE ? ESCAPE '!'
        OR Object_Name ILIKE ? ESCAPE '!'
        OR Source_Location ILIKE ? ESCAPE '!'
        OR Detail_Text ILIKE ? ESCAPE '!'
        OR Related_Name ILIKE ? ESCAPE '!'
      )
    ${orderLimit}
  `;
}

async function listQualityFindings(options) {
  try {
    await ensureQualityTables();

    const {
      q,
      file,
      area,
      category,
      severity,
      type,
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const params = buildFilterParams({ q, file, area, category, severity, type });
    const sql = buildQualityQuery({ includeLimit: limit > 0 });
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

async function countQualityFindings(options) {
  try {
    await ensureQualityTables();

    const params = buildFilterParams(options);
    const sql = buildQualityQuery({ countOnly: true, includeLimit: false });
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

async function getQualityDashboard(options = {}) {
  try {
    await ensureQualityTables();

    const result = await db.executeQuery(`
      SELECT
        Section,
        Metric_Key,
        Metric_Value,
        Sort_Order,
        Section_Label_Key,
        Section_Label_DE,
        Section_Label_EN,
        Metric_Label_Key,
        Metric_Label_DE,
        Metric_Label_EN,
        Metric_Source_Title,
        Metric_Source_URL
      FROM AnalysisDashboardLocalized
      ORDER BY Sort_Order, Metric_Value DESC, Metric_Key
    `);

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
  listQualityFindings,
  countQualityFindings,
  getQualityDashboard,
};

const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const environment = require('../config/environment');

let analysisTablesChecked = false;

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

async function ensureAnalysisTables() {
  if (analysisTablesChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS table_count
    FROM duckdb_tables()
    WHERE table_name IN ('ApiIntegrationFindings', 'ApiIntegrationSummary')
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 2) {
    throw createError(
      'DATABASE_ERROR',
      'API integration analysis is missing. Run sql/create_api_integration_analysis.sql after importing the FileMaker XML.',
      { expected_tables: 2, found_tables: tableCount }
    );
  }

  analysisTablesChecked = true;
}

function buildFilterParams({ q, file, family, type, risk, secretOnly }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    family || null,
    family || null,
    type || null,
    type || null,
    risk || null,
    risk || null,
    !!secretOnly,
    pattern,
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

function buildFindingsQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        Finding_ID,
        Integration_Type,
        Api_Family,
        Api_Name,
        Source_Category,
        Source_Type,
        Source_UUID,
        Source_Name,
        Source_File,
        Step_UUID,
        Step_Number,
        Step_Name,
        Field_Name,
        Endpoint_Text,
        Safe_Endpoint_Text,
        Value_Kind,
        Risk_Level,
        Is_Secret,
        Source_Location,
        Evidence_Text,
        Confidence,
        Usage_Count`;

  const orderLimit = countOnly ? '' : `
    ORDER BY
      CASE Integration_Type
        WHEN 'API' THEN 1
        WHEN 'External Database' THEN 2
        ELSE 3
      END,
      lower(Api_Family),
      lower(COALESCE(Source_Name, '')),
      COALESCE(Step_Number, 0),
      Sort_Order
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM ApiIntegrationFindings
    WHERE (? IS NULL OR Source_File = ?)
      AND (? IS NULL OR Api_Family = ?)
      AND (? IS NULL OR Integration_Type = ?)
      AND (? IS NULL OR Risk_Level = ?)
      AND (? = FALSE OR Is_Secret = TRUE)
      AND (
        ? IS NULL
        OR Api_Family ILIKE ? ESCAPE '!'
        OR Api_Name ILIKE ? ESCAPE '!'
        OR Source_Category ILIKE ? ESCAPE '!'
        OR Field_Name ILIKE ? ESCAPE '!'
        OR COALESCE(Source_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Safe_Endpoint_Text, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Source_Location, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Evidence_Text, '') ILIKE ? ESCAPE '!'
      )
    ${orderLimit}
  `;
}

function buildSummaryQuery({ includeLimit = true } = {}) {
  return `
    SELECT
      Summary_ID,
      Integration_Type,
      Api_Family,
      Api_Name,
      Finding_Count,
      Source_Count,
      Step_Count,
      Secret_Count,
      High_Risk_Count,
      Medium_Risk_Count,
      External_TO_Count,
      Example_Sources,
      Example_Endpoints,
      Source_File
    FROM ApiIntegrationSummary
    WHERE (? IS NULL OR Source_File = ?)
      AND (? IS NULL OR Api_Family = ?)
      AND (? IS NULL OR Integration_Type = ?)
      AND (? IS NULL OR (
        CASE
          WHEN ? = 'high' THEN High_Risk_Count > 0
          WHEN ? = 'medium' THEN Medium_Risk_Count > 0
          WHEN ? = 'info' THEN High_Risk_Count = 0 AND Medium_Risk_Count = 0
          ELSE TRUE
        END
      ))
      AND (? = FALSE OR Secret_Count > 0)
      AND (
        ? IS NULL
        OR Api_Family ILIKE ? ESCAPE '!'
        OR Api_Name ILIKE ? ESCAPE '!'
        OR COALESCE(Example_Sources, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Example_Endpoints, '') ILIKE ? ESCAPE '!'
      )
    ORDER BY
      CASE Integration_Type
        WHEN 'API' THEN 1
        WHEN 'External Database' THEN 2
        ELSE 3
      END,
      Finding_Count DESC,
      lower(Api_Family)
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;
}

function buildSummaryParams({ q, file, family, type, risk, secretOnly }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    family || null,
    family || null,
    type || null,
    type || null,
    risk || null,
    risk || null,
    risk || null,
    risk || null,
    !!secretOnly,
    pattern,
    pattern,
    pattern,
    pattern,
    pattern,
  ];
}

async function listApiIntegrations(options) {
  try {
    await ensureAnalysisTables();

    const {
      q,
      file,
      family,
      type,
      risk,
      secretOnly = false,
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const params = buildFilterParams({ q, file, family, type, risk, secretOnly });
    const sql = buildFindingsQuery({ includeLimit: limit > 0 });
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

async function countApiIntegrations(options) {
  try {
    await ensureAnalysisTables();

    const { q, file, family, type, risk, secretOnly = false } = options;
    const params = buildFilterParams({ q, file, family, type, risk, secretOnly });
    const sql = buildFindingsQuery({ countOnly: true, includeLimit: false });
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

async function listApiIntegrationSummary(options) {
  try {
    await ensureAnalysisTables();

    const {
      q,
      file,
      family,
      type,
      risk,
      secretOnly = false,
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const params = buildSummaryParams({ q, file, family, type, risk, secretOnly });
    const sql = buildSummaryQuery({ includeLimit: limit > 0 });
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

module.exports = {
  listApiIntegrations,
  countApiIntegrations,
  listApiIntegrationSummary,
};

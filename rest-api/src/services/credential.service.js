const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const environment = require('../config/environment');

let analysisTableChecked = false;

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

async function ensureAnalysisTable() {
  if (analysisTableChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS table_count
    FROM duckdb_tables()
    WHERE table_name = 'CredentialFindings'
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 1) {
    throw createError(
      'DATABASE_ERROR',
      'Credential analysis is missing. Run sql/create_credential_analysis.sql after importing the FileMaker XML.',
      { expected_tables: 1, found_tables: tableCount }
    );
  }

  analysisTableChecked = true;
}

function buildFilterParams({ q, file, category, risk, secretOnly }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    category || null,
    category || null,
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
  ];
}

function buildQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        Finding_ID,
        Source_Category,
        Credential_Type,
        Field_Name,
        Value_Text,
        Value_Kind,
        Risk_Level,
        Is_Secret,
        Source_Type,
        Source_UUID,
        Source_Name,
        Source_File,
        Step_UUID,
        Step_Number,
        Step_Name,
        Source_Location,
        Evidence_Text,
        Confidence`;

  const orderLimit = countOnly ? '' : `
    ORDER BY
      CASE Risk_Level
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'info' THEN 3
        ELSE 4
      END,
      Source_Category,
      lower(Source_Name),
      COALESCE(Step_Number, 0),
      Sort_Order
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM CredentialFindings
    WHERE (? IS NULL OR Source_File = ?)
      AND (? IS NULL OR Source_Category = ?)
      AND (? IS NULL OR Risk_Level = ?)
      AND (? = FALSE OR Is_Secret = TRUE)
      AND (
        ? IS NULL
        OR Source_Category ILIKE ? ESCAPE '!'
        OR Credential_Type ILIKE ? ESCAPE '!'
        OR Field_Name ILIKE ? ESCAPE '!'
        OR COALESCE(Value_Text, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Source_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Source_Location, '') ILIKE ? ESCAPE '!'
        OR COALESCE(Evidence_Text, '') ILIKE ? ESCAPE '!'
      )
    ${orderLimit}
  `;
}

async function listCredentialFindings(options) {
  try {
    await ensureAnalysisTable();

    const {
      q,
      file,
      category,
      risk,
      secretOnly = false,
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const params = buildFilterParams({ q, file, category, risk, secretOnly });
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

async function countCredentialFindings(options) {
  try {
    await ensureAnalysisTable();

    const { q, file, category, risk, secretOnly = false } = options;
    const params = buildFilterParams({ q, file, category, risk, secretOnly });
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
  listCredentialFindings,
  countCredentialFindings,
};

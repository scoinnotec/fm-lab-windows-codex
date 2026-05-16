const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const { OBJECT_TYPE_MAP } = require('../config/constants');
const environment = require('../config/environment');

const SUPPORTED_TYPES = new Set(['Script', 'Layout', 'CustomFunction', 'ValueList', 'Field', 'BaseTable']);
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

function normalizeObjectType(type) {
  if (!type) return null;
  const normalized = OBJECT_TYPE_MAP[String(type).toLowerCase()] || type;
  if (!SUPPORTED_TYPES.has(normalized)) {
    throw createError(
      'VALIDATION_ERROR',
      `Object usage analysis does not support type '${type}'.`,
      { type, supported: [...SUPPORTED_TYPES] }
    );
  }
  return normalized;
}

function parseUsageGroups(value) {
  if (!value) return [];
  return String(value).split('|').filter(Boolean).map((entry) => {
    const idx = entry.lastIndexOf(':');
    if (idx < 0) return { category: entry, count: 0 };
    return {
      category: entry.slice(0, idx),
      count: Number(entry.slice(idx + 1)) || 0,
    };
  });
}

async function ensureAnalysisTables() {
  if (analysisTablesChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS table_count
    FROM duckdb_tables()
    WHERE table_name IN ('ObjectUsageSummary', 'ObjectUsageDetails')
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 2) {
    throw createError(
      'DATABASE_ERROR',
      'Object usage analysis is missing. Run sql/create_object_usage_analysis.sql after importing the FileMaker XML.',
      { expected_tables: 2, found_tables: tableCount }
    );
  }

  analysisTablesChecked = true;
}

function buildFilterParams({ type, file, q, unusedOnly, maxUsage }) {
  const pattern = normalizeSearchPattern(q);
  const dbType = normalizeObjectType(type);
  const maxValue = maxUsage === null || maxUsage === undefined || maxUsage === ''
    ? null
    : Number(maxUsage);

  return {
    params: [
      dbType,
      dbType,
      file || null,
      file || null,
      pattern,
      pattern,
      !!unusedOnly,
      Number.isFinite(maxValue) ? maxValue : null,
      Number.isFinite(maxValue) ? maxValue : null,
    ],
    dbType,
  };
}

function buildSummaryQuery({ countOnly = false, includeLimit = true, sort = 'rare' } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        s.Object_UUID,
        s.Object_Type,
        s.Object_Name,
        s.File_Name,
        s.Source_Table,
        s.Object_ID,
        s.Usage_Count AS usage_count,
        COALESCE(s.Usage_Groups, '') AS Usage_Groups`;

  let orderBy = 'ORDER BY s.Usage_Count ASC, lower(s.Object_Type) ASC, lower(s.Object_Name) ASC';
  if (sort === 'usage') {
    orderBy = 'ORDER BY s.Usage_Count DESC, lower(s.Object_Type) ASC, lower(s.Object_Name) ASC';
  } else if (sort === 'name') {
    orderBy = 'ORDER BY lower(s.Object_Name) ASC, s.Usage_Count ASC';
  }

  const orderLimit = countOnly ? '' : `
    ${orderBy}
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM ObjectUsageSummary s
    WHERE (? IS NULL OR s.Object_Type = ?)
      AND (? IS NULL OR s.File_Name = ?)
      AND (? IS NULL OR s.Object_Name ILIKE ? ESCAPE '!')
      AND (? = FALSE OR s.Usage_Count = 0)
      AND (? IS NULL OR s.Usage_Count <= ?)
    ${orderLimit}
  `;
}

function buildPageObjectsCte(items) {
  if (!items.length) {
    return {
      sql: 'page_objects(Object_UUID, File_Name) AS (SELECT NULL::VARCHAR, NULL::VARCHAR WHERE FALSE)',
      params: [],
    };
  }

  const placeholders = items.map(() => '(?, ?)').join(', ');
  const params = [];
  for (const item of items) {
    params.push(item.Object_UUID, item.File_Name);
  }

  return {
    sql: `page_objects(Object_UUID, File_Name) AS (VALUES ${placeholders})`,
    params,
  };
}

async function loadUsageDetails(items, perObjectLimit = 40, perCategoryLimit = 6) {
  if (!items.length) return new Map();

  const pageObjects = buildPageObjectsCte(items);
  const sql = `
    WITH
    ${pageObjects.sql},
    category_counts AS (
      SELECT Target_UUID, Target_File, Usage_Category, COUNT(*) AS category_count
      FROM ObjectUsageDetails
      GROUP BY Target_UUID, Target_File, Usage_Category
    ),
    ranked AS (
      SELECT
        d.*,
        cc.category_count,
        ROW_NUMBER() OVER (
          PARTITION BY d.Target_UUID, d.Target_File, d.Usage_Category
          ORDER BY d.Source_Location, d.Detail_Text
        ) AS category_rn
      FROM ObjectUsageDetails d
      JOIN category_counts cc
        ON cc.Target_UUID = d.Target_UUID
       AND cc.Target_File = d.Target_File
       AND cc.Usage_Category = d.Usage_Category
      JOIN page_objects p
        ON p.Object_UUID = d.Target_UUID
       AND p.File_Name = d.Target_File
    )
    SELECT *
    FROM ranked
    WHERE category_rn <= ?
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY Target_UUID, Target_File
      ORDER BY category_rn, category_count DESC, Usage_Category
    ) <= ?
    ORDER BY Target_File, Target_UUID, category_rn, category_count DESC, Usage_Category
  `;

  const result = await db.executeQuery(sql, [...pageObjects.params, perCategoryLimit, perObjectLimit]);
  const rows = convertBigInts(result.rows);
  const details = new Map();

  for (const row of rows) {
    const key = `${row.Target_UUID}|${row.Target_File}`;
    if (!details.has(key)) details.set(key, []);
    details.get(key).push({
      category: row.Usage_Category,
      source_type: row.Source_Type,
      source_uuid: row.Source_UUID,
      source_name: row.Source_Name,
      source_file: row.Source_File,
      step_number: row.Step_Number,
      location: row.Source_Location,
      detail: row.Detail_Text,
    });
  }

  return details;
}

async function listObjectUsage(options) {
  try {
    await ensureAnalysisTables();

    const {
      type,
      file,
      q,
      unusedOnly = false,
      maxUsage = null,
      sort = 'rare',
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const { params } = buildFilterParams({ type, file, q, unusedOnly, maxUsage });
    const sql = buildSummaryQuery({ includeLimit: limit > 0, sort });
    if (limit > 0) params.push(limit, offset);

    const result = await db.executeQuery(sql, params);
    const rows = convertBigInts(result.rows).map((row) => ({
      ...row,
      usage_groups: parseUsageGroups(row.Usage_Groups),
      usage_details: [],
    }));

    const details = await loadUsageDetails(rows);
    for (const row of rows) {
      row.usage_details = details.get(`${row.Object_UUID}|${row.File_Name}`) || [];
      delete row.Usage_Groups;
    }

    return {
      data: rows,
      meta: {
        ...result.meta,
        supported_types: [...SUPPORTED_TYPES],
        detail_limit_per_object: 40,
        structural_links_are_excluded: true,
      },
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function countObjectUsage(options) {
  try {
    await ensureAnalysisTables();

    const { type, file, q, unusedOnly = false, maxUsage = null } = options;
    const { params } = buildFilterParams({ type, file, q, unusedOnly, maxUsage });
    const sql = buildSummaryQuery({ countOnly: true, includeLimit: false });
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
  listObjectUsage,
  countObjectUsage,
};

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
    WHERE table_name IN (
      'TableOccurrenceUsageSummary',
      'TableOccurrenceUsageDetails',
      'TableOccurrenceRelationshipDetails'
    )
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 3) {
    throw createError(
      'DATABASE_ERROR',
      'Table occurrence usage analysis is missing. Run sql/create_table_occurrence_usage_analysis.sql after importing the FileMaker XML.',
      { expected_tables: 3, found_tables: tableCount }
    );
  }

  analysisTablesChecked = true;
}

function buildFilterParams({ file, q, unusedOnly }) {
  const pattern = normalizeSearchPattern(q);
  return [
    file || null,
    file || null,
    pattern,
    pattern,
    pattern,
    pattern,
    !!unusedOnly,
  ];
}

function buildSummaryQuery({ countOnly = false, includeLimit = true } = {}) {
  const select = countOnly
    ? 'SELECT COUNT(*) AS count'
    : `SELECT
        s.TO_UUID,
        s.TO_Name,
        s.File_Name,
        s.BT_Name,
        s.DS_Name,
        s.Usage_Count AS usage_count,
        s.Functional_Usage_Count AS functional_usage_count,
        s.Relationship_Count AS relationship_count,
        COALESCE(s.Usage_Groups, '') AS Usage_Groups`;

  const orderLimit = countOnly ? '' : `
    ORDER BY s.Usage_Count DESC, s.Functional_Usage_Count DESC, s.Relationship_Count DESC, lower(s.TO_Name) ASC
    ${includeLimit ? 'LIMIT ? OFFSET ?' : ''}
  `;

  return `
    ${select}
    FROM TableOccurrenceUsageSummary s
    WHERE (? IS NULL OR s.File_Name = ?)
      AND (
        ? IS NULL
        OR s.TO_Name ILIKE ? ESCAPE '!'
        OR COALESCE(s.BT_Name, '') ILIKE ? ESCAPE '!'
        OR COALESCE(s.DS_Name, '') ILIKE ? ESCAPE '!'
      )
      AND (? = FALSE OR s.Usage_Count = 0)
    ${orderLimit}
  `;
}

function buildPageTosCte(items) {
  if (!items.length) {
    return {
      sql: 'page_tos(TO_UUID, File_Name) AS (SELECT NULL::VARCHAR, NULL::VARCHAR WHERE FALSE)',
      params: [],
    };
  }

  const placeholders = items.map(() => '(?, ?)').join(', ');
  const params = [];
  for (const item of items) {
    params.push(item.TO_UUID, item.File_Name);
  }

  return {
    sql: `page_tos(TO_UUID, File_Name) AS (VALUES ${placeholders})`,
    params,
  };
}

async function loadUsageDetails(items, perToLimit = 40, perCategoryLimit = 6) {
  if (!items.length) return new Map();

  const pageTos = buildPageTosCte(items);
  const sql = `
    WITH
    ${pageTos.sql},
    all_details AS (
      SELECT * FROM TableOccurrenceUsageDetails
      UNION ALL
      SELECT * FROM TableOccurrenceRelationshipDetails
    ),
    category_counts AS (
      SELECT Target_TO_UUID, Target_File, Usage_Category, COUNT(*) AS category_count
      FROM all_details
      GROUP BY Target_TO_UUID, Target_File, Usage_Category
    ),
    ranked AS (
      SELECT
        d.*,
        cc.category_count,
        ROW_NUMBER() OVER (
          PARTITION BY d.Target_TO_UUID, d.Target_File, d.Usage_Category
          ORDER BY d.Source_Location, d.Detail_Text
        ) AS category_rn,
        ROW_NUMBER() OVER (
          PARTITION BY d.Target_TO_UUID, d.Target_File
          ORDER BY
            cc.category_count DESC,
            d.Usage_Category,
            d.Source_Location,
            d.Detail_Text
        ) AS rn
      FROM all_details d
      JOIN category_counts cc
        ON cc.Target_TO_UUID = d.Target_TO_UUID
       AND cc.Target_File = d.Target_File
       AND cc.Usage_Category = d.Usage_Category
      JOIN page_tos p
        ON p.TO_UUID = d.Target_TO_UUID
       AND p.File_Name = d.Target_File
    )
    SELECT *
    FROM ranked
    WHERE category_rn <= ?
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY Target_TO_UUID, Target_File
      ORDER BY category_rn, category_count DESC, Usage_Category
    ) <= ?
    ORDER BY Target_File, Target_TO_UUID, category_rn, category_count DESC, Usage_Category
  `;

  const result = await db.executeQuery(sql, [...pageTos.params, perCategoryLimit, perToLimit]);
  const rows = convertBigInts(result.rows);
  const details = new Map();

  for (const row of rows) {
    const key = `${row.Target_TO_UUID}|${row.Target_File}`;
    if (!details.has(key)) details.set(key, []);
    details.get(key).push({
      category: row.Usage_Category,
      family: row.Usage_Family,
      source_type: row.Source_Type,
      source_uuid: row.Source_UUID,
      source_name: row.Source_Name,
      step_number: row.Step_Number,
      location: row.Source_Location,
      detail: row.Detail_Text,
    });
  }

  return details;
}

async function listTableOccurrenceUsage(options) {
  try {
    await ensureAnalysisTables();

    const {
      file,
      q,
      unusedOnly = false,
      limit = environment.api.defaultLimit,
      offset = 0,
    } = options;

    const params = buildFilterParams({ file, q, unusedOnly });
    const sql = buildSummaryQuery({ includeLimit: limit > 0 });
    if (limit > 0) params.push(limit, offset);

    const result = await db.executeQuery(sql, params);
    const rows = convertBigInts(result.rows).map((row) => ({
      ...row,
      usage_groups: parseUsageGroups(row.Usage_Groups),
      usage_details: [],
    }));

    const details = await loadUsageDetails(rows);
    for (const row of rows) {
      row.usage_details = details.get(`${row.TO_UUID}|${row.File_Name}`) || [];
      delete row.Usage_Groups;
    }

    return {
      data: rows,
      meta: {
        ...result.meta,
        detail_limit_per_to: 40,
        usage_count_includes_relationships: true,
        relationship_count_is_separate: true,
      },
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, options);
  }
}

async function countTableOccurrenceUsage(options) {
  try {
    await ensureAnalysisTables();

    const { file, q, unusedOnly = false } = options;
    const params = buildFilterParams({ file, q, unusedOnly });
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
  listTableOccurrenceUsage,
  countTableOccurrenceUsage,
};

const db = require('../config/database');
const { createError } = require('../middleware/error-handler');

let localizationChecked = false;

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

async function ensureLocalizationTables() {
  if (localizationChecked) return;

  const result = await db.executeQuery(`
    SELECT COUNT(*) AS table_count
    FROM duckdb_tables()
    WHERE table_name = 'LocalizationLabels'
  `);

  const tableCount = Number(result.rows[0]?.table_count || 0);
  if (tableCount < 1) {
    throw createError(
      'DATABASE_ERROR',
      'Localization labels are missing. Run sql/create_localization_labels.sql after importing the FileMaker XML.',
      { expected_tables: 1, found_tables: tableCount }
    );
  }

  localizationChecked = true;
}

async function listLabels(options = {}) {
  try {
    await ensureLocalizationTables();

    const { domain, language } = options;
    const result = await db.executeQuery(`
      SELECT
        Label_Key,
        Label_Domain,
        Language_Code,
        Label_Text,
        Source_Title,
        Source_URL,
        Sort_Order
      FROM LocalizationLabels
      WHERE (? IS NULL OR Label_Domain = ?)
        AND (? IS NULL OR Language_Code = ?)
      ORDER BY Sort_Order, Label_Domain, Label_Key, Language_Code
    `, [
      domain || null,
      domain || null,
      language || null,
      language || null,
    ]);

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
  listLabels,
};

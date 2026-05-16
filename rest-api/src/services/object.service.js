const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const { buildWhereClause, buildGroupByClause } = require('../utils/query-builder');
const environment = require('../config/environment');
const { OBJECT_TYPE_MAP, DETAIL_TEMPLATE_MAP, FOLDER_PSEUDO_TYPES, PSEUDO_TOKEN_TYPES } = require('../config/constants');
const aggregations = require('./aggregations');

/**
 * Resolve a possibly-pseudo Object_Type into a SQL filter fragment + params.
 * For Folder-Pseudo-Types ('ScriptFolder', 'LayoutFolder') the filter constrains
 * Object_Type='Folder' AND Source_Table=<mapped>. For all other types it's a plain
 * Object_Type=? filter.
 */
function buildTypeFilter(dbType) {
  if (FOLDER_PSEUDO_TYPES[dbType]) {
    return {
      sql: 'oc.Object_Type = ? AND oc.Source_Table = ?',
      sqlNoAlias: 'Object_Type = ? AND Source_Table = ?',
      params: ['Folder', FOLDER_PSEUDO_TYPES[dbType]],
    };
  }
  return {
    sql: 'oc.Object_Type = ?',
    sqlNoAlias: 'Object_Type = ?',
    params: [dbType],
  };
}
const templateService = require('./template.service');

/**
 * Object Service
 * Handles queries to ObjectCatalog table
 */

/**
 * Convert BigInt values in object to Numbers for JSON serialization
 */
function convertBigInts(obj) {
  if (Array.isArray(obj)) {
    return obj.map(convertBigInts);
  } else if (obj !== null && typeof obj === 'object') {
    const converted = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = typeof value === 'bigint' ? Number(value) : convertBigInts(value);
    }
    return converted;
  }
  return obj;
}

/**
 * Get object by UUID
 * @param {string} uuid - Object UUID
 * @returns {Promise<Object>} Object data
 */
async function getByUUID(uuid) {
  try {
    const sql = 'SELECT * FROM ObjectCatalog WHERE Object_UUID = ?';
    const result = await db.executeQuery(sql, [uuid]);

    if (result.rows.length === 0) {
      throw createError('OBJECT_NOT_FOUND', `Object with UUID '${uuid}' not found`, { uuid });
    }

    return {
      data: convertBigInts(result.rows[0]),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, { uuid });
  }
}

/**
 * List objects by type with optional filters
 * @param {Object} filters - Filter options
 * @param {string} filters.type
 * @param {string} [filters.file]
 * @param {number} [filters.limit]
 * @param {boolean} [filters.withUsage]   - Pseudo-Token-Erweiterung: usage_count Spalte
 * @param {boolean} [filters.withCategory] - Pseudo-Token-Erweiterung: category/category_id Spalten
 * @param {string|string[]} [filters.category] - Category-Filter (kommasepariert oder Array)
 * @param {string} [filters.sort]         - 'usage' | 'name' | 'category'
 * @returns {Promise<Object>} List of objects with metadata
 */
async function listObjects(filters) {
  try {
    const {
      type,
      file,
      limit = environment.api.defaultLimit,
      withUsage = false,
      withCategory = false,
      category,
      sort,
    } = filters;

    // Normalize type to PascalCase for database
    const dbType = OBJECT_TYPE_MAP[type] || type;

    // Categories als Array normalisieren (akzeptiert "A,B,C" oder Array).
    const categories = normalizeCategories(category);

    // Wenn der Typ eine Aggregations-Erweiterung verlangt, gehen wir über den
    // Aggregations-Builder. Sonst klassischer Pfad mit Reference_Count.
    const wantsAggregation =
      withUsage || withCategory || categories.length > 0 || (sort && PSEUDO_TOKEN_TYPES.includes(dbType));

    const supportsAggregation = aggregations.USAGE_TYPES.includes(dbType);

    if (wantsAggregation && supportsAggregation) {
      // Validierung: PluginComponent kennt keine Category-Schicht über sich.
      if (dbType === 'PluginComponent') {
        if (withCategory || categories.length > 0) {
          throw createError(
            'VALIDATION_ERROR',
            "PluginComponent has no parent category — '?withCategory' / '?category' are not supported.",
            { type, withCategory, category }
          );
        }
      }
      const { sql, params } = aggregations.buildListQuery(dbType, {
        file,
        withUsage,
        withCategory,
        categories,
        sort,
        limit,
        refAttached: db.isReferenceAttached(),
      });
      const result = await db.executeQuery(sql, params);
      return {
        data: convertBigInts(result.rows),
        meta: result.meta,
      };
    }

    // Standardpfad — bestehend, mit Reference_Count.
    const typeFilter = buildTypeFilter(dbType);

    let sql = `
      SELECT
        oc.*,
        COUNT(ol.Target_UUID) as Reference_Count
      FROM ObjectCatalog oc
      LEFT JOIN ObjectLinks ol ON oc.Object_UUID = ol.Source_UUID
        AND ol.Link_Type = 'operational'
      WHERE ${typeFilter.sql}
    `;

    const params = [...typeFilter.params];

    if (file) {
      sql += ' AND oc.File_Name = ?';
      params.push(file);
    }

    sql += `
      GROUP BY oc.Object_UUID, oc.Object_Type, oc.Object_Name,
               oc.File_Name, oc.Source_Table, oc.Object_ID
      ORDER BY oc.Object_Name
    `;

    if (limit > 0) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, filters);
  }
}

/**
 * Normalisiert den Category-Parameter zu einem String-Array.
 * Akzeptiert: undefined/null → []; String "A,B,C" → ['A','B','C']; Array → unverändert.
 */
function normalizeCategories(category) {
  if (!category) return [];
  if (Array.isArray(category)) return category.filter(Boolean);
  if (typeof category === 'string') {
    return category.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * GET /api/list/categories — Filter-Pillen-Datenbasis.
 * PRD prd_pseudo_object_types_filter.md §7.2: liefert pro Category eines
 * Pseudo-Token-Typs { category, token_count, total_usage }, sortiert nach
 * total_usage desc.
 */
async function listCategorySummary({ type }) {
  try {
    const dbType = OBJECT_TYPE_MAP[type] || type;
    if (!PSEUDO_TOKEN_TYPES.includes(dbType)) {
      throw createError(
        'VALIDATION_ERROR',
        `Type '${dbType}' has no category schema (only PSEUDO_TOKEN_TYPES are supported).`,
        { type, supported: PSEUDO_TOKEN_TYPES }
      );
    }
    const sql = aggregations.buildCategorySummaryQuery(dbType, db.isReferenceAttached());
    const result = await db.executeQuery(sql, []);
    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, { type });
  }
}

/**
 * Count objects with optional grouping
 * @param {Object} options - Count options {type, file, group_by}
 * @returns {Promise<Object>} Count results with metadata
 */
async function countObjects(options) {
  try {
    const { type, file, group_by } = options;

    // Normalize type to PascalCase for database
    const dbType = type ? (OBJECT_TYPE_MAP[type] || type) : null;

    const { clause: groupByClause, columns } = buildGroupByClause(group_by);

    let sql;
    const params = [];

    if (columns.length > 0) {
      // Grouped count
      sql = `
        SELECT ${columns.join(', ')}, COUNT(*) as count
        FROM ObjectCatalog
      `;

      const conditions = [];
      // Exclude DDR-specific object types from count
      conditions.push("Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')");

      if (dbType) {
        const typeFilter = buildTypeFilter(dbType);
        conditions.push(typeFilter.sqlNoAlias);
        params.push(...typeFilter.params);
      }
      if (file) {
        conditions.push('File_Name = ?');
        params.push(file);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ` ${groupByClause} ORDER BY ${columns.join(', ')}`;
    } else {
      // Simple count
      sql = 'SELECT COUNT(*) as count FROM ObjectCatalog';

      const conditions = [];
      // Exclude DDR-specific object types from count
      conditions.push("Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')");

      if (dbType) {
        const typeFilter = buildTypeFilter(dbType);
        conditions.push(typeFilter.sqlNoAlias);
        params.push(...typeFilter.params);
      }
      if (file) {
        conditions.push('File_Name = ?');
        params.push(file);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
    }

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

/**
 * Search objects by name pattern
 * @param {Object} searchOptions - Search options {name, type, file, limit, offset}
 * @returns {Promise<Object>} Search results with metadata
 */
async function searchObjects(searchOptions) {
  try {
    const { name, type, file, limit = environment.api.defaultLimit, offset = 0 } = searchOptions;

    // Normalize type to PascalCase for database
    const dbType = type ? (OBJECT_TYPE_MAP[type] || type) : null;

    // Use ILIKE for case-insensitive pattern matching
    // Exclude DDR-specific object types from search results
    let sql = `SELECT * FROM ObjectCatalog
               WHERE Object_Name ILIKE ?
               AND Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')`;
    const params = [name];

    if (dbType) {
      const typeFilter = buildTypeFilter(dbType);
      sql += ' AND ' + typeFilter.sqlNoAlias;
      params.push(...typeFilter.params);
    }

    if (file) {
      sql += ' AND File_Name = ?';
      params.push(file);
    }

    sql += ' ORDER BY Object_Name';

    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, searchOptions);
  }
}

/**
 * Count search results by name pattern
 * @param {Object} searchOptions - Search options {name, type, file}
 * @returns {Promise<Object>} Count result with metadata
 */
async function countSearchResults(searchOptions) {
  try {
    const { name, type, file } = searchOptions;

    // Normalize type to PascalCase for database
    const dbType = type ? (OBJECT_TYPE_MAP[type] || type) : null;

    // Use ILIKE for case-insensitive pattern matching
    // Exclude DDR-specific object types from count
    let sql = `SELECT COUNT(*) as count FROM ObjectCatalog
               WHERE Object_Name ILIKE ?
               AND Object_Type NOT IN ('DDR_ScriptStep', 'DDR_Calculation')`;
    const params = [name];

    if (dbType) {
      const typeFilter = buildTypeFilter(dbType);
      sql += ' AND ' + typeFilter.sqlNoAlias;
      params.push(...typeFilter.params);
    }

    if (file) {
      sql += ' AND File_Name = ?';
      params.push(file);
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, searchOptions);
  }
}

function normalizeScriptSearchTerm(q) {
  const raw = String(q || '').trim();
  const searchableChars = raw.replace(/\*/g, '').trim();

  if (searchableChars.length < 2) {
    return { raw, pattern: null };
  }

  const escaped = raw.split('*').map(escapeLikeLiteral).join('%');
  const pattern = raw.includes('*') ? escaped : `%${escaped}%`;

  return { raw, pattern };
}

function escapeLikeLiteral(value) {
  return value.replace(/[!%_]/g, (char) => `!${char}`);
}

function normalizeFolderUuids(folderUuids) {
  if (!folderUuids) return [];
  if (Array.isArray(folderUuids)) {
    return folderUuids.map(String).map(v => v.trim()).filter(Boolean);
  }
  return String(folderUuids)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function buildScriptContentWhere({ file, pattern, folderUuids }) {
  const conditions = [];
  const params = [];

  if (file) {
    conditions.push('s.File_Name = ?');
    params.push(file);
  }

  const folders = normalizeFolderUuids(folderUuids);
  if (folders.length > 0) {
    const placeholders = folders.map(() => '(?)').join(', ');
    conditions.push(`
      (s.Script_UUID, s.File_Name) IN (
        WITH RECURSIVE
        selected_folders(folder_uuid) AS (
          VALUES ${placeholders}
        ),
        folder_descendants(folder_uuid) AS (
          SELECT folder_uuid FROM selected_folders
          UNION
          SELECT fh.Source_UUID
          FROM FolderHierarchy fh
          JOIN folder_descendants fd
            ON fh.Parent_Folder_UUID = fd.folder_uuid
          WHERE fh.Source_Table = 'ScriptCatalog'
            AND fh.subtype = 'Folder'
        )
        SELECT scoped.Source_UUID, scoped.File_Name
        FROM FolderHierarchy scoped
        WHERE scoped.Source_Table = 'ScriptCatalog'
          AND scoped.subtype = 'Item'
          AND scoped.Parent_Folder_UUID IN (SELECT folder_uuid FROM folder_descendants)
      )
    `);
    params.push(...folders);
  }

  const searchConditions = [
    "s.Step_Name ILIKE ? ESCAPE '!'",
    "s.Variable_Name ILIKE ? ESCAPE '!'",
    "s.Calculation_Text ILIKE ? ESCAPE '!'",
    "s.Parameters_XML ILIKE ? ESCAPE '!'",
    "d.Step_Text ILIKE ? ESCAPE '!'",
    `EXISTS (
      SELECT 1
      FROM XMLStepReferences xsr
      WHERE xsr.Step_UUID = s.Step_UUID
        AND xsr.File_Name = s.File_Name
        AND (
          xsr.Ref_Name ILIKE ? ESCAPE '!'
          OR xsr.TO_Name ILIKE ? ESCAPE '!'
          OR xsr.Data_Source_Name ILIKE ? ESCAPE '!'
        )
    )`,
    `EXISTS (
      SELECT 1
      FROM XMLCalcReferences xcr
      WHERE xcr.Source_UUID = s.Script_UUID
        AND xcr.Source_Type = 'Script'
        AND xcr.File_Name = s.File_Name
        AND TRY_CAST(xcr.Source_Subkey AS INTEGER) = s.Step_Index
        AND (
          xcr.Ref_Name ILIKE ? ESCAPE '!'
          OR xcr.Ref_SubName ILIKE ? ESCAPE '!'
          OR xcr.TO_Name ILIKE ? ESCAPE '!'
        )
    )`,
  ];

  conditions.push(`(${searchConditions.join('\n       OR ')})`);
  params.push(
    pattern, pattern, pattern, pattern, pattern,
    pattern, pattern, pattern,
    pattern, pattern, pattern
  );

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldMatches(value, rawTerm) {
  if (value == null) return false;
  const haystack = String(value);
  const term = String(rawTerm || '').trim();
  if (!term) return false;

  if (/\*/.test(term)) {
    const regex = new RegExp(
      escapeRegExp(term)
        .replace(/\\\*/g, '.*'),
      'i'
    );
    return regex.test(haystack);
  }

  return haystack.toLowerCase().includes(term.toLowerCase());
}

function decodeSearchEntities(text) {
  return text
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeSearchText(value, xmlish = false) {
  if (value == null) return '';

  let text = String(value)
    .replace(/\x7F/g, '\n')
    .replace(/\r\n|\r/g, '\n');

  if (xmlish) {
    text = text
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, ' $1 ')
      .replace(/\b(?:name|value|type|id|UUID)="([^"]*)"/g, ' $1 ')
      .replace(/<[^>]+>/g, ' ');
  }

  return decodeSearchEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSnippet(value, rawTerm, xmlish = false) {
  const normalized = normalizeSearchText(value, xmlish);
  if (!normalized) return '';

  const term = String(rawTerm || '').replace(/\*/g, '').trim();
  const lower = normalized.toLowerCase();
  const needle = term.toLowerCase();
  const matchAt = needle ? lower.indexOf(needle) : -1;
  const radius = 150;

  if (matchAt < 0) {
    return normalized.length > 320 ? `${normalized.slice(0, 320)}...` : normalized;
  }

  const start = Math.max(0, matchAt - radius);
  const end = Math.min(normalized.length, matchAt + needle.length + radius);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`;
}

function resolveScriptContentMatch(row, rawTerm) {
  const fields = [
    { field: 'Schritt', value: row.Step_Name },
    { field: 'Scripttext', value: row.Step_Text },
    { field: 'Variable', value: row.Variable_Name },
    { field: 'Formel/Text', value: row.Calculation_Text },
    { field: 'Direkte Referenz', value: row.Step_Refs },
    { field: 'Formel-Referenz', value: row.Calc_Refs },
    { field: 'Parameter/XML', value: row.Parameters_XML, xmlish: true },
  ];

  const match = fields.find(entry => fieldMatches(entry.value, rawTerm)) || fields.find(entry => entry.value != null);

  return {
    Match_Field: match?.field || 'Treffer',
    Match_Text: normalizeSearchText(match?.value || '', !!match?.xmlish).slice(0, 500),
    Snippet: buildSnippet(match?.value || '', rawTerm, !!match?.xmlish),
  };
}

function previewText(value, maxLength = 420) {
  const text = normalizeSearchText(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function buildScriptLinePreview(row, match) {
  const baseText = previewText(row.Step_Text) || previewText(row.Step_Name);
  const details = [];

  if (row.Variable_Name) {
    details.push(previewText(row.Variable_Name, 160));
  }

  if (row.Calculation_Text) {
    details.push(previewText(row.Calculation_Text, 360));
  }

  if (match.Match_Field === 'Direkte Referenz' && row.Step_Refs) {
    details.push(previewText(row.Step_Refs, 360));
  }

  if (match.Match_Field === 'Formel-Referenz' && row.Calc_Refs) {
    details.push(previewText(row.Calc_Refs, 360));
  }

  if (match.Match_Field === 'Parameter/XML' && match.Snippet) {
    details.push(previewText(match.Snippet, 420));
  }

  const parts = [baseText, ...details].filter(Boolean);
  return parts.join(' · ');
}

function mapScriptSearchRows(rows, rawTerm) {
  return convertBigInts(rows).map((row) => {
    const match = resolveScriptContentMatch(row, rawTerm);
    return {
      Script_UUID: row.Script_UUID,
      Script_Name: row.Script_Name,
      Step_UUID: row.Step_UUID,
      Step_Index: row.Step_Index,
      Step_Number: row.Step_Number,
      Step_Name: row.Step_Name,
      File_Name: row.File_Name,
      Script_Line_Text: buildScriptLinePreview(row, match),
      ...match,
    };
  });
}

/**
 * Search inside FileMaker scripts.
 *
 * The result is step-level: one row per matching script step. Search covers
 * step names, generated DDR step text, variable names, calculation text,
 * raw parameter XML/CDATA and direct/calculation references.
 */
async function searchScriptContents(searchOptions) {
  try {
    const { q, file, folderUuids, limit = environment.api.defaultLimit, offset = 0 } = searchOptions;
    const { raw, pattern } = normalizeScriptSearchTerm(q);

    if (!pattern) {
      return {
        data: [],
        meta: { execution_time_ms: 0, result_count: 0, min_query_length: 2 },
      };
    }

    const where = buildScriptContentWhere({ file, pattern, folderUuids });
    let sql = `
      WITH matched AS (
        SELECT
          s.Script_UUID,
          s.Script_Name,
          s.Step_UUID,
          s.Step_Index,
          s.Step_Index + 1 AS Step_Number,
          s.Step_Name,
          s.File_Name,
          s.Variable_Name,
          s.Calculation_Text,
          s.Parameters_XML,
          d.Step_Text
        FROM StepsForScripts s
        LEFT JOIN DDR_ScriptSteps d
          ON d.Step_UUID = s.Step_UUID
         AND d.File_Name = s.File_Name
        ${where.sql}
        ORDER BY lower(s.Script_Name), s.Step_Index
    `;

    const params = [...where.params];
    if (limit > 0) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(limit, offset);
    }

    sql += `
      ),
      step_refs AS (
        SELECT
          xsr.Step_UUID,
          xsr.File_Name,
          string_agg(
            DISTINCT concat_ws(' ', xsr.Ref_Type, xsr.Ref_Name, xsr.TO_Name, xsr.Data_Source_Name),
            ' | '
          ) AS Step_Refs
        FROM XMLStepReferences xsr
        JOIN matched m
          ON m.Step_UUID = xsr.Step_UUID
         AND m.File_Name = xsr.File_Name
        GROUP BY xsr.Step_UUID, xsr.File_Name
      ),
      calc_refs AS (
        SELECT
          xcr.Source_UUID AS Script_UUID,
          TRY_CAST(xcr.Source_Subkey AS INTEGER) AS Step_Index,
          xcr.File_Name,
          string_agg(
            DISTINCT concat_ws(' ', xcr.Ref_Type, xcr.Ref_Name, xcr.Ref_SubName, xcr.TO_Name),
            ' | '
          ) AS Calc_Refs
        FROM XMLCalcReferences xcr
        JOIN matched m
          ON m.Script_UUID = xcr.Source_UUID
         AND m.Step_Index = TRY_CAST(xcr.Source_Subkey AS INTEGER)
         AND m.File_Name = xcr.File_Name
        WHERE xcr.Source_Type = 'Script'
        GROUP BY xcr.Source_UUID, TRY_CAST(xcr.Source_Subkey AS INTEGER), xcr.File_Name
      )
      SELECT
        m.*,
        sr.Step_Refs,
        cr.Calc_Refs
      FROM matched m
      LEFT JOIN step_refs sr
        ON sr.Step_UUID = m.Step_UUID
       AND sr.File_Name = m.File_Name
      LEFT JOIN calc_refs cr
        ON cr.Script_UUID = m.Script_UUID
       AND cr.Step_Index = m.Step_Index
       AND cr.File_Name = m.File_Name
      ORDER BY lower(m.Script_Name), m.Step_Index
    `;

    const result = await db.executeQuery(sql, params);

    return {
      data: mapScriptSearchRows(result.rows, raw),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, searchOptions);
  }
}

/**
 * Count script content search results.
 */
async function countScriptContentResults(searchOptions) {
  try {
    const { q, file, folderUuids } = searchOptions;
    const { pattern } = normalizeScriptSearchTerm(q);

    if (!pattern) {
      return {
        data: [{ count: 0 }],
        meta: { execution_time_ms: 0, result_count: 1, min_query_length: 2 },
      };
    }

    const where = buildScriptContentWhere({ file, pattern, folderUuids });
    const sql = `
      SELECT COUNT(*) AS count
      FROM StepsForScripts s
      LEFT JOIN DDR_ScriptSteps d
        ON d.Step_UUID = s.Step_UUID
       AND d.File_Name = s.File_Name
      ${where.sql}
    `;

    const result = await db.executeQuery(sql, where.params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, searchOptions);
  }
}

/**
 * Pseudo-Type Reference-Resolver.
 *
 * ScriptStepType + PluginComponent haben keine vollständigen ObjectLinks-
 * Spiegelungen (PRD prd_pseudo_object_types_filter.md §6.4). Damit der
 * Referenzen-Tab im Frontend trotzdem die aufrufenden Scripts/Container
 * anzeigen kann, aggregieren wir die "parent"-Liste live aus den Basis-
 * Tabellen:
 *   - ScriptStepType  → StepsForScripts (alle Scripts mit Step_Name = Object_Name)
 *   - PluginComponent → ObjectLinks via groups_into → calls_pluginfunction
 *                       (Aufrufer-Container)
 *
 * Liefert ein {data, meta}-Objekt (kompatibel zum Standard-References-Pfad)
 * oder NULL, wenn das Objekt kein Pseudo-Typ ist.
 */
async function getPseudoTypeReferences(uuid, direction, link_type, limit) {
  // Object-Type lookup
  const typeLookup = await db.executeQuery(
    'SELECT Object_Type, Object_Name FROM ObjectCatalog WHERE Object_UUID = ?',
    [uuid]
  );
  if (typeLookup.rows.length === 0) return null;
  const objType = typeLookup.rows[0].Object_Type;

  // 'child'-direction macht für Aggregate keinen Sinn — sie haben keine
  // Downstream-Abhängigkeiten. 'parent' und 'all' liefern die Aufrufer-Liste.
  if (direction === 'child' || direction === 'recursive') return null;

  // Pseudo-Typen haben nur "operational"-Equivalente; auf structural-Anfragen
  // liefern wir explizit ein leeres Result, damit der Frontend-Hook nicht
  // versehentlich Aufrufer doppelt sieht.
  if (link_type === 'structural') {
    return { data: [], meta: { source: 'pseudo_type_resolver', object_type: objType } };
  }

  if (objType === 'ScriptStepType') {
    // Aufrufer = Scripts mit Step_Name = Object_Name
    const sql = `
      SELECT
        'parent' as direction,
        s.Script_UUID as uuid,
        'Script' as Object_Type,
        s.Script_Name as Object_Name,
        s.File_Name as File_Name,
        'uses_step_type' as Link_Role,
        FALSE as Is_Cross_File,
        NULL as Container_UUID,
        NULL as Container_Type,
        COUNT(*) as Call_Count
      FROM StepsForScripts s
      JOIN ObjectCatalog oc ON oc.Object_UUID = ?
      WHERE s.Step_Name = oc.Object_Name
      GROUP BY s.Script_UUID, s.Script_Name, s.File_Name
      ORDER BY Call_Count DESC, s.Script_Name ASC
      ${limit > 0 ? 'LIMIT ?' : ''}
    `;
    const params = limit > 0 ? [uuid, limit] : [uuid];
    const result = await db.executeQuery(sql, params);
    return {
      data: convertBigInts(result.rows),
      meta: { ...result.meta, source: 'pseudo_type_resolver', object_type: objType },
    };
  }

  if (objType === 'PluginComponent') {
    // Zwei-Stufen-Aggregation: groups_into → calls_pluginfunction
    // Aufrufer-Containers (Script/CustomFunction) der Funktionen dieser Component.
    const sql = `
      WITH funcs AS (
        SELECT pf.Object_UUID
        FROM ObjectCatalog pc
        JOIN ObjectLinks gi ON gi.Target_UUID = pc.Object_UUID
                           AND gi.Link_Role = 'groups_into'
        JOIN ObjectCatalog pf ON pf.Object_UUID = gi.Source_UUID
                             AND pf.Object_Type = 'PluginFunction'
        WHERE pc.Object_UUID = ?
      )
      SELECT
        'parent' as direction,
        oc.Object_UUID as uuid,
        oc.Object_Type as Object_Type,
        oc.Object_Name as Object_Name,
        oc.File_Name as File_Name,
        'calls_component' as Link_Role,
        FALSE as Is_Cross_File,
        pl.Target_UUID as Container_UUID,
        pc_container.Object_Type as Container_Type,
        COUNT(*) as Call_Count
      FROM funcs f
      JOIN ObjectLinks call ON call.Target_UUID = f.Object_UUID
                           AND call.Link_Role = 'calls_pluginfunction'
      JOIN ObjectCatalog oc ON oc.Object_UUID = call.Source_UUID
      LEFT JOIN ObjectLinks pl ON pl.Source_UUID = oc.Object_UUID
                              AND pl.Link_Role IN ('parent_layout', 'parent_script')
      LEFT JOIN ObjectCatalog pc_container ON pc_container.Object_UUID = pl.Target_UUID
      GROUP BY oc.Object_UUID, oc.Object_Type, oc.Object_Name, oc.File_Name,
               pl.Target_UUID, pc_container.Object_Type
      ORDER BY Call_Count DESC, oc.Object_Name ASC
      ${limit > 0 ? 'LIMIT ?' : ''}
    `;
    const params = limit > 0 ? [uuid, limit] : [uuid];
    const result = await db.executeQuery(sql, params);
    return {
      data: convertBigInts(result.rows),
      meta: { ...result.meta, source: 'pseudo_type_resolver', object_type: objType },
    };
  }

  return null;
}

/**
 * Get object references (dependencies)
 * @param {Object} refOptions - Reference options {uuid, direction, link_type, limit}
 * @returns {Promise<Object>} References with metadata
 */
async function getReferences(refOptions) {
  try {
    const {
      uuid,
      direction = 'all',
      link_type = 'operational',
      limit = environment.api.defaultLimit
    } = refOptions;

    // Pseudo-Type-Sonderfall: ScriptStepType + PluginComponent haben keine
    // (vollständigen) ObjectLinks-Spiegelungen (PRD §6.4). Die "Verwendet in"-
    // Liste muss daher live aus den Basis-Tabellen aggregiert werden.
    const pseudoRefs = await getPseudoTypeReferences(uuid, direction, link_type, limit);
    if (pseudoRefs !== null) return pseudoRefs;

    let sql;
    let params;

    // Container-Resolution für Sub-Knoten (PRD prd_cross_references_hilite.md):
    // LayoutObject und ScriptStep haben keinen sinnvollen Standalone-Detail-View —
    // ihr Wert liegt im Container-Kontext. Die zusätzlichen LEFT JOINs liefern
    // den Container-UUID/Type über `parent_layout`/`parent_script`-Links mit.
    // Für andere Object-Types bleibt Container_UUID = NULL, und das Frontend
    // navigiert wie gewohnt direkt auf das Objekt.
    const CONTAINER_JOIN = `
      LEFT JOIN ObjectLinks pl ON pl.Source_UUID = oc.Object_UUID
        AND pl.Link_Role IN ('parent_layout', 'parent_script')
      LEFT JOIN ObjectCatalog pc ON pl.Target_UUID = pc.Object_UUID
    `;

    if (direction === 'child') {
      // Downstream dependencies (what this object references)
      sql = `
        SELECT
          ol.Target_UUID,
          oc.Object_Type as Target_Type,
          oc.Object_Name as Target_Name,
          oc.File_Name as Target_File,
          ol.Link_Role,
          ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Source_UUID = ?
      `;
      params = [uuid];

      if (link_type !== 'all') {
        sql += ' AND ol.Link_Type = ?';
        params.push(link_type);
      }
    } else if (direction === 'parent') {
      // Upstream dependencies (what references this object)
      sql = `
        SELECT
          ol.Source_UUID,
          oc.Object_Type as Source_Type,
          oc.Object_Name as Source_Name,
          oc.File_Name as Source_File,
          ol.Link_Role,
          ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Target_UUID = ?
      `;
      params = [uuid];

      if (link_type !== 'all') {
        sql += ' AND ol.Link_Type = ?';
        params.push(link_type);
      }
    } else if (direction === 'recursive') {
      // Recursive dependencies
      sql = `
        WITH RECURSIVE dependency_tree AS (
          SELECT Source_UUID, Target_UUID, Link_Role, 1 as depth
          FROM ObjectLinks
          WHERE Source_UUID = ? AND Link_Type = 'operational'

          UNION ALL

          SELECT ol.Source_UUID, ol.Target_UUID, ol.Link_Role, dt.depth + 1
          FROM ObjectLinks ol
          JOIN dependency_tree dt ON ol.Source_UUID = dt.Target_UUID
          WHERE dt.depth < 10 AND ol.Link_Type = 'operational'
        )
        SELECT DISTINCT
          dt.Target_UUID,
          dt.Link_Role,
          dt.depth,
          oc.Object_Type,
          oc.Object_Name,
          oc.File_Name
        FROM dependency_tree dt
        JOIN ObjectCatalog oc ON dt.Target_UUID = oc.Object_UUID
        ORDER BY depth, Object_Name
      `;
      params = [uuid];
    } else {
      // All (both parent and child) — beide Hälften mit Container-Resolution.
      const baseChild = `
        SELECT 'child' as direction,
          ol.Target_UUID as uuid,
          oc.Object_Type, oc.Object_Name, oc.File_Name,
          ol.Link_Role, ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Source_UUID = ?
      `;
      const baseParent = `
        SELECT 'parent' as direction,
          ol.Source_UUID as uuid,
          oc.Object_Type, oc.Object_Name, oc.File_Name,
          ol.Link_Role, ol.Is_Cross_File,
          pl.Target_UUID as Container_UUID,
          pc.Object_Type as Container_Type
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
        ${CONTAINER_JOIN}
        WHERE ol.Target_UUID = ?
      `;
      if (link_type !== 'all') {
        sql = `${baseChild} AND ol.Link_Type = ? UNION ALL ${baseParent} AND ol.Link_Type = ?`;
        params = [uuid, link_type, uuid, link_type];
      } else {
        sql = `${baseChild} UNION ALL ${baseParent}`;
        params = [uuid, uuid];
      }
    }

    if (limit > 0 && direction !== 'recursive') {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const result = await db.executeQuery(sql, params);

    return {
      data: convertBigInts(result.rows),
      meta: result.meta,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, refOptions);
  }
}

/**
 * Get object details using type-specific SQL template
 * Dispatches to object_details_<type>.sql based on Object_Type
 * Falls back to object_details_generic.sql for types without dedicated template
 * @param {string} uuid - Object UUID
 * @returns {Promise<Object>} Detail data with metadata
 */
async function getDetails(uuid) {
  try {
    // 1. Look up object type from ObjectCatalog
    const lookupSql = 'SELECT Object_Type, Object_Name, File_Name, Source_Table, Object_ID FROM ObjectCatalog WHERE Object_UUID = ?';
    const lookupResult = await db.executeQuery(lookupSql, [uuid]);

    if (lookupResult.rows.length === 0) {
      throw createError('OBJECT_NOT_FOUND', `Object with UUID '${uuid}' not found`, { uuid });
    }

    const objectInfo = lookupResult.rows[0];
    const objectType = objectInfo.Object_Type;

    // 2. Determine template name from explicit map
    const templateName = DETAIL_TEMPLATE_MAP[objectType] || 'object_details_generic';
    const hasDedicatedTemplate = objectType in DETAIL_TEMPLATE_MAP;

    // 3. Execute the detail template (templates/sql/ = 'report' source)
    const result = await templateService.executeTemplate(templateName, { uuid }, 'report');

    return {
      data: result.data,
      meta: {
        ...result.meta,
        object_type: objectType,
        object_name: objectInfo.Object_Name,
        file_name: objectInfo.File_Name,
        template_used: templateName,
        has_dedicated_template: hasDedicatedTemplate,
      },
      sql: result.sql,
    };
  } catch (error) {
    if (error.code) throw error;
    throw createError('DATABASE_ERROR', error.message, { uuid });
  }
}

module.exports = {
  getByUUID,
  getDetails,
  listObjects,
  listCategorySummary,
  countObjects,
  searchObjects,
  countSearchResults,
  searchScriptContents,
  countScriptContentResults,
  getReferences,
};

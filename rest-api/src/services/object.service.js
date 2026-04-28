const db = require('../config/database');
const { createError } = require('../middleware/error-handler');
const { buildWhereClause, buildGroupByClause } = require('../utils/query-builder');
const environment = require('../config/environment');
const { OBJECT_TYPE_MAP, DETAIL_TEMPLATE_MAP } = require('../config/constants');
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
 * @param {Object} filters - Filter options {type, file, limit}
 * @returns {Promise<Object>} List of objects with metadata
 */
async function listObjects(filters) {
  try {
    const { type, file, limit = environment.api.defaultLimit } = filters;

    // Normalize type to PascalCase for database
    const dbType = OBJECT_TYPE_MAP[type] || type;

    // Build query with reference count
    let sql = `
      SELECT
        oc.*,
        COUNT(ol.Target_UUID) as Reference_Count
      FROM ObjectCatalog oc
      LEFT JOIN ObjectLinks ol ON oc.Object_UUID = ol.Source_UUID
        AND ol.Link_Type = 'operational'
      WHERE oc.Object_Type = ?
    `;

    const params = [dbType];

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
        conditions.push('Object_Type = ?');
        params.push(dbType);
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
        conditions.push('Object_Type = ?');
        params.push(dbType);
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
      sql += ' AND Object_Type = ?';
      params.push(dbType);
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
      sql += ' AND Object_Type = ?';
      params.push(dbType);
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

    let sql;
    let params;

    if (direction === 'child') {
      // Downstream dependencies (what this object references)
      sql = `
        SELECT
          ol.Target_UUID,
          oc_target.Object_Type as Target_Type,
          oc_target.Object_Name as Target_Name,
          oc_target.File_Name as Target_File,
          ol.Link_Role,
          ol.Is_Cross_File
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc_target ON ol.Target_UUID = oc_target.Object_UUID
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
          oc_source.Object_Type as Source_Type,
          oc_source.Object_Name as Source_Name,
          oc_source.File_Name as Source_File,
          ol.Link_Role,
          ol.Is_Cross_File
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc_source ON ol.Source_UUID = oc_source.Object_UUID
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
      // All (both parent and child)
      sql = `
        SELECT 'child' as direction, ol.Target_UUID as uuid, oc.Object_Type, oc.Object_Name, oc.File_Name, ol.Link_Role, ol.Is_Cross_File
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
        WHERE ol.Source_UUID = ?

        UNION ALL

        SELECT 'parent' as direction, ol.Source_UUID as uuid, oc.Object_Type, oc.Object_Name, oc.File_Name, ol.Link_Role, ol.Is_Cross_File
        FROM ObjectLinks ol
        JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
        WHERE ol.Target_UUID = ?
      `;
      params = [uuid, uuid];

      if (link_type !== 'all') {
        // Need to add link_type filter for both queries
        sql = `
          SELECT 'child' as direction, ol.Target_UUID as uuid, oc.Object_Type, oc.Object_Name, oc.File_Name, ol.Link_Role, ol.Is_Cross_File
          FROM ObjectLinks ol
          JOIN ObjectCatalog oc ON ol.Target_UUID = oc.Object_UUID
          WHERE ol.Source_UUID = ? AND ol.Link_Type = ?

          UNION ALL

          SELECT 'parent' as direction, ol.Source_UUID as uuid, oc.Object_Type, oc.Object_Name, oc.File_Name, ol.Link_Role, ol.Is_Cross_File
          FROM ObjectLinks ol
          JOIN ObjectCatalog oc ON ol.Source_UUID = oc.Object_UUID
          WHERE ol.Target_UUID = ? AND ol.Link_Type = ?
        `;
        params = [uuid, link_type, uuid, link_type];
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
  countObjects,
  searchObjects,
  countSearchResults,
  getReferences,
};

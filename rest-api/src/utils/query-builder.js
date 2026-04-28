/**
 * Query Builder Utility
 * Builds dynamic SQL WHERE clauses and parameter arrays
 */

/**
 * Build WHERE clause for object filtering
 * @param {Object} filters - Filter object {type, file, name, uuid}
 * @returns {Object} {clause: string, params: Array} WHERE clause and parameters
 */
function buildWhereClause(filters) {
  const conditions = [];
  const params = [];

  if (filters.uuid) {
    conditions.push('Object_UUID = ?');
    params.push(filters.uuid);
  }

  if (filters.type) {
    conditions.push('Object_Type = ?');
    params.push(filters.type);
  }

  if (filters.file) {
    conditions.push('File_Name = ?');
    params.push(filters.file);
  }

  if (filters.name) {
    conditions.push('Object_Name LIKE ?');
    params.push(filters.name);
  }

  const clause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  return { clause, params };
}

/**
 * Build ORDER BY clause
 * @param {string} orderBy - Column to order by
 * @param {string} direction - ASC or DESC
 * @returns {string} ORDER BY clause
 */
function buildOrderByClause(orderBy = 'Object_Name', direction = 'ASC') {
  const validDirections = ['ASC', 'DESC'];
  const safeDirection = validDirections.includes(direction.toUpperCase())
    ? direction.toUpperCase()
    : 'ASC';

  return `ORDER BY ${orderBy} ${safeDirection}`;
}

/**
 * Build LIMIT clause
 * @param {number} limit - Maximum number of results
 * @returns {string} LIMIT clause
 */
function buildLimitClause(limit) {
  if (!limit || limit <= 0) {
    return '';
  }
  return `LIMIT ${Math.floor(limit)}`;
}

/**
 * Build GROUP BY clause for count queries
 * @param {string} groupBy - Comma-separated list of columns (e.g., "type,file")
 * @returns {Object} {clause: string, columns: Array} GROUP BY clause and columns
 */
function buildGroupByClause(groupBy) {
  if (!groupBy) {
    return { clause: '', columns: [] };
  }

  const columnMap = {
    type: 'Object_Type',
    file: 'File_Name',
  };

  const requestedColumns = groupBy.split(',').map((col) => col.trim());
  const columns = requestedColumns
    .map((col) => columnMap[col])
    .filter((col) => col !== undefined);

  if (columns.length === 0) {
    return { clause: '', columns: [] };
  }

  const clause = `GROUP BY ${columns.join(', ')}`;
  return { clause, columns };
}

/**
 * Escape SQL identifier (table or column name)
 * @param {string} identifier - Identifier to escape
 * @returns {string} Escaped identifier
 */
function escapeIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Escape SQL string value
 * @param {string} value - String value to escape
 * @returns {string} Escaped string
 */
function escapeString(value) {
  if (typeof value !== 'string') {
    throw new Error('escapeString expects a string');
  }
  return value.replace(/'/g, "''");
}

module.exports = {
  buildWhereClause,
  buildOrderByClause,
  buildLimitClause,
  buildGroupByClause,
  escapeIdentifier,
  escapeString,
};

/**
 * Markdown Formatter
 * Returns data as Markdown table
 * Format:
 * | Object_UUID | Object_Name |
 * | --- | --- |
 * | ABC-123 | Import Data |
 */

/**
 * Escape pipe characters in markdown table cells
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapePipe(text) {
  if (text === null || text === undefined) {
    return '';
  }

  // Replace pipe with escaped version and also escape backslashes
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' '); // Replace newlines with spaces
}

/**
 * Format data as Markdown table
 * @param {Array|Object} data - Data to format
 * @returns {string} Markdown-formatted table
 */
function format(data) {
  // Handle null/undefined
  if (!data) {
    return '_No data available_';
  }

  // Convert single object to array for uniform handling
  const rows = Array.isArray(data) ? data : [data];

  // Handle empty array
  if (rows.length === 0) {
    return '_No data available_';
  }

  // Get all unique keys from all objects (for header)
  const allKeys = new Set();
  rows.forEach(row => {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach(key => allKeys.add(key));
    }
  });

  const keys = Array.from(allKeys);

  // Build header row
  const header = '| ' + keys.map(key => escapePipe(key)).join(' | ') + ' |';

  // Build separator row
  const separator = '| ' + keys.map(() => '---').join(' | ') + ' |';

  // Build data rows
  const dataRows = rows.map(row => {
    const cells = keys.map(key => {
      const value = row[key];
      return escapePipe(value);
    });
    return '| ' + cells.join(' | ') + ' |';
  });

  // Combine all parts
  const markdown = [
    '# FileMaker DuckDB Analysis Results\n',
    header,
    separator,
    ...dataRows,
    '',
    `_Total rows: ${rows.length}_`
  ].join('\n');

  return markdown;
}

module.exports = {
  format,
};

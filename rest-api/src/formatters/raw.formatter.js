/**
 * Raw Formatter
 * Returns data as CSV-like comma-separated values
 * Format: Object_UUID,Object_Type,Object_Name,File_Name
 */

/**
 * Format data as CSV (comma-separated)
 * @param {Array|Object} data - Data to format
 * @returns {string} CSV-formatted string
 */
function format(data) {
  // Handle null/undefined
  if (!data) {
    return '';
  }

  // Convert single object to array for uniform handling
  const rows = Array.isArray(data) ? data : [data];

  // Handle empty array
  if (rows.length === 0) {
    return '';
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
  const header = keys.join(',');

  // Build data rows
  const dataRows = rows.map(row => {
    return keys.map(key => {
      const value = row[key];

      // Handle null/undefined
      if (value === null || value === undefined) {
        return '';
      }

      // Convert to string and escape commas/quotes
      const stringValue = String(value);

      // If value contains comma, newline, or quote, wrap in quotes and escape internal quotes
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }

      return stringValue;
    }).join(',');
  });

  // Combine header and data
  return [header, ...dataRows].join('\n');
}

module.exports = {
  format,
};

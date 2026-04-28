/**
 * Short Formatter
 * Returns only object names, one per line
 * Format: Import Data
 */

/**
 * Format data as short (only names)
 * @param {Array|Object} data - Data to format
 * @returns {string} Short-formatted string (names only)
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

  // Extract names
  const names = rows.map(row => {
    // Support different Name field names
    const name = row.Object_Name || row.Name || row.name ||
                 row.Script_Name || row.Field_Name || row.Layout_Name ||
                 row.Source_Name || row.Target_Name ||
                 'Unnamed';

    return name;
  });

  return names.join('\n');
}

module.exports = {
  format,
};

/**
 * Text Formatter
 * Returns data in "UUID | Name" format
 * Format: ABC-123-DEF | Import Data
 */

/**
 * Format data as text (UUID | Name)
 * @param {Array|Object} data - Data to format
 * @returns {string} Text-formatted string
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

  // Build text lines
  const lines = rows.map(row => {
    // Extract UUID and Name
    // Support different UUID field names
    const uuid = row.Object_UUID || row.UUID || row.uuid ||
                 row.Source_UUID || row.Target_UUID ||
                 row.Script_UUID || row.Field_UUID || row.Layout_UUID ||
                 'N/A';

    // Support different Name field names
    const name = row.Object_Name || row.Name || row.name ||
                 row.Script_Name || row.Field_Name || row.Layout_Name ||
                 row.Source_Name || row.Target_Name ||
                 'Unnamed';

    return `${uuid} | ${name}`;
  });

  return lines.join('\n');
}

module.exports = {
  format,
};

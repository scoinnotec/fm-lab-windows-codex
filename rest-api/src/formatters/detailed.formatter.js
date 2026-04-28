/**
 * Detailed Formatter
 * Returns data in detailed format with all key information
 * Format: UUID | Filename | Type | Name | Number of References
 * Example: ABC-123-DEF | Kunden | Script | Import Data | 3
 */

/**
 * Format data as detailed (UUID | File | Type | Name | Refs)
 * @param {Array|Object} data - Data to format
 * @returns {string} Detailed-formatted string
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

  // Build detailed lines
  const lines = rows.map(row => {
    // Extract UUID
    const uuid = row.Object_UUID || row.UUID || row.uuid ||
                 row.Source_UUID || row.Target_UUID ||
                 row.Script_UUID || row.Field_UUID || row.Layout_UUID ||
                 'N/A';

    // Extract File Name
    const fileName = row.File_Name || row.file || row.FileName ||
                     row.Source_File || row.Target_File ||
                     'N/A';

    // Extract Object Type
    const objectType = row.Object_Type || row.Type || row.type ||
                       row.Source_Type || row.Target_Type ||
                       'N/A';

    // Extract Object Name
    const objectName = row.Object_Name || row.Name || row.name ||
                       row.Script_Name || row.Field_Name || row.Layout_Name ||
                       row.Source_Name || row.Target_Name ||
                       'Unnamed';

    // Extract Reference Count (if available)
    const refCount = row.Reference_Count !== undefined ? row.Reference_Count :
                     row.reference_count !== undefined ? row.reference_count :
                     row.count !== undefined ? row.count :
                     row.depth !== undefined ? row.depth :
                     '-';

    return `${uuid} | ${fileName} | ${objectType} | ${objectName} | ${refCount}`;
  });

  return lines.join('\n');
}

module.exports = {
  format,
};

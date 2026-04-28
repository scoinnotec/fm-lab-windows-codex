/**
 * HTML Formatter
 * Returns data as HTML table with CSS styling
 */

/**
 * Escape HTML special characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }

  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Format data as HTML table
 * @param {Array|Object} data - Data to format
 * @returns {string} HTML-formatted table
 */
function format(data) {
  // Handle null/undefined
  if (!data) {
    return '<p>No data available</p>';
  }

  // Convert single object to array for uniform handling
  const rows = Array.isArray(data) ? data : [data];

  // Handle empty array
  if (rows.length === 0) {
    return '<p>No data available</p>';
  }

  // Get all unique keys from all objects (for header)
  const allKeys = new Set();
  rows.forEach(row => {
    if (row && typeof row === 'object') {
      Object.keys(row).forEach(key => allKeys.add(key));
    }
  });

  const keys = Array.from(allKeys);

  // Build HTML
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FileMaker DuckDB Analysis Results</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      margin: 20px;
      background-color: #f5f5f5;
    }
    h1 {
      color: #333;
      margin-bottom: 20px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      background-color: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    th, td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: left;
    }
    th {
      background-color: #4CAF50;
      color: white;
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    tr:hover {
      background-color: #f0f0f0;
    }
    .meta {
      margin-top: 20px;
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>FileMaker DuckDB Analysis Results</h1>
  <table>
    <thead>
      <tr>
`;

  // Add header cells
  keys.forEach(key => {
    html += `        <th>${escapeHtml(key)}</th>\n`;
  });

  html += `      </tr>
    </thead>
    <tbody>
`;

  // Add data rows
  rows.forEach(row => {
    html += '      <tr>\n';
    keys.forEach(key => {
      const value = row[key];
      html += `        <td>${escapeHtml(value)}</td>\n`;
    });
    html += '      </tr>\n';
  });

  html += `    </tbody>
  </table>
  <div class="meta">
    <p>Total rows: ${rows.length}</p>
  </div>
</body>
</html>`;

  return html;
}

module.exports = {
  format,
};

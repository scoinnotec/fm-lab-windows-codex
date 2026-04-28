/**
 * Content Formatter
 * Outputs the raw content from a 'content' column without any additional formatting
 * Use case: Pre-formatted text, narratives, custom displays
 */

function format(data) {
  if (!data) return '';

  const rows = Array.isArray(data) ? data : [data];
  if (rows.length === 0) return '';

  // Extract 'content' column from each row and join with newlines
  return rows
    .map(row => {
      // Support both lowercase and uppercase column names
      const content = row.content || row.Content || '';
      return content;
    })
    .join('\n');
}

module.exports = { format };

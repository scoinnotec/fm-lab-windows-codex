/**
 * Tokens Formatter
 *
 * Builds the structured `format=tokens` payload for Scripts, Custom Functions
 * and Calculations. Operates on three different shapes of input rows:
 *   - Script:         rows from object_details_script_tokens.sql
 *   - CustomFunction: rows from object_details_customfunction_tokens.sql
 *   - Calculation:    rows from object_details_calculation_tokens.sql
 *
 * The caller decides which shape via options.kind.
 */

const CHUNK_TYPE_MAP = {
  NoRef: 'text',
  FunctionRef: 'function',
  CustomFunctionRef: 'customFunction',
  PluginFunctionRef: 'pluginFunction',
  VariableReference: 'variable',
  FieldRef: 'field',
  Comment: 'comment',
};

const CHUNK_RE = /^<Chunk[^>]*>([\s\S]*)<\/Chunk>$/;

// FieldRef chunks contain nested XML with FieldReference + TableOccurrenceReference.
const FIELD_REF_RE = /<FieldReference[^>]*\bname="([^"]*)"[^>]*\bUUID="([^"]*)"/;
const TO_REF_RE = /<TableOccurrenceReference[^>]*\bname="([^"]*)"/;

/**
 * Strip the outer <Chunk type="…">…</Chunk> wrapper.
 */
function stripChunkWrap(s) {
  if (!s) return '';
  const m = CHUNK_RE.exec(s);
  return m ? m[1] : s;
}

/**
 * Decode the small set of XML numeric character references that appear in the
 * DDR data. The raw chunks come from the FileMaker XML export, so &#xB6; etc.
 * pass through as-is.
 */
function decodeXmlEntities(s) {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Build a token from a raw DDR_Calculations chunk row.
 *
 * For most chunk types the token's `content` is just the inner text of the
 * Chunk wrapper. FieldRef is special: its inner XML carries field name, table
 * occurrence name and field UUID — we surface a "TO::Field" content string
 * plus the resolved UUID.
 */
function tokenFromChunk(chunk) {
  const dbType = chunk.chunk_type;
  const apiType = CHUNK_TYPE_MAP[dbType] || 'text';
  const inner = stripChunkWrap(chunk.chunk_content);

  if (apiType === 'field') {
    const fieldMatch = FIELD_REF_RE.exec(inner);
    const toMatch = TO_REF_RE.exec(inner);
    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      const fieldUuid = fieldMatch[2];
      const toName = toMatch ? toMatch[1] : null;
      const content = toName ? `${toName}::${fieldName}` : fieldName;
      const tok = { type: 'field', content };
      if (fieldUuid) tok.uuid = fieldUuid;
      return tok;
    }
    // Defensive fallback: malformed FieldRef — pass through as text.
    return { type: 'text', content: decodeXmlEntities(inner) };
  }

  const content = decodeXmlEntities(inner);
  const tok = { type: apiType, content };

  if (apiType === 'variable') {
    tok.scope = content.startsWith('$$') ? 'global' : 'local';
  }

  return tok;
}

function formatScript(rows, { object, refs }) {
  const refsByLine = {};
  if (Array.isArray(refs)) {
    for (const r of refs) {
      const key = r.line_index;
      if (!refsByLine[key]) refsByLine[key] = [];
      refsByLine[key].push({ type: r.type, name: r.name, uuid: r.uuid });
    }
  }

  const lines = rows.map(row => {
    const base = {
      line: row.line_index + 1,
      indent: row.indent,
      kind: row.kind,
      enabled: row.enabled !== false,
    };

    if (row.kind === 'empty') {
      return base;
    }

    if (row.kind === 'comment') {
      const stepText = row.step_text || '';
      // Strip the leading '#' (and any whitespace after it) — the kind already
      // marks this as a comment, the text should be the comment content alone.
      const text = stepText.replace(/^#\s?/, '');
      return { ...base, text };
    }

    const lineRefs = refsByLine[row.line_index];
    return {
      ...base,
      stepId: row.step_id,
      stepName: row.step_name,
      text: row.step_text || row.step_name,
      ...(lineRefs && lineRefs.length ? { refs: lineRefs } : {}),
    };
  });

  const plainText = lines.map(line => {
    if (line.kind === 'empty') return '';
    const pad = '  '.repeat(line.indent || 0);
    if (line.kind === 'comment') return `${pad}# ${line.text}`;
    return pad + (line.text || '');
  }).join('\n');

  return {
    kind: 'script',
    object,
    lines,
    plainText,
  };
}

function formatCustomFunction(rows, { object }) {
  if (!rows || rows.length === 0) {
    return {
      kind: 'customfunction',
      object,
      parameters: [],
      tokens: [],
      plainText: '',
    };
  }

  const head = rows[0];
  const enrichedObject = {
    ...object,
    uuid: head.object_uuid || object.uuid,
    name: head.object_name || object.name,
    file: head.object_file || object.file,
  };

  const tokens = rows
    .filter(r => r.chunk_index !== null && r.chunk_index !== undefined)
    .map(r => tokenFromChunk({
      chunk_type: r.chunk_type,
      chunk_content: r.chunk_content,
    }));

  const plainText = head.plain_text != null
    ? head.plain_text
    : tokens.map(t => t.content).join('');

  return {
    kind: 'customfunction',
    object: enrichedObject,
    parameters: head.parameters || [],
    tokens,
    plainText,
  };
}

function formatCalculation(rows, { object }) {
  const tokens = (rows || []).map(r => tokenFromChunk({
    chunk_type: r.chunk_type,
    chunk_content: r.chunk_content,
  }));

  return {
    kind: 'calculation',
    object,
    tokens,
    plainText: tokens.map(t => t.content).join(''),
  };
}

/**
 * Public entry point.
 *
 * @param {Array} data - Rows from the appropriate SQL template
 * @param {Object} options - { kind, object, refs? }
 *   - kind:   'script' | 'customfunction' | 'calculation'
 *   - object: { uuid, name, file } or { hash } for calculations
 *   - refs:   optional array of script reference rows (only for kind=script)
 * @returns {Object} Token-format payload
 */
function format(data, options = {}) {
  const { kind, object = {}, refs } = options;

  switch (kind) {
    case 'script':
      return formatScript(data || [], { object, refs });
    case 'customfunction':
      return formatCustomFunction(data || [], { object });
    case 'calculation':
      return formatCalculation(data || [], { object });
    default:
      throw new Error(`tokens formatter: unknown kind '${kind}'`);
  }
}

module.exports = {
  format,
  // Exported for testing
  tokenFromChunk,
  stripChunkWrap,
  decodeXmlEntities,
  CHUNK_TYPE_MAP,
};

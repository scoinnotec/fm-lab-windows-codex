/**
 * API Constants
 * Defines supported object types, formats, error codes, and other constants
 */

/**
 * FileMaker Object Types (from ObjectCatalog)
 */
const OBJECT_TYPES = [
  'BaseTable',
  'TableOccurrence',
  'Relationship',
  'Field',
  'ValueList',
  'CustomFunction',
  'Script',
  'ScriptStep',
  'Layout',
  'LayoutObject',
  'LayoutPart',
  'Account',
  'PrivilegeSet',
  'ExtendedPrivilege',
  'Theme',
  'CustomMenu',
  'ScriptTrigger',
  'ExternalDataSource',
  'BaseDirectory',
  'Variable',
];

/**
 * Mapping from lowercase type to PascalCase (for database queries)
 * Used for case-insensitive API parameter handling
 */
const OBJECT_TYPE_MAP = {
  'basetable': 'BaseTable',
  'tableoccurrence': 'TableOccurrence',
  'relationship': 'Relationship',
  'field': 'Field',
  'valuelist': 'ValueList',
  'customfunction': 'CustomFunction',
  'script': 'Script',
  'scriptstep': 'ScriptStep',
  'layout': 'Layout',
  'layoutobject': 'LayoutObject',
  'layoutpart': 'LayoutPart',
  'account': 'Account',
  'privilegeset': 'PrivilegeSet',
  'extendedprivilege': 'ExtendedPrivilege',
  'theme': 'Theme',
  'custommenu': 'CustomMenu',
  'scripttrigger': 'ScriptTrigger',
  'externaldatasource': 'ExternalDataSource',
  'basedirectory': 'BaseDirectory',
  'variable': 'Variable',
};

/**
 * Link Types (from ObjectLinks)
 */
const LINK_TYPES = {
  OPERATIONAL: 'operational',
  STRUCTURAL: 'structural',
  ALL: 'all',
};

/**
 * Reference Directions
 */
const REFERENCE_DIRECTIONS = {
  ALL: 'all',
  PARENT: 'parent',
  CHILD: 'child',
  RECURSIVE: 'recursive',
};

/**
 * Output Formats
 */
const OUTPUT_FORMATS = {
  JSON: 'json',
  RAW: 'raw',
  TEXT: 'text',
  SHORT: 'short',
  DETAILED: 'detailed',
  HTML: 'html',
  MARKDOWN: 'markdown',
  CONTENT: 'content',
  MERMAID: 'mermaid',         // HTML-Wrapper mit Mermaid.js
  MERMAID_RAW: 'mermaid-raw', // Nur Mermaid-Code
};

/**
 * Error Codes with HTTP Status Codes
 */
const ERROR_CODES = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  OBJECT_NOT_FOUND: { code: 'OBJECT_NOT_FOUND', status: 404 },
  TEMPLATE_NOT_FOUND: { code: 'TEMPLATE_NOT_FOUND', status: 404 },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', status: 500 },
  TEMPLATE_ERROR: { code: 'TEMPLATE_ERROR', status: 500 },
  FILE_NOT_FOUND: { code: 'FILE_NOT_FOUND', status: 404 },
  IMPORT_ERROR: { code: 'IMPORT_ERROR', status: 500 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
};

/**
 * Default Values
 */
const DEFAULTS = {
  FORMAT: OUTPUT_FORMATS.JSON,
  LIMIT: 100,
  MAX_LIMIT: 10000,
  DIRECTION: REFERENCE_DIRECTIONS.ALL,
  LINK_TYPE: LINK_TYPES.OPERATIONAL,
  RECURSIVE_MAX_DEPTH: 10,
};

/**
 * Mermaid Themes
 */
const MERMAID_THEMES = {
  DEFAULT: 'default',
  DARK: 'dark',
  FOREST: 'forest',
  NEUTRAL: 'neutral',
};

/**
 * Mermaid Graph Directions
 */
const MERMAID_DIRECTIONS = {
  TOP_DOWN: 'TD',
  BOTTOM_UP: 'BT',
  LEFT_RIGHT: 'LR',
  RIGHT_LEFT: 'RL',
};

/**
 * Detail Template Map
 * Maps Object_Type (PascalCase) to the SQL template name in templates/sql/
 * Used by /get-details endpoint to dispatch to type-specific detail views
 */
const DETAIL_TEMPLATE_MAP = {
  'Script':         'object_details_script',
  'Layout':         'object_details_layout',
  'LayoutObject':   'object_details_layoutobject',
  'Field':          'object_details_field',
  'BaseTable':      'object_details_basetable',
  'CustomFunction': 'object_details_customfunction',
  'ValueList':      'object_details_valuelist',
  'Variable':            'object_details_variable',
};

/**
 * HTTP Status Codes
 */
const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

module.exports = {
  OBJECT_TYPES,
  OBJECT_TYPE_MAP,
  DETAIL_TEMPLATE_MAP,
  LINK_TYPES,
  REFERENCE_DIRECTIONS,
  OUTPUT_FORMATS,
  MERMAID_THEMES,
  MERMAID_DIRECTIONS,
  ERROR_CODES,
  DEFAULTS,
  HTTP_STATUS,
};

/**
 * Shared Constants for FileMaker DuckDB Analysis API
 * Extracted from rest-api/src/config/constants.js
 *
 * These constants are shared between:
 * - Backend (REST API)
 * - Frontend applications (Web, Admin, CLI, etc.)
 * - Type definitions
 */

/**
 * FileMaker Object Types (from ObjectCatalog)
 */
export const OBJECT_TYPES = [
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
] as const;

export type ObjectType = typeof OBJECT_TYPES[number];

/**
 * Mapping from lowercase type to PascalCase (for database queries)
 * Used for case-insensitive API parameter handling
 */
export const OBJECT_TYPE_MAP: Record<string, ObjectType> = {
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
export const LINK_TYPES = {
  OPERATIONAL: 'operational',
  STRUCTURAL: 'structural',
  ALL: 'all',
} as const;

export type LinkType = typeof LINK_TYPES[keyof typeof LINK_TYPES];

/**
 * Reference Directions
 */
export const REFERENCE_DIRECTIONS = {
  ALL: 'all',
  PARENT: 'parent',
  CHILD: 'child',
  RECURSIVE: 'recursive',
} as const;

export type ReferenceDirection = typeof REFERENCE_DIRECTIONS[keyof typeof REFERENCE_DIRECTIONS];

/**
 * Output Formats
 */
export const OUTPUT_FORMATS = {
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
} as const;

export type OutputFormat = typeof OUTPUT_FORMATS[keyof typeof OUTPUT_FORMATS];

/**
 * Error Codes with HTTP Status Codes
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', status: 400 },
  OBJECT_NOT_FOUND: { code: 'OBJECT_NOT_FOUND', status: 404 },
  TEMPLATE_NOT_FOUND: { code: 'TEMPLATE_NOT_FOUND', status: 404 },
  DATABASE_ERROR: { code: 'DATABASE_ERROR', status: 500 },
  TEMPLATE_ERROR: { code: 'TEMPLATE_ERROR', status: 500 },
  FILE_NOT_FOUND: { code: 'FILE_NOT_FOUND', status: 404 },
  IMPORT_ERROR: { code: 'IMPORT_ERROR', status: 500 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', status: 500 },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/**
 * Default Values
 */
export const DEFAULTS = {
  FORMAT: OUTPUT_FORMATS.JSON,
  LIMIT: 100,
  MAX_LIMIT: 10000,
  DIRECTION: REFERENCE_DIRECTIONS.ALL,
  LINK_TYPE: LINK_TYPES.OPERATIONAL,
  RECURSIVE_MAX_DEPTH: 10,
} as const;

/**
 * Mermaid Themes
 */
export const MERMAID_THEMES = {
  DEFAULT: 'default',
  DARK: 'dark',
  FOREST: 'forest',
  NEUTRAL: 'neutral',
} as const;

export type MermaidTheme = typeof MERMAID_THEMES[keyof typeof MERMAID_THEMES];

/**
 * Mermaid Graph Directions
 */
export const MERMAID_DIRECTIONS = {
  TOP_DOWN: 'TD',
  BOTTOM_UP: 'BT',
  LEFT_RIGHT: 'LR',
  RIGHT_LEFT: 'RL',
} as const;

export type MermaidDirection = typeof MERMAID_DIRECTIONS[keyof typeof MERMAID_DIRECTIONS];

/**
 * HTTP Status Codes
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
} as const;

export type HttpStatus = typeof HTTP_STATUS[keyof typeof HTTP_STATUS];

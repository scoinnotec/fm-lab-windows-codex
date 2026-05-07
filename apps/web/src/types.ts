import type { components } from '@packages/shared/types';

// Re-export commonly used types
export type FMObject = components['schemas']['FMObject'];
export type ObjectType = components['schemas']['ObjectType'];

/**
 * A reference item as returned by the /api/references endpoint (direction=all).
 * The actual API returns a flat array with a direction discriminator,
 * not the nested structure from the OpenAPI spec.
 */
export interface ReferenceItem {
  direction: 'parent' | 'child';
  uuid: string;
  Object_Type: string;
  Object_Name: string;
  File_Name: string;
  Link_Role: string;
  Is_Cross_File: boolean;
}

/**
 * Grouped references after client-side splitting.
 * Operational links (Script→Field, LayoutObject→Script, …) und strukturelle
 * Links (parent_folder, parent_object, parent_layout, …) werden parallel
 * geladen und getrennt dargestellt, damit Folder-Hierarchien sichtbar werden,
 * ohne den operationalen Kontext zu überladen.
 */
export interface GroupedReferences {
  parent: ReferenceItem[];
  child: ReferenceItem[];
  structuralParent: ReferenceItem[];
  structuralChild: ReferenceItem[];
}

/**
 * Breadcrumb item for navigation.
 */
export interface BreadcrumbItem {
  label: string;
  path: string | null; // null = current page (no link)
}

// Sort & Group options (Phase 3)
export type SortOption = 'standard' | 'name' | 'type' | 'file';
export type GroupOption = 'none' | 'type' | 'file';

export interface GroupHeader {
  _type: 'header';
  groupKey: string;
  groupLabel: string;
  itemCount: number;
  isExpanded: boolean;
}

export interface ListItemWrapper {
  _type: 'item';
  object: FMObject;
}

export type VirtualListRow = GroupHeader | ListItemWrapper;

// Detail View types (Phase 3b)
export type DetailViewTab = 'detail' | 'references' | 'graph' | 'versions' | 'notes';

export interface TabDefinition {
  id: DetailViewTab;
  label: string;
  enabled: boolean; // false = disabled/coming soon
}

/**
 * Sub-navigation tabs for the detail view.
 * Disabled tabs are shown but not clickable.
 */
export const DETAIL_TABS: readonly TabDefinition[] = [
  { id: 'detail', label: 'Details', enabled: true },
  { id: 'references', label: 'Referenzen', enabled: true },
  { id: 'graph', label: 'Graph', enabled: true },
  { id: 'versions', label: 'Versions', enabled: false },
  { id: 'notes', label: 'Notes', enabled: false },
];

/**
 * Object types that have a type-specific detail view available.
 * Used by ObjectDetail to determine heading text.
 */
export const DETAIL_VIEW_TYPES: ReadonlySet<string> = new Set([
  'Script',
  'Layout',
  'Field',
  'BaseTable',
  'CustomFunction',
  'ValueList',
]);

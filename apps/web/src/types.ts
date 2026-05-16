import type { components } from '@packages/shared/types';

// Re-export commonly used types
export type FMObject = components['schemas']['FMObject'];
export type ObjectType = components['schemas']['ObjectType'];

/**
 * A reference item as returned by the /api/references endpoint (direction=all).
 * The actual API returns a flat array with a direction discriminator,
 * not the nested structure from the OpenAPI spec.
 *
 * Container_UUID/Container_Type sind für Sub-Knoten (LayoutObject, ScriptStep)
 * gesetzt — diese öffnen sich beim Klick im Container-View mit dem Sub-Knoten
 * als ref-Highlight. Für eigenständige Objekte sind beide Felder null.
 */
export interface ReferenceItem {
  direction: 'parent' | 'child';
  uuid: string;
  Object_Type: string;
  Object_Name: string;
  File_Name: string;
  Link_Role: string;
  Is_Cross_File: boolean;
  Container_UUID?: string | null;
  Container_Type?: string | null;
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

export interface ScriptContentSearchResult {
  Script_UUID: string;
  Script_Name: string;
  Step_UUID: string;
  Step_Index: number;
  Step_Number: number;
  Step_Name: string;
  File_Name: string;
  Script_Line_Text: string;
  Match_Field: string;
  Match_Text: string;
  Snippet: string;
}

export interface TableOccurrenceUsageGroup {
  category: string;
  count: number;
}

export interface TableOccurrenceUsageDetail {
  category: string;
  family: 'functional' | 'relationship' | string;
  source_type: string;
  source_uuid: string | null;
  source_name: string | null;
  step_number: number | null;
  location: string | null;
  detail: string | null;
}

export interface TableOccurrenceUsageRow {
  TO_UUID: string;
  TO_Name: string;
  File_Name: string;
  BT_Name: string | null;
  DS_Name: string | null;
  usage_count: number;
  functional_usage_count: number;
  relationship_count: number;
  usage_groups: TableOccurrenceUsageGroup[];
  usage_details: TableOccurrenceUsageDetail[];
}

export interface ObjectUsageGroup {
  category: string;
  count: number;
}

export interface ObjectUsageDetail {
  category: string;
  source_type: string;
  source_uuid: string | null;
  source_name: string | null;
  source_file: string | null;
  step_number: number | null;
  location: string | null;
  detail: string | null;
}

export interface ObjectUsageRow {
  Object_UUID: string;
  Object_Type: string;
  Object_Name: string;
  File_Name: string;
  Source_Table: string | null;
  Object_ID: number | null;
  usage_count: number;
  usage_groups: ObjectUsageGroup[];
  usage_details: ObjectUsageDetail[];
}

export interface CredentialFindingRow {
  Finding_ID: string;
  Source_Category: string;
  Credential_Type: string;
  Field_Name: string;
  Value_Text: string | null;
  Value_Kind: string;
  Risk_Level: 'high' | 'medium' | 'info' | string;
  Is_Secret: boolean;
  Source_Type: string;
  Source_UUID: string | null;
  Source_Name: string | null;
  Source_File: string | null;
  Step_UUID: string | null;
  Step_Number: number | null;
  Step_Name: string | null;
  Source_Location: string | null;
  Evidence_Text: string | null;
  Confidence: string;
}

export interface ApiIntegrationRow {
  Finding_ID: string;
  Integration_Type: 'API' | 'External Database' | string;
  Api_Family: string;
  Api_Name: string;
  Source_Category: string;
  Source_Type: string;
  Source_UUID: string | null;
  Source_Name: string | null;
  Source_File: string | null;
  Step_UUID: string | null;
  Step_Number: number | null;
  Step_Name: string | null;
  Field_Name: string | null;
  Endpoint_Text: string | null;
  Safe_Endpoint_Text: string | null;
  Value_Kind: string;
  Risk_Level: 'high' | 'medium' | 'info' | string;
  Is_Secret: boolean;
  Source_Location: string | null;
  Evidence_Text: string | null;
  Confidence: string;
  Usage_Count: number;
}

export interface ApiIntegrationSummaryRow {
  Summary_ID: string;
  Integration_Type: 'API' | 'External Database' | string;
  Api_Family: string;
  Api_Name: string;
  Finding_Count: number;
  Source_Count: number;
  Step_Count: number;
  Secret_Count: number;
  High_Risk_Count: number;
  Medium_Risk_Count: number;
  External_TO_Count: number;
  Example_Sources: string | null;
  Example_Endpoints: string | null;
  Source_File: string | null;
}

export interface LayoutObjectQualityFindingRow {
  Finding_ID: string;
  Issue_Category: string;
  Issue_Type: string;
  Severity: 'high' | 'medium' | 'info' | string;
  Layout_UUID: string;
  Layout_Name: string;
  Layout_TO_Name: string | null;
  File_Name: string;
  Layout_ID: number;
  Object_UUID: string;
  Object_ID: number;
  Object_Name: string | null;
  Object_Type: string | null;
  Abs_Top: number;
  Abs_Left: number;
  Abs_Bottom: number;
  Abs_Right: number;
  Width: number;
  Height: number;
  Z_Order: number | null;
  Nesting_Level: number | null;
  Parent_Object_ID: number | null;
  Related_Object_UUID: string | null;
  Related_Object_ID: number | null;
  Related_Object_Name: string | null;
  Related_Object_Type: string | null;
  Related_Z_Order: number | null;
  Overlap_Area: number | null;
  Overlap_Ratio: number | null;
  Detail_Text: string | null;
}

export interface QualityFindingRow {
  Finding_ID: string;
  Area: string;
  Issue_Category: string;
  Issue_Type: string;
  Severity: 'high' | 'medium' | 'info' | string;
  Object_Type: string | null;
  Object_UUID: string | null;
  Object_Name: string | null;
  File_Name: string | null;
  Source_Table: string | null;
  Object_ID: number | null;
  Source_UUID: string | null;
  Source_Type: string | null;
  Source_Name: string | null;
  Source_File: string | null;
  Step_Number: number | null;
  Source_Location: string | null;
  Detail_Text: string | null;
  Usage_Count: number | null;
  Related_UUID: string | null;
  Related_Type: string | null;
  Related_Name: string | null;
}

export interface QualityDashboardMetricRow {
  Section: string;
  Metric_Key: string;
  Metric_Value: number;
  Sort_Order: number;
  Section_Label_Key?: string | null;
  Section_Label_DE?: string | null;
  Section_Label_EN?: string | null;
  Metric_Label_Key?: string | null;
  Metric_Label_DE?: string | null;
  Metric_Label_EN?: string | null;
  Metric_Source_Title?: string | null;
  Metric_Source_URL?: string | null;
}

export interface LocalizationLabelRow {
  Label_Key: string;
  Label_Domain: string;
  Language_Code: 'de' | 'en';
  Label_Text: string;
  Source_Title?: string | null;
  Source_URL?: string | null;
  Sort_Order?: number | null;
}

export interface ServerTopCallSummaryRow {
  Object_Type: string;
  Object_UUID: string | null;
  Object_Name: string;
  File_Name: string;
  Related_TO_Name: string | null;
  Related_Table_Name: string | null;
  Match_Confidence: string;
  Call_Count: number;
  Total_Elapsed_Microseconds: number;
  Max_Elapsed_Microseconds: number;
  Interval_Elapsed_Microseconds: number;
  Wait_Time_Microseconds: number;
  IO_Time_Microseconds: number;
  Network_Bytes_In: number;
  Network_Bytes_Out: number;
  Total_Elapsed_Milliseconds: number;
  Max_Elapsed_Milliseconds: number;
  Wait_Time_Milliseconds: number;
  IO_Time_Milliseconds: number;
  Operations: string | null;
  Last_Seen_Text: string | null;
  Optimization_Hint: string;
}

export interface ServerTopCallRow {
  Log_File: string;
  Row_Number: number;
  Timestamp_Text: string | null;
  Total_Elapsed_Microseconds: number;
  Operation: string | null;
  Target: string | null;
  Elapsed_Time_Microseconds: number | null;
  Wait_Time_Microseconds: number | null;
  IO_Time_Microseconds: number | null;
  Network_Bytes_In: number | null;
  Network_Bytes_Out: number | null;
  Client_Name: string | null;
  Target_File_Name: string | null;
  Target_Kind: string | null;
  Object_UUID: string | null;
  Object_Type: string | null;
  Object_Name: string | null;
  Object_File: string | null;
  Related_TO_Name: string | null;
  Related_Table_Name: string | null;
  Match_Source: string;
  Match_Confidence: string;
}

export interface ServerTopCallDashboardRow {
  Metric_Key: string;
  Metric_Label: string;
  Metric_Value: number;
  Sort_Order: number;
}

export interface ServerTopCallWaitHotspotRow extends ServerTopCallSummaryRow {
  Wait_Share_Percent: number;
}

export interface ServerTopCallTimeProfileRow {
  Bucket_Type: 'weekday' | 'hour';
  Time_Bucket_Order: number;
  Time_Bucket_Label_DE: string;
  Time_Bucket_Label_EN: string;
  Call_Count: number;
  Wait_Time_Microseconds: number;
  Wait_Time_Milliseconds: number;
  Avg_Wait_Time_Milliseconds: number;
  Total_Elapsed_Milliseconds: number;
  Wait_Share_Percent: number;
}

export interface ServerTopCallOperationProfileRow {
  Operation: string;
  Call_Count: number;
  Total_Elapsed_Milliseconds: number;
  Avg_Elapsed_Milliseconds: number;
  Max_Elapsed_Milliseconds: number;
  Wait_Time_Milliseconds: number;
  IO_Time_Milliseconds: number;
  Total_Share_Percent: number;
}

export interface ServerTopCallTimelineRow {
  Bucket_Start_Text: string;
  Bucket_Label: string;
  Bucket_Granularity: 'hour' | 'day' | string;
  Call_Count: number;
  Total_Elapsed_Milliseconds: number;
  Avg_Elapsed_Milliseconds: number;
  Max_Elapsed_Milliseconds: number;
  Wait_Time_Milliseconds: number;
  IO_Time_Milliseconds: number;
  Total_Share_Percent: number;
}

export interface ServerTopCallWaitAnalysis {
  hotspots: ServerTopCallWaitHotspotRow[];
  by_weekday: ServerTopCallTimeProfileRow[];
  by_hour: ServerTopCallTimeProfileRow[];
  by_operation?: ServerTopCallOperationProfileRow[];
  timeline?: ServerTopCallTimelineRow[];
}

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

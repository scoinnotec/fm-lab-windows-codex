import type React from 'react';

/**
 * Slot names accepted by the Core. Each slot defines its own prop shape
 * (see SlotPropsMap) so plugins can register type-safe components.
 */
export type SlotName = 'objectHeaderActions' | 'objectListItemActions';

/**
 * Minimal shape shared by all slot contexts. Plugins receive this and may
 * read plugin config from `manifest.config` / feature flags via useFeaturesContext.
 */
export interface ObjectSlotProps {
  objectUuid: string;
  objectType: string;
  objectName: string;
  fileName: string;
}

export interface SlotPropsMap {
  objectHeaderActions: ObjectSlotProps;
  objectListItemActions: ObjectSlotProps;
}

/**
 * Plugin metadata that mirrors the backend `/api/plugins` shape — plugins
 * use this locally to decide whether to render (e.g. checking supported
 * object types from `ui.supported_object_types`).
 */
export interface PluginFeatureMeta {
  ui?: {
    frontend_module?: string;
    supported_object_types?: string[];
  } | null;
  config?: Record<string, string>;
}

/**
 * A Plugin Module supplies a name (matching the backend manifest) and
 * zero or more Slot components.
 */
export interface PluginModule {
  name: string;
  slots: {
    [K in SlotName]?: React.ComponentType<SlotPropsMap[K]>;
  };
  /**
   * Optional gate: plugins can declare per-object applicability here.
   * Called with the slot context; returning false skips rendering.
   */
  isApplicable?: (ctx: ObjectSlotProps) => boolean;
}

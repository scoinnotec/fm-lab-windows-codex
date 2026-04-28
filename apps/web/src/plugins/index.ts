/**
 * Plugin Bootstrap.
 *
 * Each installed plugin registers itself here. Installing a new plugin =
 * adding one import line below. No dynamic discovery in the browser — the
 * bundler statically resolves imports.
 */
import { register } from './registry';
import fmide from './fmide';

register(fmide);

export { Slot } from './Slot';
export { register, getModule, listModules, getModulesForSlot } from './registry';
export type { PluginModule, SlotName, SlotPropsMap, ObjectSlotProps, PluginFeatureMeta } from './types';

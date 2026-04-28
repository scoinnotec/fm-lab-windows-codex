import type { PluginModule, SlotName } from './types';

/**
 * In-memory Plugin Registry.
 *
 * Plugins are registered at app startup (see ./index.ts) by importing and
 * calling `register()`. This keeps the wiring explicit — installing a new
 * plugin = adding one import statement.
 */
const modules: Map<string, PluginModule> = new Map();

export function register(mod: PluginModule): void {
  if (modules.has(mod.name)) {
    console.warn(`[plugins] module "${mod.name}" already registered — overwriting`);
  }
  modules.set(mod.name, mod);
}

export function getModule(name: string): PluginModule | undefined {
  return modules.get(name);
}

export function listModules(): PluginModule[] {
  return [...modules.values()];
}

/**
 * Return all registered modules that declare a component for the given slot.
 */
export function getModulesForSlot(slot: SlotName): PluginModule[] {
  return listModules().filter((m) => m.slots[slot] !== undefined);
}

import React from 'react';
import { useFeaturesContext } from '../hooks/useFeatures';
import { getModulesForSlot } from './registry';
import type { SlotName, SlotPropsMap } from './types';

type SlotComponentProps<N extends SlotName> = { name: N } & SlotPropsMap[N];

/**
 * Generic Slot component. Renders all registered plugin components for
 * the given slot, filtering by:
 *   - plugin enabled flag (from /api/version feature flags)
 *   - plugin's own `isApplicable` predicate (optional)
 *
 * Plugins can additionally bail out in their own component via `return null`.
 */
export function Slot<N extends SlotName>(props: SlotComponentProps<N>): React.ReactElement | null {
  const { name, ...ctx } = props;
  const { isEnabled } = useFeaturesContext();
  const modules = getModulesForSlot(name);

  const active = modules.filter((m) => {
    if (!isEnabled(m.name)) return false;
    if (m.isApplicable && !m.isApplicable(ctx as SlotPropsMap[N])) return false;
    return true;
  });

  if (active.length === 0) return null;

  return (
    <>
      {active.map((m) => {
        const Component = m.slots[name] as React.ComponentType<SlotPropsMap[N]>;
        return <Component key={m.name} {...(ctx as SlotPropsMap[N])} />;
      })}
    </>
  );
}

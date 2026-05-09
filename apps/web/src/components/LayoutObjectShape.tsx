import { memo } from 'react';
import type { LayoutObject } from '../hooks/useLayoutData';

export type LayoutObjectDisplayMode = 'normal' | 'highlight' | 'dim';
export type LabelMode = 'type' | 'name';

type Props = {
  object: LayoutObject;
  displayMode: LayoutObjectDisplayMode;
  labelMode: LabelMode;
  onMouseEnter: (uuid: string, clientX: number, clientY: number) => void;
  onMouseMove: (clientX: number, clientY: number) => void;
  onMouseLeave: () => void;
  onClick: (object: LayoutObject) => void;
};

// Farben aus display_layout_svg.sql v2 übernommen — gleiche Kategorisierung
const FILL: Record<string, string> = {
  'Edit Box': '#cce5ff',
  'Drop-down List': '#cce5ff',
  'Pop-up Menu': '#cce5ff',
  'Radio Button Set': '#cce5ff',
  'Checkbox Set': '#cce5ff',
  'Drop-down Calendar': '#cce5ff',
  'Concealed Edit Box': '#cce5ff',
  'Text': '#e2e3e5',
  'Graphic': '#e2e3e5',
  'Container': '#e2e3e5',
  'Web Viewer': '#e2e3e5',
  'Button': '#d4edda',
  'Grouped Button': '#d4edda',
  'Button Bar': '#d4edda',
  'Popover Button': '#d4edda',
  'Portal': '#fff3cd',
  'Group': '#fff3cd',
  'Tab Control': '#fff3cd',
  'Panel': '#fff3cd',
  'Slide Control': '#fff3cd',
  'PopoverPanel': '#fff3cd',
  'Rectangle': '#f8d7da',
  'Rounded Rectangle': '#f8d7da',
  'Line': '#f8d7da',
  'Oval': '#f8d7da',
};

const STROKE: Record<string, string> = {
  'Edit Box': '#004085',
  'Drop-down List': '#004085',
  'Pop-up Menu': '#004085',
  'Radio Button Set': '#004085',
  'Checkbox Set': '#004085',
  'Drop-down Calendar': '#004085',
  'Concealed Edit Box': '#004085',
  'Text': '#383d41',
  'Graphic': '#383d41',
  'Container': '#383d41',
  'Web Viewer': '#383d41',
  'Button': '#155724',
  'Grouped Button': '#155724',
  'Button Bar': '#155724',
  'Popover Button': '#155724',
  'Portal': '#856404',
  'Group': '#856404',
  'Tab Control': '#856404',
  'Panel': '#856404',
  'Slide Control': '#856404',
  'PopoverPanel': '#856404',
  'Rectangle': '#721c24',
  'Rounded Rectangle': '#721c24',
  'Line': '#721c24',
  'Oval': '#721c24',
};

const CONTAINER_TYPES = new Set([
  'Portal', 'Group', 'Tab Control', 'Panel', 'Slide Control', 'PopoverPanel',
]);

const DIMMED_FILL = '#f0f0f0';
const DIMMED_STROKE = '#cccccc';
const DIMMED_TEXT = '#999999';
const NORMAL_TEXT = '#333333';

const HIGHLIGHT_RING_COLOR = '#fb923c';
const HIGHLIGHT_RING_WIDTH = 4;

export function fillFor(type: string): string {
  return FILL[type] ?? '#f0f0f0';
}
export function strokeFor(type: string): string {
  return STROKE[type] ?? '#666666';
}

function escapeText(s: string): string {
  // SVG-text Inhalt darf <,> nicht enthalten — React entkommt automatisch.
  return s.length > 32 ? s.slice(0, 31) + '…' : s;
}

// Hilfsfunktion: nicht-leeres Trim oder null. Verhindert, dass Whitespace-only Texte
// (z.B. ein einzelnes Leerzeichen als Trenner-Element) als sichtbares Label landen.
function nonBlank(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function buildLabel(o: LayoutObject, mode: LabelMode): string {
  if (mode === 'name') {
    return (
      nonBlank(o.field_name)
      ?? nonBlank(o.text_content)
      ?? nonBlank(o.object_name)
      ?? o.object_type
    );
  }
  return o.object_type;
}

export const LayoutObjectShape = memo(function LayoutObjectShape({
  object,
  displayMode,
  labelMode,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onClick,
}: Props) {
  const x = object.abs_left;
  const y = object.abs_top;
  const width = Math.max(object.abs_right - object.abs_left, 1);
  const height = Math.max(object.abs_bottom - object.abs_top, 1);

  const dimmed = displayMode === 'dim';

  const fill = dimmed ? DIMMED_FILL : fillFor(object.object_type);
  const stroke = dimmed ? DIMMED_STROKE : strokeFor(object.object_type);
  const labelColor = dimmed ? DIMMED_TEXT : NORMAL_TEXT;
  const isContainer = CONTAINER_TYPES.has(object.object_type);

  const label = escapeText(buildLabel(object, labelMode));
  const showLabel = height >= 14 && width >= 30;

  return (
    <g
      className="layout-object"
      style={{ cursor: 'pointer' }}
      onMouseEnter={e => onMouseEnter(object.object_uuid, e.clientX, e.clientY)}
      onMouseMove={e => onMouseMove(e.clientX, e.clientY)}
      onMouseLeave={onMouseLeave}
      onClick={() => onClick(object)}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        fillOpacity={0.6}
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray={isContainer ? '5,3' : undefined}
        rx={2}
        ry={2}
      />
      {showLabel && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 3}
          textAnchor="middle"
          fontSize={9}
          fill={labelColor}
          fontFamily='-apple-system, "Segoe UI", Arial, sans-serif'
          pointerEvents="none"
        >
          {label}
        </text>
      )}
    </g>
  );
});

const SELECTED_RING_COLOR = '#dc2626';
const SELECTED_RING_WIDTH = 6;

/**
 * Highlight-Ring (orange) als globales SVG-Overlay — wird wie der SelectionRing *nach*
 * allen Objekten gerendert, damit er auch dann sichtbar bleibt, wenn das Treffer-Objekt
 * von späteren Container-Children visuell überlagert wird.
 */
export const HighlightRing = memo(function HighlightRing({ object }: { object: LayoutObject }) {
  const x = object.abs_left;
  const y = object.abs_top;
  const width = Math.max(object.abs_right - object.abs_left, 1);
  const height = Math.max(object.abs_bottom - object.abs_top, 1);
  const offset = HIGHLIGHT_RING_WIDTH / 2;
  return (
    <rect
      x={x - offset}
      y={y - offset}
      width={width + HIGHLIGHT_RING_WIDTH}
      height={height + HIGHLIGHT_RING_WIDTH}
      fill="none"
      stroke={HIGHLIGHT_RING_COLOR}
      strokeWidth={HIGHLIGHT_RING_WIDTH}
      rx={4}
      ry={4}
      pointerEvents="none"
    />
  );
});

/**
 * Selektions-Ring als globales SVG-Overlay — wird *nach* allen Layout-Objekten gerendert,
 * sodass er auch über tief verschachtelten Tab-Panels sichtbar bleibt (PRD F16).
 */
export const SelectionRing = memo(function SelectionRing({ object }: { object: LayoutObject }) {
  const x = object.abs_left;
  const y = object.abs_top;
  const width = Math.max(object.abs_right - object.abs_left, 1);
  const height = Math.max(object.abs_bottom - object.abs_top, 1);
  const offset = SELECTED_RING_WIDTH / 2;
  return (
    <rect
      x={x - offset}
      y={y - offset}
      width={width + SELECTED_RING_WIDTH}
      height={height + SELECTED_RING_WIDTH}
      fill="none"
      stroke={SELECTED_RING_COLOR}
      strokeWidth={SELECTED_RING_WIDTH}
      rx={6}
      ry={6}
      pointerEvents="none"
    />
  );
});

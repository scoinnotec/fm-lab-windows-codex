import { memo } from 'react';
import type { TableOccurrence } from '../hooks/useRelationshipGraph';
import { layoutTOBox, FIELD_ROW_HEIGHT, HEADER_HEIGHT } from './relationshipGraphLayout';

export type TOBoxDisplayMode = 'normal' | 'highlight' | 'dim';

type Props = {
  to: TableOccurrence;
  onClick?: (uuid: string) => void;
  displayMode?: TOBoxDisplayMode;
  isSelected?: boolean;
};

const DIMMED_HEADER = '#bbbbbb';
const DIMMED_STROKE = '#bbbbbb';
const DIMMED_HEADER_TEXT = '#666';
const DIMMED_FIELD_TEXT = '#999';
const DIMMED_FIELD_BG = '#f5f5f5';

const HIGHLIGHT_RING_COLOR = '#fb923c';
const HIGHLIGHT_RING_WIDTH = 6;

const SELECTED_RING_COLOR = '#dc2626';
const SELECTED_RING_WIDTH = 12;

function readableTextColor(r: number, g: number, b: number): string {
  // Standard sRGB Luminanz — bestimmt, ob Header-Text in Schwarz oder Weiß lesbarer ist.
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return luma > 160 ? '#000' : '#fff';
}

export const TOBox = memo(function TOBox({
  to,
  onClick,
  displayMode = 'normal',
  isSelected = false,
}: Props) {
  const layout = layoutTOBox(to);
  const { x, y, width, height } = layout;

  const dimmed = displayMode === 'dim';
  const highlighted = displayMode === 'highlight';

  const headerFill = dimmed
    ? DIMMED_HEADER
    : (to.color ? `rgb(${to.color.r}, ${to.color.g}, ${to.color.b})` : '#777777');
  const headerText = dimmed
    ? DIMMED_HEADER_TEXT
    : (to.color ? readableTextColor(to.color.r, to.color.g, to.color.b) : '#fff');
  const stroke = dimmed ? DIMMED_STROKE : '#222';
  const fieldText = dimmed ? DIMMED_FIELD_TEXT : '#222';
  const fieldHighlightBg = dimmed ? DIMMED_FIELD_BG : '#fff7d6';
  const isExternal = to.type === 'External';

  // Match-Ring (orange) wird hier inline mit der TO gezeichnet.
  // Der Selection-Ring (rot) wird stattdessen als globaler Overlay
  // *nach* allen TOs gezeichnet (siehe <SelectionRing /> im RelationshipGraph),
  // damit er auch über (halb-)verdeckte TOs hinweg sichtbar bleibt.
  const showHighlightRing = highlighted && !isSelected;
  const ringColor = showHighlightRing ? HIGHLIGHT_RING_COLOR : null;
  const ringWidth = showHighlightRing ? HIGHLIGHT_RING_WIDTH : 0;
  const ringOffset = ringWidth / 2;

  return (
    <g
      className="to-box"
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick ? () => onClick(to.uuid) : undefined}
    >
      {/* Glow-Ring (Match / Selection) — vor dem Body, damit der Body darüberliegt */}
      {ringColor && (
        <rect
          x={x - ringOffset}
          y={y - ringOffset}
          width={width + ringWidth}
          height={height + ringWidth}
          rx={ringWidth}
          ry={ringWidth}
          fill="none"
          stroke={ringColor}
          strokeWidth={ringWidth}
          strokeLinejoin="round"
          pointerEvents="none"
        />
      )}

      {/* Body */}
      <rect
        className="to-box-body"
        x={x}
        y={y}
        width={width}
        height={height}
        fill="#ffffff"
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray={isExternal ? '4 2' : undefined}
      />

      {/* Header */}
      <rect x={x} y={y} width={width} height={HEADER_HEIGHT} fill={headerFill} />
      <text
        x={x + 6}
        y={y + HEADER_HEIGHT - 5}
        fontSize={11}
        fontWeight="bold"
        fill={headerText}
      >
        {to.name}
      </text>

      {/* External-Indikator */}
      {isExternal && to.dataSource && (
        <text x={x + width - 4} y={y + HEADER_HEIGHT - 5} fontSize={9} textAnchor="end" fill={headerText}>
          ↗ {to.dataSource.name}
        </text>
      )}

      {/* Felder (Full/Related: nur an Beziehungen beteiligte Felder; Collapse: keine) */}
      {to.view !== 'Collapse' && to.fields.map((f, idx) => {
        const fy = y + HEADER_HEIGHT + idx * FIELD_ROW_HEIGHT;
        return (
          <g key={f.uuid}>
            {f.isUsedInRelation && (
              <rect
                x={x + 1}
                y={fy + 1}
                width={width - 2}
                height={FIELD_ROW_HEIGHT - 1}
                fill={fieldHighlightBg}
              />
            )}
            <text
              x={x + 6}
              y={fy + FIELD_ROW_HEIGHT - 4}
              fontSize={10}
              fill={fieldText}
              fontWeight={f.isUsedInRelation ? 'bold' : 'normal'}
            >
              {f.name}
            </text>
          </g>
        );
      })}

      {/* BT-Label am Boden, wenn Name ≠ BaseTable */}
      {to.baseTable && to.baseTable.name !== to.name && (
        <text
          x={x + width / 2}
          y={y + height - 3}
          fontSize={8}
          textAnchor="middle"
          fill={dimmed ? '#aaa' : '#666'}
          fontStyle="italic"
        >
          {to.baseTable.name}
        </text>
      )}
    </g>
  );
});

/**
 * Selektions-Ring als Overlay — wird *nach* allen TOs in der SVG gerendert,
 * damit er auch über (halb-)verdeckte TOs hinweg sichtbar bleibt. Das ist die
 * SVG-Entsprechung eines hohen z-Index: Render-Reihenfolge bestimmt Stacking.
 */
export const SelectionRing = memo(function SelectionRing({ to }: { to: TableOccurrence }) {
  const layout = layoutTOBox(to);
  const w = SELECTED_RING_WIDTH;
  const offset = w / 2;
  return (
    <rect
      x={layout.x - offset}
      y={layout.y - offset}
      width={layout.width + w}
      height={layout.height + w}
      rx={w}
      ry={w}
      fill="none"
      stroke={SELECTED_RING_COLOR}
      strokeWidth={w}
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
});

import { memo } from 'react';
import type { TableOccurrence } from '../hooks/useRelationshipGraph';
import { layoutTOBox, FIELD_ROW_HEIGHT, HEADER_HEIGHT } from './relationshipGraphLayout';
import { useGraphPalette } from './relationshipGraphTheme';

export type TOBoxDisplayMode = 'normal' | 'highlight' | 'dim';

type Props = {
  to: TableOccurrence;
  onClick?: (uuid: string) => void;
  displayMode?: TOBoxDisplayMode;
  isSelected?: boolean;
};

const HIGHLIGHT_RING_WIDTH = 6;
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
  const palette = useGraphPalette();
  const layout = layoutTOBox(to);
  const { x, y, width, height } = layout;

  const dimmed = displayMode === 'dim';
  const highlighted = displayMode === 'highlight';

  const headerFill = dimmed
    ? palette.dimmedHeader
    : (to.color ? `rgb(${to.color.r}, ${to.color.g}, ${to.color.b})` : palette.headerNeutral);
  const headerText = dimmed
    ? palette.dimmedHeaderText
    : (to.color ? readableTextColor(to.color.r, to.color.g, to.color.b) : palette.headerTextDefault);
  const stroke = dimmed ? palette.dimmedStroke : palette.boxStroke;
  const fieldText = dimmed ? palette.dimmedFieldText : palette.fieldText;
  const fieldHighlightBg = dimmed ? palette.dimmedFieldBg : palette.fieldHighlightBg;
  const isExternal = to.type === 'External';

  // Match-Ring (orange) wird hier inline mit der TO gezeichnet.
  // Der Selection-Ring (rot) wird stattdessen als globaler Overlay
  // *nach* allen TOs gezeichnet (siehe <SelectionRing /> im RelationshipGraph),
  // damit er auch über (halb-)verdeckte TOs hinweg sichtbar bleibt.
  const showHighlightRing = highlighted && !isSelected;
  const ringColor = showHighlightRing ? palette.highlightRing : null;
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
        fill={palette.boxBody}
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
          fill={dimmed ? palette.baseTableLabelDimmed : palette.baseTableLabel}
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
  const palette = useGraphPalette();
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
      stroke={palette.selectionRing}
      strokeWidth={w}
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
});

import { memo } from 'react';
import type { Relationship, TableOccurrence } from '../hooks/useRelationshipGraph';
import { anchorX, fieldAnchorY, pickAnchorSide } from './relationshipGraphLayout';
import { useGraphPalette, type GraphPalette } from './relationshipGraphTheme';

type Props = {
  relationship: Relationship;
  leftTO: TableOccurrence;
  rightTO: TableOccurrence;
  predicateIndex: number;
  predicateCount: number;
  isDimmed?: boolean;
};

function CascadeMarker({ x, y, deltaX, cascadeCreate, cascadeDelete, dimmed, palette }: {
  x: number;
  y: number;
  deltaX: number;
  cascadeCreate: boolean;
  cascadeDelete: boolean;
  dimmed: boolean;
  palette: GraphPalette;
}) {
  if (!cascadeCreate && !cascadeDelete) return null;
  const mx = x + deltaX;
  return (
    <g>
      {cascadeCreate && (
        <text
          x={mx}
          y={y - 3}
          fontSize={11}
          fontWeight="bold"
          fill={dimmed ? palette.cascadeCreateDim : palette.cascadeCreate}
          textAnchor="middle"
        >+</text>
      )}
      {cascadeDelete && (
        <text
          x={mx}
          y={y + 9}
          fontSize={11}
          fill={dimmed ? palette.cascadeDeleteDim : palette.cascadeDelete}
          textAnchor="middle"
        >⌫</text>
      )}
    </g>
  );
}

export const JoinLine = memo(function JoinLine({
  relationship,
  leftTO,
  rightTO,
  predicateIndex,
  predicateCount,
  isDimmed = false,
}: Props) {
  const palette = useGraphPalette();
  const pred = relationship.predicates[predicateIndex];
  if (!pred) return null;

  const leftSide = pickAnchorSide(leftTO, rightTO);
  const rightSide = pickAnchorSide(rightTO, leftTO);

  const lx = anchorX(leftTO, leftSide);
  const rx = anchorX(rightTO, rightSide);
  const ly = fieldAnchorY(leftTO, pred.leftFieldUuid);
  const ry = fieldAnchorY(rightTO, pred.rightFieldUuid);

  // Mehrere Predicates: vertikale Verschiebung der Operator-Beschriftung gestaffelt.
  const operatorYOffset = (predicateIndex - (predicateCount - 1) / 2) * 12;

  const midX = (lx + rx) / 2;
  const midY = (ly + ry) / 2 + operatorYOffset;

  // Anker-Marker zeigen leicht in Richtung Linie.
  const lDelta = leftSide === 'right' ? 8 : -8;
  const rDelta = rightSide === 'right' ? 8 : -8;

  const lineStroke = isDimmed ? palette.joinDimStroke : palette.joinStroke;
  const operatorBoxStroke = isDimmed ? palette.joinDimStroke : palette.joinStroke;
  const operatorTextFill = isDimmed ? palette.joinDimText : palette.joinOperatorText;

  return (
    <g className="join-line">
      <line
        x1={lx}
        y1={ly}
        x2={rx}
        y2={ry}
        stroke={lineStroke}
        strokeWidth={1}
      />
      {/* Operator-Symbol mittig, hinterlegt zum Lesen */}
      <rect
        x={midX - 9}
        y={midY - 8}
        width={18}
        height={14}
        fill={palette.joinOperatorBg}
        stroke={operatorBoxStroke}
        strokeWidth={0.5}
        rx={2}
      />
      <text
        x={midX}
        y={midY + 3}
        fontSize={11}
        textAnchor="middle"
        fill={operatorTextFill}
        fontWeight="bold"
      >
        {pred.symbol}
      </text>

      <CascadeMarker
        x={lx}
        y={ly}
        deltaX={lDelta}
        cascadeCreate={relationship.left.cascadeCreate}
        cascadeDelete={relationship.left.cascadeDelete}
        dimmed={isDimmed}
        palette={palette}
      />
      <CascadeMarker
        x={rx}
        y={ry}
        deltaX={rDelta}
        cascadeCreate={relationship.right.cascadeCreate}
        cascadeDelete={relationship.right.cascadeDelete}
        dimmed={isDimmed}
        palette={palette}
      />
    </g>
  );
});

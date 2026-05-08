import type { TableOccurrence } from '../hooks/useRelationshipGraph';

export const HEADER_HEIGHT = 18;
export const FIELD_ROW_HEIGHT = 14;
export const FOOTER_PAD = 4;

/**
 * Layoutet eine TO-Box.
 *
 * Anzeigestrategie (vereinfacht gegenüber FileMaker, näher am Original):
 *  - Collapse: nur Header (keine Felder)
 *  - Full / Related: alle in Beziehungen genutzten Felder
 *
 * Die Höhe wird strikt aus der Feldanzahl berechnet — die FileMaker-
 * Box_Height bzw. Coord_Bottom-Coord_Top wird nicht verwendet, weil sie
 * für Full-Boxen oft viel zu groß bzw. mit Scrollausschnitt definiert
 * ist. Die X/Y-Position bleibt aber 1:1 aus FileMaker erhalten.
 */
export function layoutTOBox(to: TableOccurrence) {
  const x = to.bounds.left ?? 0;
  const y = to.bounds.top ?? 0;
  const width = Math.max(60, (to.bounds.right ?? x + 100) - x);

  let height: number;
  if (to.view === 'Collapse' || to.fields.length === 0) {
    height = HEADER_HEIGHT + FOOTER_PAD;
  } else {
    height = HEADER_HEIGHT + to.fields.length * FIELD_ROW_HEIGHT + FOOTER_PAD;
  }

  return { x, y, width, height };
}

/**
 * Berechnet den Y-Anker für ein Feld in einer TO-Box.
 * Bei Collapse → mittig auf dem Header.
 */
export function fieldAnchorY(to: TableOccurrence, fieldUuid: string): number {
  const { y, height } = layoutTOBox(to);

  if (to.view === 'Collapse' || to.fields.length === 0) {
    return y + height / 2;
  }

  const idx = to.fields.findIndex(f => f.uuid === fieldUuid);
  if (idx < 0) {
    return y + height / 2;
  }
  return y + HEADER_HEIGHT + idx * FIELD_ROW_HEIGHT + FIELD_ROW_HEIGHT / 2;
}

/**
 * Bestimmt, an welcher Seite (links/rechts) der Anker einer TO sitzen soll —
 * heuristisch: an der Seite, die der Gegenseite näher liegt.
 */
export function pickAnchorSide(
  to: TableOccurrence,
  other: TableOccurrence
): 'left' | 'right' {
  const layout = layoutTOBox(to);
  const otherLayout = layoutTOBox(other);
  const otherCenter = otherLayout.x + otherLayout.width / 2;
  const thisCenter = layout.x + layout.width / 2;
  return otherCenter > thisCenter ? 'right' : 'left';
}

export function anchorX(to: TableOccurrence, side: 'left' | 'right'): number {
  const { x, width } = layoutTOBox(to);
  return side === 'left' ? x : x + width;
}

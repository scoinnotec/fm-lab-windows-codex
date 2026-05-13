// Folding-Berechnung für Scripts. Drei orthogonale Quellen:
//   a) Kontrollstrukturen (Stack-basiert: If/Loop/Open Transaction)
//   b) Multiline-Calcs (Token-Text enthält \r oder \n)
//   c) Kommentar-Blöcke (≥2 aufeinanderfolgende kind=comment)

import type { ScriptLineToken, FoldRange } from './types';
import { collapseStepParameterBreaks } from './normalizeText';

const OPEN_NAMES = new Set<string>(['If', 'Loop', 'Open Transaction']);

function isCloseFor(stepName: string | undefined, openName: string): boolean {
  if (!stepName) return false;
  if (openName === 'If') return stepName === 'End If';
  if (openName === 'Loop') return stepName === 'End Loop';
  if (openName === 'Open Transaction')
    return stepName === 'Commit Transaction' || stepName === 'Revert Transaction';
  return false;
}

/**
 * Eine Zeile gilt als „mehrzeilig" für das Folding-UI, wenn sie nach
 * Normalisierung der bloßen Step-Parameter-Umbrüche immer noch \r/\n enthält.
 * Damit verschwindet der Caret bei Steps wie „Commit Records/Requests\r[ No dialog ]"
 * (visuell einzeilig, also nichts zum Klappen).
 */
function isMultiline(text?: string): boolean {
  if (!text) return false;
  return /[\r\n]/.test(collapseStepParameterBreaks(text));
}

export function computeFoldRanges(lines: ScriptLineToken[]): FoldRange[] {
  const ranges: FoldRange[] = [];

  // a) Kontrollstrukturen — Stack-basiert
  const stack: Array<{ openName: string; startLine: number }> = [];
  for (const ln of lines) {
    if (ln.kind !== 'step' || !ln.stepName) continue;
    if (OPEN_NAMES.has(ln.stepName)) {
      stack.push({ openName: ln.stepName, startLine: ln.line });
      continue;
    }
    // Close suchen vom Top
    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (isCloseFor(ln.stepName, top.openName)) {
        stack.pop();
        if (ln.line - top.startLine >= 1) {
          const kind: FoldRange['kind'] =
            top.openName === 'If' ? 'if' :
            top.openName === 'Loop' ? 'loop' : 'transaction';
          ranges.push({ startLine: top.startLine, endLine: ln.line, kind });
        }
      }
    }
  }

  // b) Multiline-Calcs (eine FM-Zeile mit eingebetteten \r/\n)
  for (const ln of lines) {
    if (isMultiline(ln.text)) {
      ranges.push({ startLine: ln.line, endLine: ln.line, kind: 'multiline' });
    }
  }

  // c) Kommentar-Blöcke (aufeinanderfolgende comment-Zeilen, ≥2)
  let blockStart: number | null = null;
  let blockEnd: number | null = null;
  let prevLine: number | null = null;
  const finishBlock = () => {
    if (blockStart !== null && blockEnd !== null && blockEnd > blockStart) {
      ranges.push({ startLine: blockStart, endLine: blockEnd, kind: 'comment-block' });
    }
    blockStart = null;
    blockEnd = null;
  };
  for (const ln of lines) {
    if (ln.kind === 'comment') {
      if (blockStart === null) {
        blockStart = ln.line;
        blockEnd = ln.line;
      } else if (prevLine !== null && ln.line === prevLine + 1) {
        blockEnd = ln.line;
      } else {
        finishBlock();
        blockStart = ln.line;
        blockEnd = ln.line;
      }
      prevLine = ln.line;
    } else {
      // Empty-Zeilen unterbrechen den Comment-Block ebenfalls
      finishBlock();
      prevLine = ln.line;
    }
  }
  finishBlock();

  return ranges;
}

/**
 * Aus aktuell gefolderten Start-Line-Numbers die Menge aller verborgenen Zeilen
 * berechnen.
 *
 *   - if/loop/transaction: Zeilen strikt zwischen Start und End (End-Zeile bleibt sichtbar,
 *     da End If / End Loop semantisch zur Klammer gehört)
 *   - comment-block: Zeilen Start+1 bis End **inklusive** (Comment-Block hat keine
 *     End-Zeile, der gesamte Folge-Block soll verschwinden)
 *   - multiline: keine Zeilen werden ausgeblendet — die Sub-Zeilen liegen
 *     innerhalb desselben Tokens und werden im Renderer gehandelt
 */
export function computeHiddenLines(
  ranges: FoldRange[],
  foldedStarts: Set<number>,
): Set<number> {
  const hidden = new Set<number>();
  for (const r of ranges) {
    if (!foldedStarts.has(r.startLine)) continue;
    if (r.kind === 'multiline') continue;
    const inclusive = r.kind === 'comment-block';
    const limit = inclusive ? r.endLine + 1 : r.endLine;
    for (let l = r.startLine + 1; l < limit; l++) {
      hidden.add(l);
    }
  }
  return hidden;
}

/**
 * Lookup-Map: für eine Zeile alle FoldRanges, die hier starten.
 * Mehrere Ranges können dieselbe Start-Line haben (z.B. Kontrollstruktur +
 * Multiline-Calc-Step).
 */
export function buildFoldStartIndex(ranges: FoldRange[]): Map<number, FoldRange[]> {
  const map = new Map<number, FoldRange[]>();
  for (const r of ranges) {
    const arr = map.get(r.startLine);
    if (arr) arr.push(r);
    else map.set(r.startLine, [r]);
  }
  return map;
}

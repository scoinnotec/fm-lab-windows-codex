// Margin-Bar-Klassifizierung pro Zeile — identische Logik wie im VS-Code-Plugin
// (siehe fm-lab-vscode/src/linter/decoration/marginBarManager.ts).
//
//   - 'comment'   = grau   → Kommentare + deaktivierte Zeilen
//   - 'metadata'  = dunkelrot → Header (Top-of-Script-Comments) und Exit Script mit Result
//   - 'executive' = dunkelblau → alle anderen Step-Zeilen
//   - null        → empty-Zeilen bekommen keine Margin-Bar
//
// Das Mapping arbeitet auf der gesamten Zeilen-Liste, weil "Header" relativ
// zur ersten Step-Zeile bestimmt wird. Daher ist die API ein Lookup, der
// einmalig vorberechnet wird.

import type { ScriptLineToken, MarginRole } from './types';

const EXIT_SCRIPT_RESULT_RE = /Exit Script\s*\[\s*([^\]]*)\]/;

function hasExitScriptResult(text: string | undefined): boolean {
  if (!text) return false;
  const m = EXIT_SCRIPT_RESULT_RE.exec(text);
  return !!m && m[1].trim().length > 0;
}

/**
 * Vorberechnete Lookup-Map: line.line → MarginRole | null.
 * Header-Status wird einmalig durch Iteration ermittelt.
 */
export function computeMarginRoleMap(lines: ScriptLineToken[]): Map<number, MarginRole | null> {
  const out = new Map<number, MarginRole | null>();
  let firstStepSeen = false;

  for (const ln of lines) {
    let role: MarginRole | null = null;

    if (ln.kind === 'empty') {
      role = null;
    } else if (!ln.enabled) {
      // Deaktivierte Zeilen verhalten sich wie Kommentare.
      role = 'comment';
    } else if (ln.kind === 'comment') {
      // Header (Top-of-Script-Kommentare bis zum ersten Step) → metadata
      role = firstStepSeen ? 'comment' : 'metadata';
    } else {
      // Step-Zeile
      if (ln.stepName === 'Exit Script' && hasExitScriptResult(ln.text)) {
        role = 'metadata';
      } else {
        role = 'executive';
      }
    }

    if (ln.kind === 'step') firstStepSeen = true;

    out.set(ln.line, role);
  }

  return out;
}

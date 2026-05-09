import { useEffect, useRef } from 'react';

/**
 * Handler returns `true` wenn er die Aktion ausgeführt hat (ESC ist konsumiert,
 * weitere Stages nicht mehr berücksichtigt). Returns `false` wenn die Stage
 * inaktiv war und die nächste Stage probieren soll.
 */
export type EscapeHandler = () => boolean;

/**
 * Mehrstufige ESC-Logik à la Raycast: registriert einen document-weiten
 * keydown-Listener und iteriert die übergebenen Handlers in Reihenfolge.
 * Die erste Stage, die `true` zurückgibt, hat das Event konsumiert; weitere
 * Stages werden nicht mehr aufgerufen.
 *
 * Konvention für Stages (Top-down):
 *   1. Modal/Tooltip schließen
 *   2. Suchfeld leeren
 *   3. Filter / Selektion zurücksetzen
 *   4. Zurück-Navigation (Fallback)
 *
 * Hinweis: Lokale onKeyDown-Handler in Inputs sollten ESC NICHT mehr selbst
 * abfangen, sondern den globalen Stack durchlaufen lassen — sonst wird Stage 2
 * doppelt ausgeführt oder die Stages 3/4 sind unerreichbar.
 */
export function useEscapeStack(handlers: EscapeHandler[]): void {
  // Aktuelle Handler-Liste in einem Ref halten, damit der document-Listener
  // sie immer aktuell sieht, ohne bei jedem State-Wechsel neu attached zu
  // werden. Andernfalls würde der Listener auf einen stale Closure greifen.
  const handlersRef = useRef<EscapeHandler[]>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;

      // Wenn ein Modal/Dialog mit eigenem ESC-Handler bereits konsumiert hat
      // (z.B. via stopPropagation), kommt das Event hier nicht an — gewollt.
      for (const handler of handlersRef.current) {
        if (handler()) {
          e.preventDefault();
          break;
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}

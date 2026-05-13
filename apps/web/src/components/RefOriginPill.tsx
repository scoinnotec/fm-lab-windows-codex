import React from 'react';
import type { RefOriginState } from '../hooks/useRefOrigin';

interface RefOriginPillProps {
  state: RefOriginState;
  /** Roher Wert des `?ref=`-Parameters (für Anzeige im unresolved-Fall). */
  rawRef: string;
  /** Vom Aufrufer bereitgestellter Dismiss-Handler — entfernt `ref` aus der URL. */
  onDismiss: () => void;
  /**
   * Optional: tatsächliche Treffer-Anzahl im aktiven View. Wenn unbekannt,
   * fällt die Pill auf `state.matchCount` (Server-Lookup) zurück.
   */
  liveMatchCount?: number;
}

/**
 * Origin-Indikator-Pill für Cross-Reference Highlight (PRD §7.1).
 *
 * Rendert oberhalb der Tab-Leiste eine schmale Zeile:
 *   ▶ Referenz: <Type> · <Name>    [✕]
 *     <N> Treffer hervorgehoben
 *
 * Klick auf den Pfeil führt zum Origin-Detail-View; Klick auf das X
 * entfernt den `ref`-Parameter aus der URL.
 */
export const RefOriginPill: React.FC<RefOriginPillProps> = ({
  state,
  rawRef,
  onDismiss,
  liveMatchCount,
}) => {
  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <div className="ref-pill ref-pill--loading" role="status" aria-live="polite">
        <span className="ref-pill-label">Referenz wird aufgelöst…</span>
        <button
          type="button"
          className="ref-pill-dismiss"
          onClick={onDismiss}
          aria-label="Referenz-Highlight entfernen"
          title="Referenz-Highlight entfernen"
        >
          ✕
        </button>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="ref-pill ref-pill--error" role="alert">
        <span className="ref-pill-label">
          Referenz konnte nicht aufgelöst werden: {state.error}
        </span>
        <button
          type="button"
          className="ref-pill-dismiss"
          onClick={onDismiss}
          aria-label="Referenz-Highlight entfernen"
          title="Referenz-Highlight entfernen"
        >
          ✕
        </button>
      </div>
    );
  }

  if (state.status === 'unresolved' || !state.origin) {
    return (
      <div className="ref-pill ref-pill--unresolved" role="status">
        <span className="ref-pill-icon" aria-hidden="true">⚠</span>
        <span className="ref-pill-label">
          Referenz nicht gefunden: <code>{rawRef}</code>
        </span>
        <button
          type="button"
          className="ref-pill-dismiss"
          onClick={onDismiss}
          aria-label="Referenz-Highlight entfernen"
          title="Referenz-Highlight entfernen"
        >
          ✕
        </button>
      </div>
    );
  }

  const count = liveMatchCount ?? state.matchCount;
  // Ohne Treffer in der aktuellen Ansicht ist die Pill nur Lärm — der `?ref=`
  // Parameter bleibt erhalten (Tab-Wechsel kann wieder Treffer ergeben), aber
  // der visuelle Indikator wird unterdrückt. ESC räumt den Param weiterhin auf.
  if (count === 0) return null;
  const o = state.origin;
  return (
    <div className="ref-pill ref-pill--resolved" role="status" aria-live="polite">
      <span className="ref-pill-label">
        Referenz: <span className="ref-pill-type">{o.type}</span>
        <span className="ref-pill-sep"> · </span>
        <span className="ref-pill-name">{o.name}</span>
        {o.file && (
          <span className="ref-pill-file"> ({o.file})</span>
        )}
      </span>
      <span className="ref-pill-count">
        {`${count} ${count === 1 ? 'Treffer' : 'Treffer'} hervorgehoben`}
      </span>
      <button
        type="button"
        className="ref-pill-dismiss"
        onClick={onDismiss}
        aria-label="Referenz-Highlight entfernen"
        title="Referenz-Highlight entfernen (Esc)"
      >
        ✕
      </button>
    </div>
  );
};

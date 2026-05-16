import React, { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { ScriptLineToken } from '../script/types';
import { buildObjectPath } from '../lib/navigation';
import { getUiLanguage, tx } from '../lib/uiLanguage';

interface ScriptStepSpanProps {
  /** Stepname-Text wie er im Script-Text erscheint (z.B. "Adjust Window"). */
  text: string;
  /** Vollständige Script-Line (für Step-ID und Reference-DB-Felder). */
  line: ScriptLineToken;
}

/**
 * Renderer für den Step-Namen am Anfang einer Script-Zeile mit Reference-DB-
 * Anreicherung (PRD §5.1). Hover zeigt einen Popover mit lokalisiertem Namen,
 * Beschreibung und Link zur lokalen Claris-Hilfe.
 *
 * Tooltip-Strategie (analog FunctionTokenSpan):
 *   - enriched (stepDisplayName vorhanden) → eigener Popover, KEIN `title`-Attribut
 *   - nicht enriched → Browser-Tooltip als Fallback mit dem Step-Text
 */
export const ScriptStepSpan: React.FC<ScriptStepSpanProps> = ({ text, line }) => {
  const [open, setOpen] = useState(false);
  const hoverTimer = useRef<number | null>(null);
  const isEnriched = !!line.stepDisplayName;
  const { uuid: currentScriptUuid } = useParams<{ uuid: string }>();
  const language = getUiLanguage();

  // Cross-Navigation: Klick auf den Step-Namen führt zur ScriptStepType-
  // Detail-Seite (PRD prd_pseudo_object_types_filter.md §1.1). Hover-Popover
  // mit Reference-DB-Doku bleibt unverändert; der Link greift erst beim Klick.
  const stepTypePath = line.stepTypeUuid
    ? buildObjectPath(line.stepTypeUuid, currentScriptUuid ?? null)
    : null;

  const startHover = () => {
    if (!isEnriched) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setOpen(true), 250);
  };

  const cancelHover = () => {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
  }, []);

  const apiBase = (import.meta.env.VITE_API_URL || 'http://localhost:3003').replace(/\/+$/, '');
  const helpHref = line.stepLocalHelpUrl
    ? `${apiBase}${line.stepLocalHelpUrl}`
    : line.stepHelpUrl;

  // Inner: Text-Knoten (entweder klickbarer Link oder reiner Text)
  const inner = stepTypePath ? (
    <Link
      to={stepTypePath}
      className="fm-stepname-link"
      title={isEnriched
        ? tx(language, `Zu Pseudo-Objekt navigieren: ScriptStepType '${line.stepName ?? text}'`, `Navigate to pseudo object: ScriptStepType '${line.stepName ?? text}'`)
        : tx(language, `${text} (zur Pseudo-Objekt-Detailseite)`, `${text} (to pseudo object detail page)`)}
      // Klick auf den Link soll das Popover sofort schließen.
      onClick={() => setOpen(false)}
    >
      {text}
    </Link>
  ) : (
    <>{text}</>
  );

  return (
    <span
      className="fm-stepname"
      data-step-id={line.stepId}
      title={isEnriched || stepTypePath ? undefined : text}
      onMouseEnter={startHover}
      onMouseLeave={cancelHover}
    >
      {inner}
      {open && isEnriched && (
        <span
          className="fm-stepname-popover"
          role="tooltip"
          onMouseEnter={() => {
            if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
          }}
          onMouseLeave={cancelHover}
        >
          <span className="fm-stepname-popover-header">
            <strong>{line.stepDisplayName}</strong>
            {line.stepName && line.stepName !== line.stepDisplayName && (
              <span className="fm-stepname-popover-canonical"> · {line.stepName}</span>
            )}
          </span>
          {line.stepDescription && (
            <span className="fm-stepname-popover-purpose">{line.stepDescription}</span>
          )}
          {helpHref && (
            <a
              className="fm-stepname-popover-link"
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              {line.stepLocalHelpUrl
                ? tx(language, 'Lokale Hilfe öffnen ↗', 'Open local help ↗')
                : tx(language, 'Claris-Hilfe öffnen ↗', 'Open Claris help ↗')}
            </a>
          )}
        </span>
      )}
    </span>
  );
};

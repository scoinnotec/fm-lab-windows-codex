import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useLayoutData } from '../hooks/useLayoutData';
import { LayoutCanvas } from './LayoutCanvas';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { ScriptDetail } from './ScriptDetail';
import { CustomFunctionDetail } from './CustomFunctionDetail';
import { FieldDetail } from './FieldDetail';
import { getUiLanguage, tx } from '../lib/uiLanguage';
import '../views/LayoutView.css';

interface ObjectDetailProps {
  uuid: string;
  objectType: string;
  /**
   * UUIDs zum Hervorheben (Cross-Reference Highlight, PRD §7.2).
   * Wird je nach Ziel-View interpretiert:
   *  - LayoutCanvas:        matchUuids
   *  - ScriptViewer:        highlightRefUuids (Token-Match)
   *  - CustomFunctionViewer: highlightRefUuids
   */
  highlightUuids?: Set<string>;
  /**
   * Origin-Name für Substring-Highlight in Content-Views (GenericObjectDetail).
   */
  highlightText?: string | null;
  /**
   * Wird bei explizitem User-Eingriff (Suche, Typ-Filter) im LayoutCanvas
   * gefeuert, um den ref-Param aus der URL zu entfernen.
   */
  onClearRef?: () => void;
}

function detailHeading(objectType: string, language = getUiLanguage()) {
  const labels: Record<string, { de: string; en: string }> = {
    Script: { de: 'Script-Text', en: 'Script text' },
    Layout: { de: 'Layout-Darstellung', en: 'Layout view' },
    Field: { de: 'Feld-Details', en: 'Field details' },
    BaseTable: { de: 'Tabellen-Details', en: 'Table details' },
    CustomFunction: { de: 'Funktions-Details', en: 'Function details' },
    ValueList: { de: 'Wertelisten-Details', en: 'Value list details' },
  };
  const label = labels[objectType];
  return label ? tx(language, label.de, label.en) : tx(language, 'Details', 'Details');
}

/**
 * Embedded Layout viewer used inside DetailView. Lädt Layout-Daten und rendert
 * die interaktive LayoutCanvas — gleiche Komponente wie /layout/:uuid Vollbild,
 * nur in einem festhöhigen Container mit Vollbild-Link.
 */
const EmbeddedLayoutView: React.FC<{
  uuid: string;
  highlightUuids?: Set<string>;
  onClearRef?: () => void;
}> = ({ uuid, highlightUuids, onClearRef }) => {
  const language = getUiLanguage();
  const { data, loading, error } = useLayoutData(uuid);
  if (loading) return <LoadingSpinner message={tx(language, 'Layout wird geladen...', 'Loading layout...')} />;
  if (error) return <ErrorMessage message={error} />;
  if (!data || data.objects.length === 0) {
    return <div className="no-references">{tx(language, 'Dieses Layout enthält keine Objekte.', 'This layout contains no objects.')}</div>;
  }
  return (
    <div className="object-detail" aria-label={tx(language, 'Layout-Darstellung', 'Layout view')}>
      <div className="layout-detail-header">
        <h2 className="type-detail-heading">{tx(language, 'Layout-Darstellung', 'Layout view')}</h2>
        <Link
          to={`/layout/${uuid}`}
          className="layout-detail-fullscreen"
          title={tx(language, 'Layout in Vollbild-Ansicht öffnen', 'Open layout in fullscreen view')}
        >
          {tx(language, 'Vollbild ↗', 'Fullscreen ↗')}
        </Link>
      </div>
      <div className="layout-detail-canvas">
        <LayoutCanvas
          data={data}
          externalMatchUuids={highlightUuids}
          onClearRef={onClearRef}
        />
      </div>
    </div>
  );
};

/**
 * Highlight-Substring rendern: zerlegt Text an allen Vorkommen von `needle`
 * und wrappt diese in <mark>. Case-insensitive. Bei leerem needle: Text 1:1.
 */
function highlightSubstring(text: string, needle: string | null | undefined): React.ReactNode {
  if (!needle || needle.length < 2) return text;
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: React.ReactNode[] = [];
  let start = 0;
  let idx = lowerText.indexOf(lowerNeedle, start);
  while (idx !== -1) {
    if (idx > start) out.push(text.slice(start, idx));
    out.push(
      <mark key={`m-${idx}`} className="fm-content-highlight">
        {text.slice(idx, idx + needle.length)}
      </mark>
    );
    start = idx + needle.length;
    idx = lowerText.indexOf(lowerNeedle, start);
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/**
 * Generic non-Layout detail view: lädt content via /api/get-details und rendert
 * als formatierten Text-Block. Eigene Komponente, damit ihre Hooks in einer
 * eigenen Aufruf-Reihenfolge stehen und nicht mit dem Layout-Pfad kollidieren.
 *
 * `highlightText` legt einen Substring-Highlight über alle Zeilen.
 */
const GenericObjectDetail: React.FC<ObjectDetailProps> = ({ uuid, objectType, highlightText }) => {
  const language = getUiLanguage();
  const { data, loading, error, retry } = useObjectDetails(uuid);

  const renderedLines = useMemo(() => {
    if (!data) return null;
    return data.map((row, index) => (
      <span key={index} className="content-line">
        {highlightSubstring(String(row.content), highlightText)}
        {'\n'}
      </span>
    ));
  }, [data, highlightText]);

  if (loading) return <LoadingSpinner message={tx(language, 'Details werden geladen...', 'Loading details...')} />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) {
    return <div className="no-references">{tx(language, 'Keine Details verfügbar', 'No details available')}</div>;
  }

  const heading = detailHeading(objectType, language);
  const countLabel = objectType === 'Script' ? ` (${data.length} ${tx(language, 'Schritte', 'steps')})` : '';

  return (
    <div className="object-detail" aria-label={heading}>
      <h2 className="type-detail-heading">{heading}{countLabel}</h2>
      <pre className="content-text">
        <code>{renderedLines}</code>
      </pre>
    </div>
  );
};

/**
 * Unified Object Detail Component.
 * - Layouts: interactive LayoutCanvas (Hover, Suche, Filter, Cross-Nav)
 * - Other types: formatted text in a code block
 */
export const ObjectDetail: React.FC<ObjectDetailProps> = ({
  uuid,
  objectType,
  highlightUuids,
  highlightText,
  onClearRef,
}) => {
  if (objectType === 'Layout') {
    return (
      <EmbeddedLayoutView
        uuid={uuid}
        highlightUuids={highlightUuids}
        onClearRef={onClearRef}
      />
    );
  }
  if (objectType === 'Script') {
    return <ScriptDetail uuid={uuid} highlightRefUuids={highlightUuids} />;
  }
  if (objectType === 'CustomFunction') {
    return <CustomFunctionDetail uuid={uuid} highlightRefUuids={highlightUuids} />;
  }
  if (objectType === 'Field') {
    return <FieldDetail uuid={uuid} highlightRefUuids={highlightUuids} />;
  }
  return (
    <GenericObjectDetail
      uuid={uuid}
      objectType={objectType}
      highlightText={highlightText}
    />
  );
};

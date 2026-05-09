import React from 'react';
import { Link } from 'react-router-dom';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { useLayoutData } from '../hooks/useLayoutData';
import { LayoutCanvas } from './LayoutCanvas';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import '../views/LayoutView.css';

interface ObjectDetailProps {
  uuid: string;
  objectType: string;
}

const DETAIL_HEADINGS: Record<string, string> = {
  'Script': 'Script-Text',
  'Layout': 'Layout-Darstellung',
  'Field': 'Feld-Details',
  'BaseTable': 'Tabellen-Details',
  'CustomFunction': 'Funktions-Details',
  'ValueList': 'Wertelisten-Details',
};

/**
 * Embedded Layout viewer used inside DetailView. Lädt Layout-Daten und rendert
 * die interaktive LayoutCanvas — gleiche Komponente wie /layout/:uuid Vollbild,
 * nur in einem festhöhigen Container mit Vollbild-Link.
 */
const EmbeddedLayoutView: React.FC<{ uuid: string }> = ({ uuid }) => {
  const { data, loading, error } = useLayoutData(uuid);
  if (loading) return <LoadingSpinner message="Layout wird geladen..." />;
  if (error) return <ErrorMessage message={error} />;
  if (!data || data.objects.length === 0) {
    return <div className="no-references">Dieses Layout enthält keine Objekte.</div>;
  }
  return (
    <div className="object-detail" aria-label="Layout-Darstellung">
      <div className="layout-detail-header">
        <h2 className="type-detail-heading">Layout-Darstellung</h2>
        <Link
          to={`/layout/${uuid}`}
          className="layout-detail-fullscreen"
          title="Layout in Vollbild-Ansicht öffnen"
        >
          Vollbild ↗
        </Link>
      </div>
      <div className="layout-detail-canvas">
        <LayoutCanvas data={data} />
      </div>
    </div>
  );
};

/**
 * Generic non-Layout detail view: lädt content via /api/get-details und rendert
 * als formatierten Text-Block. Eigene Komponente, damit ihre Hooks in einer
 * eigenen Aufruf-Reihenfolge stehen und nicht mit dem Layout-Pfad kollidieren.
 */
const GenericObjectDetail: React.FC<ObjectDetailProps> = ({ uuid, objectType }) => {
  const { data, loading, error, retry } = useObjectDetails(uuid);

  if (loading) return <LoadingSpinner message="Details werden geladen..." />;
  if (error) return <ErrorMessage message={error} onRetry={retry} />;
  if (!data || data.length === 0) {
    return <div className="no-references">Keine Details verfuegbar</div>;
  }

  const heading = DETAIL_HEADINGS[objectType] || 'Details';
  const countLabel = objectType === 'Script' ? ` (${data.length} Schritte)` : '';

  return (
    <div className="object-detail" aria-label={heading}>
      <h2 className="type-detail-heading">{heading}{countLabel}</h2>
      <pre className="content-text">
        <code>
          {data.map((row, index) => (
            <span key={index} className="content-line">
              {String(row.content)}{'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
};

/**
 * Unified Object Detail Component.
 * - Layouts: interactive LayoutCanvas (Hover, Suche, Filter, Cross-Nav)
 * - Other types: formatted text in a code block
 */
export const ObjectDetail: React.FC<ObjectDetailProps> = ({ uuid, objectType }) => {
  if (objectType === 'Layout') {
    return <EmbeddedLayoutView uuid={uuid} />;
  }
  return <GenericObjectDetail uuid={uuid} objectType={objectType} />;
};

import React from 'react';
import { useObjectDetails } from '../hooks/useObjectDetails';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';

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
 * Unified Object Detail Component.
 * Fetches type-specific details via /api/get-details and renders them.
 * - Layout objects are rendered as SVG
 * - All other types are rendered as formatted text in a code block
 */
export const ObjectDetail: React.FC<ObjectDetailProps> = ({ uuid, objectType }) => {
  const { data, loading, error, retry } = useObjectDetails(uuid);

  if (loading) {
    return <LoadingSpinner message="Details werden geladen..." />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={retry} />;
  }

  if (!data || data.length === 0) {
    return (
      <div className="no-references">
        Keine Details verfuegbar
      </div>
    );
  }

  const heading = DETAIL_HEADINGS[objectType] || 'Details';
  const isLayout = objectType === 'Layout';

  // Layout: join content lines into SVG markup and render as HTML
  if (isLayout) {
    const svgContent = data.map(row => String(row.content)).join('\n');
    return (
      <div className="object-detail" aria-label={heading}>
        <h2 className="type-detail-heading">{heading}</h2>
        <div
          className="layout-svg-container"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    );
  }

  // All other types: render as formatted text lines
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

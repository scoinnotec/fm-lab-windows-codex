import { useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLayoutData } from '../hooks/useLayoutData';
import { LayoutCanvas, type LayoutCanvasHandle } from '../components/LayoutCanvas';
import { ThemeToggle } from '../components/ThemeToggle';
import { useEscapeStack } from '../hooks/useEscapeStack';
import { getUiLanguage, tx } from '../lib/uiLanguage';
import './LayoutView.css';

export function LayoutView() {
  const language = getUiLanguage();
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const canvasRef = useRef<LayoutCanvasHandle>(null);
  const refParam = searchParams.get('ref');
  const externalMatchUuids = useMemo(
    () => (refParam ? new Set([refParam]) : null),
    [refParam]
  );
  const clearRef = () => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete('ref');
      return next;
    }, { replace: true });
  };

  const { data, loading, error } = useLayoutData(uuid);

  // Zurück: bevorzugt vorigen Eintrag, sonst Startseite (analog RelationshipGraphView).
  const handleBack = () => {
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  // Mehrstufige ESC-Logik:
  //   1. Tooltip → schließen
  //   2. Suche / Selektion → leeren (kombiniert wie bisher)
  //   3. Typ-Filter → leeren
  //   4. Zurück.
  useEscapeStack([
    () => {
      if (canvasRef.current?.hasTooltip()) {
        canvasRef.current.closeTooltip();
        return true;
      }
      return false;
    },
    () => {
      if (canvasRef.current?.hasSearchState()) {
        canvasRef.current.clearSearch();
        return true;
      }
      return false;
    },
    () => {
      if (canvasRef.current?.hasFilters()) {
        canvasRef.current.clearFilters();
        return true;
      }
      return false;
    },
    () => {
      handleBack();
      return true;
    },
  ]);

  return (
    <div className="layout-view">
      <header className="layout-view-header">
        <button
          type="button"
          onClick={handleBack}
          className="layout-view-back"
          title={tx(language, 'Zurück zur vorherigen Ansicht', 'Back to previous view')}
        >
          ← {tx(language, 'Zurück', 'Back')}
        </button>
        <h1>
          Layout
          {data && (
            <span className="layout-view-title">
              : {data.layoutName}
              {data.layoutToName && (
                <span className="layout-view-subtitle"> ({data.layoutToName})</span>
              )}
            </span>
          )}
        </h1>
        {data && <div className="layout-view-file">{data.fileName}</div>}
        <ThemeToggle />
      </header>

      <div className="layout-view-body">
        {loading && <div className="layout-view-empty">{tx(language, 'Lade Layout...', 'Loading layout...')}</div>}
        {error && <div className="layout-view-error">{tx(language, 'Fehler', 'Error')}: {error}</div>}
        {!loading && !error && data && data.objects.length === 0 && (
          <div className="layout-view-empty">{tx(language, 'Dieses Layout enthält keine Objekte.', 'This layout contains no objects.')}</div>
        )}
        {!loading && !error && data && data.objects.length > 0 && (
          <LayoutCanvas
            ref={canvasRef}
            data={data}
            externalMatchUuids={externalMatchUuids}
            onClearRef={clearRef}
          />
        )}
      </div>
    </div>
  );
}

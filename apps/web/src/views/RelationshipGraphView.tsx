import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { useRelationshipGraph } from '../hooks/useRelationshipGraph';
import { RelationshipGraph, type RelationshipGraphHandle } from '../components/RelationshipGraph';
import { ThemeToggle } from '../components/ThemeToggle';
import { useEscapeStack } from '../hooks/useEscapeStack';
import './RelationshipGraphView.css';

type FileInfo = { File_Name?: string };

export function RelationshipGraphView() {
  const { fileName } = useParams<{ fileName: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [files, setFiles] = useState<FileInfo[]>([]);
  const graphRef = useRef<RelationshipGraphHandle>(null);

  const preSelectUuid = searchParams.get('to');

  // Zurück zur vorherigen Ansicht im History-Stack. Falls die RG-View direkt
  // (Bookmark, externer Link) geöffnet wurde, gibt es keinen Vorgänger —
  // dann fallback auf den Start-Screen. React Router setzt key='default' nur
  // für den allerersten Eintrag der Session.
  const handleBack = () => {
    if (location.key !== 'default') {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  const { data, loading, error } = useRelationshipGraph(fileName ?? null);

  useEffect(() => {
    async function loadFiles() {
      try {
        const response = await api.info();
        if (response.success && response.data?.solution?.files) {
          setFiles(response.data.solution.files as FileInfo[]);
        }
      } catch (err) {
        console.error('Fehler beim Laden der Dateien:', err);
      }
    }
    loadFiles();
  }, []);

  const handleFileChange = (newFile: string) => {
    if (newFile) navigate(`/relationship-graph/${encodeURIComponent(newFile)}`);
  };

  const handlePreSelectExit = useCallback(() => {
    if (searchParams.has('to')) {
      const next = new URLSearchParams(searchParams);
      next.delete('to');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Mehrstufige ESC-Logik: Suche/Selektion/Vorauswahl leeren → Zurück.
  useEscapeStack([
    () => {
      if (graphRef.current?.hasSearchState()) {
        graphRef.current.clearSearch();
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
    <div className="relationship-graph-view">
      <header className="relationship-graph-header">
        <button
          type="button"
          onClick={handleBack}
          className="relationship-graph-back"
          title="Zurück zur vorherigen Ansicht"
        >
          ← Zurück
        </button>
        <h1>Beziehungsdiagramm</h1>
        <div className="relationship-graph-file-selector">
          <label htmlFor="rg-file">Datei:</label>
          <select
            id="rg-file"
            value={fileName ?? ''}
            onChange={e => handleFileChange(e.target.value)}
          >
            <option value="" disabled>Datei auswählen…</option>
            {files.map(f => (
              <option key={f.File_Name || ''} value={f.File_Name || ''}>{f.File_Name}</option>
            ))}
          </select>
        </div>
        <ThemeToggle />
      </header>

      <div className="relationship-graph-body">
        {!fileName && (
          <div className="relationship-graph-empty">
            Bitte eine Datei aus der Auswahl wählen.
          </div>
        )}

        {fileName && loading && (
          <div className="relationship-graph-empty">Lade Beziehungsdiagramm…</div>
        )}

        {fileName && error && (
          <div className="relationship-graph-error">
            Fehler: {error}
          </div>
        )}

        {fileName && data && data.tableOccurrences.length === 0 && (
          <div className="relationship-graph-empty">
            Diese Datei enthält keine Table Occurrences.
          </div>
        )}

        {fileName && data && data.tableOccurrences.length > 0 &&
          data.tableOccurrences.every(t => t.bounds.left == null) && (
            <div className="relationship-graph-empty">
              Beziehungsdiagramm noch nicht importiert. Bitte <code>convert-xml --batch</code> neu ausführen.
            </div>
          )}

        {fileName && data && data.tableOccurrences.length > 0 &&
          data.tableOccurrences.some(t => t.bounds.left != null) && (
            <RelationshipGraph
              ref={graphRef}
              data={data}
              initialPreSelectUuid={preSelectUuid}
              onPreSelectExit={handlePreSelectExit}
            />
          )}
      </div>
    </div>
  );
}

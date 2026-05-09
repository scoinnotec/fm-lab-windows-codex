import React, { useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useObjectDetail } from '../hooks/useObjectDetail';
import { ObjectHeader } from './ObjectHeader';
import { HierarchyTree, type HierarchyTreeHandle } from './HierarchyTree';
import { TypeDetail } from './TypeDetail';
import { DependencyGraph } from './DependencyGraph';
import { Breadcrumbs } from './Breadcrumbs';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { useEscapeStack } from '../hooks/useEscapeStack';
import { useUrlState } from '../hooks/useUrlState';
import type { BreadcrumbItem, DetailViewTab } from '../types';
import { DETAIL_TABS } from '../types';
import '../DetailView.css';

function displayObjectType(objectType: string, sourceTable?: string | null): string {
  if (objectType !== 'Folder') return objectType;
  switch (sourceTable) {
    case 'ScriptCatalog':          return 'ScriptFolder';
    case 'Layouts':                return 'LayoutFolder';
    case 'CustomFunctionsCatalog': return 'CustomFunctionFolder';
    default:                       return 'Folder';
  }
}

/**
 * Detail View Component
 * Displays full object details with sub-navigation tabs:
 * Details | Referenzen | Graph | Versions | Notes
 */
export const DetailView: React.FC = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { object, references, loading, error, retry } = useObjectDetail(uuid);
  const hierarchyRef = useRef<HierarchyTreeHandle>(null);

  // URL ist Single Source of Truth für Tab — beim Wechsel wird die URL
  // aktualisiert (replace), sodass beim Zurück-Navigieren der Tab erhalten
  // bleibt. Default 'detail' wird NICHT in die URL geschrieben (saubere URL).
  const validTabIds = useMemo(
    () => new Set(DETAIL_TABS.filter(t => t.enabled).map(t => t.id)),
    [],
  );
  const [tabParam, setTabParam] = useUrlState<string>('tab', 'detail');
  const activeTab: DetailViewTab = (validTabIds.has(tabParam as DetailViewTab) ? tabParam : 'detail') as DetailViewTab;
  const setActiveTab = useCallback((tab: DetailViewTab) => {
    setTabParam(tab);
  }, [setTabParam]);

  const handleBack = () => {
    // Falls die DetailView per Direkt-Link/Bookmark geöffnet wurde, gibt es
    // keinen Vorgänger im History-Stack — dann auf die Startseite gehen.
    if (location.key !== 'default') navigate(-1);
    else navigate('/');
  };

  // Mehrstufige ESC-Logik: Suchfeld leeren → Filter leeren → Zurück.
  // Stages werden in Reihenfolge geprüft, die erste aktive konsumiert ESC.
  useEscapeStack([
    () => {
      if (hierarchyRef.current?.hasQuery()) {
        hierarchyRef.current.clearQuery();
        return true;
      }
      return false;
    },
    () => {
      if (hierarchyRef.current?.hasFilters()) {
        hierarchyRef.current.clearFilters();
        return true;
      }
      return false;
    },
    () => {
      handleBack();
      return true;
    },
  ]);

  if (loading) {
    return (
      <div className="app">
        <LoadingSpinner message="Objekt-Details werden geladen..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <button onClick={handleBack} className="back-button" aria-label="Zurueck zur Suchliste">
          &larr; Zurueck
        </button>
        <div style={{ marginTop: '1rem' }}>
          <ErrorMessage message={error} onRetry={retry} />
        </div>
      </div>
    );
  }

  if (!object) {
    return (
      <div className="app">
        <ErrorMessage message="Objekt nicht gefunden" />
      </div>
    );
  }

  const breadcrumbType = displayObjectType(object.Object_Type, object.Source_Table);
  const breadcrumbItems: BreadcrumbItem[] = [
    { label: 'Suche', path: '/' },
    { label: breadcrumbType, path: `/?type=${breadcrumbType}` },
    { label: object.Object_Name || '(ohne Namen)', path: null },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'detail':
        return <TypeDetail objectType={object.Object_Type} uuid={object.Object_UUID} />;
      case 'references':
        return <HierarchyTree ref={hierarchyRef} references={references} />;
      case 'graph':
        return <DependencyGraph object={object} references={references} />;
      default:
        return null;
    }
  };

  return (
    <div className="app" role="main" aria-labelledby="object-title">
      {/* Navigation bar */}
      <div className="detail-nav">
        <button onClick={handleBack} className="back-button" aria-label="Zurueck zur Suchliste">
          &larr; Zurueck
        </button>
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      {/* Object header */}
      <ObjectHeader object={object} />

      {/* Sub-navigation tabs */}
      <nav className="detail-tab-nav" role="tablist" aria-label="Objekt-Ansichten">
        {DETAIL_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button${activeTab === tab.id ? ' active' : ''}${!tab.enabled ? ' disabled' : ''}`}
            onClick={() => tab.enabled && setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-disabled={!tab.enabled}
            tabIndex={tab.enabled ? 0 : -1}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Separator */}
      <hr className="detail-separator" />

      {/* Tab content */}
      {renderTabContent()}
    </div>
  );
};

import { useState, useEffect, useRef, useCallback, useMemo, type RefObject, type UIEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api, getLocalizationLabels, getQualityDashboard, getQualityExportUrl } from '../api/client';
import { fetchTemplateQuery } from '../api/templateApi';
import { OBJECT_TYPES, OBJECT_TYPE_LABELS_DE } from '@packages/shared/constants';

// PRD prd_pseudo_object_types_filter.md §8.1 — vier Pseudo-Typen für
// die Sektion "Verwendete Tokens" im Type-Dropdown.
const PSEUDO_TYPE_GROUP = ['ScriptStepType', 'BuiltinFunction', 'PluginComponent', 'PluginFunction'] as const;
const PSEUDO_TYPE_SET = new Set<string>(PSEUDO_TYPE_GROUP);
import { useInfiniteSearch, useDebounce, useScrollRestore, useInfiniteScriptContentSearch, useInfiniteTableOccurrenceUsage, useInfiniteObjectUsage, useInfiniteCredentialFindings, useInfiniteApiIntegrations, useInfiniteLayoutObjectQuality, useInfiniteQualityFindings, useInfiniteServerTopCalls } from '../hooks';
import { VirtualList, SearchOptions, FolderTree, ThemeToggle, PseudoTokenView, ObjectListItem, type FolderTreeSubtype } from '../components';
import { AiChatPanel } from '../components/AiChatPanel';
import { formatUiCount as formatCount, getUiLanguage, localizeGeneratedLabel, optionLabel, tx, type UiLanguage } from '../lib/uiLanguage';
import type { SortOption, GroupOption, VirtualListRow, FMObject, ScriptContentSearchResult, TableOccurrenceUsageRow, ObjectUsageRow, CredentialFindingRow, ApiIntegrationRow, ApiIntegrationSummaryRow, LayoutObjectQualityFindingRow, QualityFindingRow, QualityDashboardMetricRow, LocalizationLabelRow, ServerTopCallSummaryRow, ServerTopCallRow, ServerTopCallDashboardRow, ServerTopCallWaitAnalysis, ServerTopCallTimeProfileRow, ServerTopCallOperationProfileRow, ServerTopCallTimelineRow } from '../types';
import '../App.css';

type FileInfo = {
  File_Name?: string;
  File_FullName?: string;
  FileMaker_Version?: string;
  Has_DDR_INFO?: boolean;
  Import_Timestamp?: string;
};

type ViewMode = 'dashboard' | 'search' | 'tree' | 'script-content' | 'to-usage' | 'object-usage' | 'layout-quality' | 'quality' | 'api-integrations' | 'server-logs' | 'ai-chat' | 'credentials';

const SEARCH_ACCORDION_EXCLUDED_TYPES = new Set<string>([
  'RelationshipGraph',
  ...PSEUDO_TYPE_GROUP,
]);
const AI_CHAT_DRAFT_STORAGE_KEY = 'fm-lab-ai-chat-draft';

const TREE_SUBTYPE_LABELS: Record<FolderTreeSubtype, { de: string; en: string }> = {
  ScriptCatalog: { de: 'Scripts', en: 'Scripts' },
  Layouts: { de: 'Layouts', en: 'Layouts' },
  CustomFunctionsCatalog: { de: 'Eigene Funktionen', en: 'Custom functions' },
};

const TREE_SUBTYPE_URL: Record<FolderTreeSubtype, string> = {
  ScriptCatalog: 'script',
  Layouts: 'layout',
  CustomFunctionsCatalog: 'customfunction',
};

const OBJECT_USAGE_TYPES = [
  { value: '', label: 'Alle wichtigen Typen', labelEn: 'All important types' },
  { value: 'Script', label: 'Scripts', labelEn: 'Scripts' },
  { value: 'Layout', label: 'Layouts', labelEn: 'Layouts' },
  { value: 'CustomFunction', label: 'Custom Functions', labelEn: 'Custom functions' },
  { value: 'ValueList', label: 'Wertelisten', labelEn: 'Value lists' },
  { value: 'Field', label: 'Felder', labelEn: 'Fields' },
  { value: 'BaseTable', label: 'Basistabellen', labelEn: 'Base tables' },
] as const;

const OBJECT_USAGE_MAX_OPTIONS = [
  { value: '0', label: '0 Verwendungen', labelEn: '0 uses' },
  { value: '1', label: 'bis 1 Verwendung', labelEn: 'up to 1 use' },
  { value: '2', label: 'bis 2 Verwendungen', labelEn: 'up to 2 uses' },
  { value: '5', label: 'bis 5 Verwendungen', labelEn: 'up to 5 uses' },
  { value: '10', label: 'bis 10 Verwendungen', labelEn: 'up to 10 uses' },
  { value: '', label: 'Alle, selten zuerst', labelEn: 'All, rare first' },
] as const;

const CREDENTIAL_CATEGORIES = [
  { value: '', label: 'Alle Quellen', labelEn: 'All sources' },
  { value: 'SMTP', label: 'SMTP', labelEn: 'SMTP' },
  { value: 'API/cURL', label: 'API/cURL', labelEn: 'API/cURL' },
  { value: 'FileMaker Account', label: 'FileMaker Accounts', labelEn: 'FileMaker accounts' },
  { value: 'External Data Source', label: 'Externe Datenquellen', labelEn: 'External data sources' },
  { value: 'Script-Hinweis', label: 'Script-Hinweise', labelEn: 'Script hints' },
] as const;

const CREDENTIAL_RISKS = [
  { value: '', label: 'Alle Risiken', labelEn: 'All risks' },
  { value: 'high', label: 'Hoch', labelEn: 'High' },
  { value: 'medium', label: 'Mittel', labelEn: 'Medium' },
  { value: 'info', label: 'Info', labelEn: 'Info' },
] as const;

const API_INTEGRATION_TYPES = [
  { value: '', label: 'Alle Integrationen', labelEn: 'All integrations' },
  { value: 'API', label: 'APIs / URL-Services', labelEn: 'APIs / URL services' },
  { value: 'External Database', label: 'Externe Datenquellen', labelEn: 'External data sources' },
] as const;

const LAYOUT_QUALITY_CATEGORIES = [
  { value: '', label: 'Alle Probleme', labelEn: 'All issues' },
  { value: 'Außerhalb Layout', label: 'Außerhalb Layout', labelEn: 'Outside layout' },
  { value: 'Außerhalb Parent', label: 'Außerhalb Parent', labelEn: 'Outside parent' },
  { value: 'Leere Textobjekte', label: 'Leere Textobjekte', labelEn: 'Empty text objects' },
  { value: 'Nullmaß', label: 'Nullmaß', labelEn: 'Zero size' },
  { value: 'Sehr kleine Objekte', label: 'Sehr kleine Objekte', labelEn: 'Very small objects' },
  { value: 'Doppelte Objektnamen', label: 'Doppelte Namen', labelEn: 'Duplicate names' },
  { value: 'Kopierte Objektnamen', label: 'Kopierte Namen', labelEn: 'Copied names' },
  { value: 'Überlappungen', label: 'Überlappungen', labelEn: 'Overlaps' },
] as const;

const LAYOUT_QUALITY_SEVERITIES = [
  { value: '', label: 'Alle Risiken', labelEn: 'All risks' },
  { value: 'high', label: 'Hoch', labelEn: 'High' },
  { value: 'medium', label: 'Mittel', labelEn: 'Medium' },
  { value: 'info', label: 'Info', labelEn: 'Info' },
] as const;

const QUALITY_AREAS = [
  { value: '', label: 'Alle Prüfbereiche', labelEn: 'All check areas' },
  { value: 'Referenzfehler', label: 'Referenzfehler', labelEn: 'Reference errors' },
  { value: 'Script-Risiken', label: 'Script-Risiken', labelEn: 'Script risks' },
  { value: 'Feld-Qualität', label: 'Feld-Qualität', labelEn: 'Field quality' },
  { value: 'Erreichbarkeit', label: 'Erreichbarkeit', labelEn: 'Reachability' },
  { value: 'Namenskonventionen', label: 'Namenskonventionen', labelEn: 'Naming conventions' },
  { value: 'Änderungen', label: 'Änderungen', labelEn: 'Changes' },
] as const;

const QUALITY_SEVERITIES = [
  { value: '', label: 'Alle Risiken', labelEn: 'All risks' },
  { value: 'high', label: 'Hoch', labelEn: 'High' },
  { value: 'medium', label: 'Mittel', labelEn: 'Medium' },
  { value: 'info', label: 'Info', labelEn: 'Info' },
] as const;

const QUALITY_OBJECT_TYPES = [
  { value: '', label: 'Alle Typen', labelEn: 'All types' },
  { value: 'Script', label: 'Scripts', labelEn: 'Scripts' },
  { value: 'Layout', label: 'Layouts', labelEn: 'Layouts' },
  { value: 'LayoutObject', label: 'Layoutobjekte', labelEn: 'Layout objects' },
  { value: 'Field', label: 'Felder', labelEn: 'Fields' },
  { value: 'Relationship', label: 'Beziehungen', labelEn: 'Relationships' },
  { value: 'CustomFunction', label: 'Custom Functions', labelEn: 'Custom functions' },
  { value: 'ValueList', label: 'Wertelisten', labelEn: 'Value lists' },
  { value: 'BaseTable', label: 'Basistabellen', labelEn: 'Base tables' },
] as const;

const SERVER_LOG_OBJECT_TYPES = [
  { value: '', label: 'Alle Ziele', labelEn: 'All targets' },
  { value: 'Layout', label: 'Layouts', labelEn: 'Layouts' },
  { value: 'Field', label: 'Felder', labelEn: 'Fields' },
  { value: 'Unmatched', label: 'Nicht gematcht', labelEn: 'Unmatched' },
] as const;

const SERVER_LOG_MIN_ELAPSED = [
  { value: '', label: 'Alle Laufzeiten', labelEn: 'All runtimes' },
  { value: '100', label: 'ab 100 ms', labelEn: 'from 100 ms' },
  { value: '500', label: 'ab 500 ms', labelEn: 'from 500 ms' },
  { value: '1000', label: 'ab 1 s', labelEn: 'from 1 s' },
  { value: '5000', label: 'ab 5 s', labelEn: 'from 5 s' },
] as const;

const SEARCH_ACCORDION_TYPES = OBJECT_TYPES
  .filter(type => !SEARCH_ACCORDION_EXCLUDED_TYPES.has(type))
  .map(type => ({
    type,
    label: OBJECT_TYPE_LABELS_DE[type] ?? type,
  }))
  .sort((a, b) => a.label.localeCompare(b.label, 'de'));

type UsageBucket = {
  key: string;
  label: string;
  order: number;
};

function getUsageBucket(count: number, language: UiLanguage): UsageBucket {
  if (count <= 0) {
    return { key: '0000000000', label: tx(language, '0 Verwendungen', '0 uses'), order: 0 };
  }

  if (count < 100) {
    const start = count < 10 ? 1 : Math.floor(count / 10) * 10;
    const end = count < 10 ? 9 : start + 9;
    return {
      key: String(start).padStart(10, '0'),
      label: tx(language, `${start}-${end} Verwendungen`, `${start}-${end} uses`),
      order: start,
    };
  }

  const step = count >= 1000 ? 1000 : 100;
  const start = Math.floor(count / step) * step;
  const end = start + step - 1;
  return {
    key: String(start).padStart(10, '0'),
    label: tx(language, `${formatCount(start, language)}-${formatCount(end, language)} Verwendungen`, `${formatCount(start, language)}-${formatCount(end, language)} uses`),
    order: start,
  };
}

function groupByUsageBucket<T>(items: T[], getCount: (item: T) => number, language: UiLanguage) {
  const groups = new Map<string, { bucket: UsageBucket; items: T[] }>();
  for (const item of items) {
    const bucket = getUsageBucket(getCount(item), language);
    const existing = groups.get(bucket.key);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(bucket.key, { bucket, items: [item] });
    }
  }
  return [...groups.values()].sort((a, b) => b.bucket.order - a.bucket.order);
}

function urlToSubtype(value: string | null): FolderTreeSubtype {
  switch (value) {
    case 'layout':         return 'Layouts';
    case 'customfunction': return 'CustomFunctionsCatalog';
    default:               return 'ScriptCatalog';
  }
}

function urlToMode(value: string | null): ViewMode {
  switch (value) {
    case 'dashboard':       return 'dashboard';
    case 'tree':            return 'tree';
    case 'scripts':
    case 'script-content':  return 'script-content';
    case 'to':
    case 'to-usage':        return 'to-usage';
    case 'objects':
    case 'object-usage':    return 'object-usage';
    case 'apis':
    case 'api':
    case 'api-integrations':
    case 'integrationen':
    case 'integrations':    return 'api-integrations';
    case 'credentials':
    case 'secrets':
    case 'zugangsdaten':    return 'credentials';
    case 'layout-quality':
    case 'layoutobjects':
    case 'layout-objects':
    case 'layout-pruefung':
    case 'layout-prüfung':  return 'layout-quality';
    case 'quality':
    case 'pruefungen':
    case 'prüfungen':
    case 'risks':
    case 'risiken':         return 'quality';
    case 'server-logs':
    case 'logs':
    case 'top-calls':
    case 'topcall':         return 'server-logs';
    case 'ai':
    case 'chat':
    case 'agent':
    case 'ai-chat':         return 'ai-chat';
    default:                return 'dashboard';
  }
}

interface ScriptContentSearchListProps {
  items: ScriptContentSearchResult[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  query: string;
  minQueryLength: number;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: ScriptContentSearchResult) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function ScriptContentSearchList({
  items,
  totalCount,
  isLoading,
  hasMore,
  query,
  minQueryLength,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: ScriptContentSearchListProps) {
  const queryLength = query.replace(/\*/g, '').trim().length;

  if (queryLength < minQueryLength) {
    return (
      <div className="virtual-list-container script-search-results">
        <div className="virtual-list-empty">
          {tx(language, `Mindestens ${minQueryLength} Zeichen eingeben, um Script-Inhalte zu durchsuchen.`, `Enter at least ${minQueryLength} characters to search script content.`)}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container script-search-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {tx(language, 'Script-Treffer gefunden', 'script matches found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="script-search-list">
        {items.map((item) => (
          <li key={`${item.Step_UUID}-${item.File_Name}`} className="script-search-row">
            <button
              type="button"
              className="script-search-item"
              onClick={() => onItemClick(item)}
              aria-label={tx(language, `${item.Script_Name || 'Script'} Zeile ${item.Step_Number} öffnen`, `Open ${item.Script_Name || 'Script'} line ${item.Step_Number}`)}
            >
              <span className="script-search-item-top">
                <strong className="script-search-script">{item.Script_Name || tx(language, '(ohne Scriptnamen)', '(without script name)')}</strong>
                <span className="script-search-step">{tx(language, 'Schritt', 'Step')} {item.Step_Number}</span>
                <span className="script-search-badge">{item.Match_Field}</span>
              </span>
              <span className="script-search-meta">
                {item.File_Name}
                {item.Step_Name ? ` · ${item.Step_Name}` : ''}
              </span>
              <span className="script-search-line">
                <span className="script-search-line-number">{tx(language, 'Zeile', 'Line')} {item.Step_Number}</span>
                <span className="script-search-line-text">
                  {item.Script_Line_Text || item.Step_Name || tx(language, '(leere Script-Zeile)', '(empty script line)')}
                </span>
              </span>
              {item.Snippet && (
                <span className="script-search-snippet">{tx(language, 'Treffer', 'Match')}: {item.Snippet}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade Script-Treffer...', 'Loading script matches...')}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine Script-Treffer gefunden', 'No script matches found')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Treffer laden', 'Load more matches')}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle Script-Treffer geladen', 'All script matches loaded')}
        </div>
      )}
    </div>
  );
}

type SearchAccordionTypeOption = {
  type: string;
  label: string;
};

type SearchAccordionGroupState = SearchAccordionTypeOption & {
  totalCount: number | null;
  items: FMObject[];
  offset: number;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  error: string | null;
};

interface TypeAccordionListProps {
  selectedFile: string;
  selectedType: string;
  language: UiLanguage;
  labelFor: (key: string, fallback: string) => string;
  onItemClick: (uuid: string) => void;
  onSendToAiChat?: (prompt: string) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function extractCount(data: unknown): number | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (row && typeof row === 'object' && 'count' in row) {
    const value = (row as { count?: unknown }).count;
    return typeof value === 'number' ? value : null;
  }
  return null;
}

function TypeAccordionList({
  selectedFile,
  selectedType,
  language,
  labelFor,
  onItemClick,
  onSendToAiChat,
  onScroll,
  scrollContainerRef,
}: TypeAccordionListProps) {
  const typeOptions = useMemo(() => {
    if (selectedType && !SEARCH_ACCORDION_EXCLUDED_TYPES.has(selectedType)) {
      const label = labelFor(`object.${selectedType}`, OBJECT_TYPE_LABELS_DE[selectedType as keyof typeof OBJECT_TYPE_LABELS_DE] ?? selectedType);
      return [{ type: selectedType, label }];
    }
    return SEARCH_ACCORDION_TYPES.map(option => ({
      ...option,
      label: labelFor(`object.${option.type}`, option.label),
    }));
  }, [selectedType, labelFor]);

  const [groups, setGroups] = useState<SearchAccordionGroupState[]>([]);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const requestKey = `${selectedFile}|${selectedType}`;

  useEffect(() => {
    let cancelled = false;
    const initialGroups = typeOptions.map(option => ({
      ...option,
      totalCount: null,
      items: [] as FMObject[],
      offset: 0,
      loading: false,
      loadingMore: false,
      loaded: false,
      error: null,
    }));

    setExpandedTypes(new Set());
    setGroups(initialGroups);

    async function loadCounts() {
      const countedGroups = await Promise.all(initialGroups.map(async (group) => {
        try {
          const response = await api.searchCount({
            name: '%',
            type: group.type as any,
            file: selectedFile || undefined,
          });
          const count = response.success ? extractCount(response.data) : null;
          return { ...group, totalCount: count ?? 0 };
        } catch (err) {
          return {
            ...group,
            totalCount: 0,
            error: err instanceof Error ? err.message : tx(language, 'Fehler beim Laden', 'Loading failed'),
          };
        }
      }));

      if (!cancelled) {
        setGroups(countedGroups);
      }
    }

    void loadCounts();

    return () => {
      cancelled = true;
    };
  }, [requestKey, selectedFile, typeOptions]);

  const loadGroup = useCallback(async (type: string, append = false) => {
    const current = groups.find(group => group.type === type);
    if (!current) return;
    if (!append && current.loaded) return;
    if ((append && current.loadingMore) || (!append && current.loading)) return;

    const offset = append ? current.offset : 0;

    setGroups(prev => prev.map(group => group.type === type
      ? { ...group, loading: !append, loadingMore: append, error: null }
      : group
    ));

    try {
      const response = await api.search({
        name: '%',
        type: type as any,
        file: selectedFile || undefined,
        limit: 100,
        offset,
      });
      const nextItems = response.success && Array.isArray(response.data)
        ? response.data as FMObject[]
        : [];

      setGroups(prev => prev.map(group => {
        if (group.type !== type) return group;
        const items = append ? [...group.items, ...nextItems] : nextItems;
        return {
          ...group,
          items,
          offset: offset + nextItems.length,
          loading: false,
          loadingMore: false,
          loaded: true,
        };
      }));
    } catch (err) {
      setGroups(prev => prev.map(group => group.type === type
        ? {
            ...group,
            loading: false,
            loadingMore: false,
            error: err instanceof Error ? err.message : tx(language, 'Fehler beim Laden', 'Loading failed'),
          }
        : group
      ));
    }
  }, [groups, selectedFile]);

  const toggleType = useCallback((type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
        void loadGroup(type, false);
      }
      return next;
    });
  }, [loadGroup]);

  const totalLoaded = groups.reduce((sum, group) => sum + group.items.length, 0);
  const totalCount = groups.reduce((sum, group) => sum + (group.totalCount || 0), 0);

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container type-accordion-results"
      onScroll={onScroll}
    >
      <div className="virtual-list-header">
        {formatCount(totalCount, language)} {tx(language, 'Objekte nach Typ gruppiert', 'objects grouped by type')}
        {totalLoaded > 0 && (
          <span className="loaded-count">
            ({formatCount(totalLoaded, language)} {tx(language, 'geladen', 'loaded')})
          </span>
        )}
      </div>

      <ul className="type-accordion-list">
        {groups.map((group) => {
          const expanded = expandedTypes.has(group.type);
          const hasMoreInGroup = group.totalCount !== null && group.items.length < group.totalCount;

          return (
            <li key={group.type} className="usage-bucket-section">
              <button
                type="button"
                className="usage-bucket-button"
                onClick={() => toggleType(group.type)}
                aria-expanded={expanded}
              >
                <span className="usage-bucket-toggle">{expanded ? '-' : '+'}</span>
                <span className="usage-bucket-label">{group.label}</span>
                <span className="usage-bucket-count">
                  {group.totalCount === null ? tx(language, 'zähle...', 'counting...') : `${formatCount(group.totalCount, language)} ${tx(language, 'Objekte', 'objects')}`}
                </span>
              </button>

              {expanded && (
                <div className="type-accordion-items">
                  {group.error && (
                    <div className="type-accordion-error">{group.error}</div>
                  )}

                  {group.loading && (
                    <div className="virtual-list-footer">{tx(language, 'Lade', 'Loading')} {group.label}...</div>
                  )}

                  {!group.loading && group.items.map((object) => (
                    <ObjectListItem
                      key={object.Object_UUID}
                      object={object}
                      onClick={onItemClick}
                      onSendToAiChat={onSendToAiChat}
                    />
                  ))}

                  {!group.loading && hasMoreInGroup && (
                    <div className="virtual-list-footer">
                      <button
                        type="button"
                        className="script-search-load-more"
                        disabled={group.loadingMore}
                        onClick={() => { void loadGroup(group.type, true); }}
                      >
                        {group.loadingMore ? tx(language, 'Lade...', 'Loading...') : tx(language, 'Weitere laden', 'Load more')}
                      </button>
                    </div>
                  )}

                  {!group.loading && group.totalCount === 0 && (
                    <div className="virtual-list-empty">
                      {tx(language, 'Keine Objekte in diesem Typ', 'No objects in this type')}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface TableOccurrenceUsageListProps {
  items: TableOccurrenceUsageRow[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  unusedOnly: boolean;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: TableOccurrenceUsageRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function TableOccurrenceUsageList({
  items,
  totalCount,
  isLoading,
  hasMore,
  unusedOnly,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: TableOccurrenceUsageListProps) {
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupByUsageBucket(items, item => item.usage_count, language), [items, language]);

  const toggleBucket = useCallback((key: string) => {
    setExpandedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container to-usage-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {unusedOnly ? tx(language, 'unbenutzte TOs gefunden', 'unused TOs found') : tx(language, 'Table Occurrences gefunden', 'table occurrences found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="to-usage-list">
        {groups.map(({ bucket, items: bucketItems }) => {
          const collapsed = !expandedBuckets.has(bucket.key);
          return (
            <li key={bucket.key} className="usage-bucket-section">
              <button
                type="button"
                className="usage-bucket-button"
                onClick={() => toggleBucket(bucket.key)}
                aria-expanded={!collapsed}
              >
                <span className="usage-bucket-toggle">{collapsed ? '+' : '-'}</span>
                <span className="usage-bucket-label">{bucket.label}</span>
                <span className="usage-bucket-count">{formatCount(bucketItems.length, language)} {tx(language, 'geladen', 'loaded')}</span>
              </button>

              {!collapsed && bucketItems.map((item) => {
                const visibleDetailCount = Math.min(item.usage_details.length, 12);
                const hiddenDetailCount = Math.max(0, item.usage_count - visibleDetailCount);
                const isUnused = item.usage_count === 0;

                return (
                  <div key={`${item.TO_UUID}-${item.File_Name}`} className="to-usage-row">
                    <button
                      type="button"
                      className="to-usage-item"
                      onClick={() => onItemClick(item)}
                      aria-label={tx(language, `${item.TO_Name || 'Table Occurrence'} öffnen`, `Open ${item.TO_Name || 'table occurrence'}`)}
                    >
                      <span className="to-usage-item-top">
                        <strong className="to-usage-name">{item.TO_Name || tx(language, '(ohne TO-Namen)', '(without TO name)')}</strong>
                        <span className={`to-usage-count${isUnused ? ' unused' : ''}`}>
                          {isUnused ? tx(language, '0 Verwendungen', '0 uses') : `${formatCount(item.usage_count, language)} ${tx(language, 'Verwendungen', 'uses')}`}
                        </span>
                      </span>

                      <span className="to-usage-meta">
                        {item.File_Name}
                        {item.BT_Name ? ` · ${tx(language, 'Basistabelle', 'Base table')}: ${item.BT_Name}` : ''}
                        {item.DS_Name ? ` · ${tx(language, 'Quelle', 'Source')}: ${item.DS_Name}` : ''}
                      </span>

                      <span className="to-usage-breakdown">
                        <span>{formatCount(item.functional_usage_count, language)} {tx(language, 'funktional', 'functional')}</span>
                        <span>{formatCount(item.relationship_count, language)} {tx(language, 'Beziehungen', 'relationships')}</span>
                        {isUnused && <span className="to-usage-unused-badge">{tx(language, 'nirgends verwendet', 'not used anywhere')}</span>}
                      </span>

                      {item.usage_groups.length > 0 && (
                        <span className="to-usage-groups">
                          {item.usage_groups.map((group) => (
                            <span key={`${item.TO_UUID}-${group.category}`} className="to-usage-group-pill">
                              {localizeGeneratedLabel(group.category, language)} {formatCount(group.count, language)}
                            </span>
                          ))}
                        </span>
                      )}

                      {item.usage_details.length > 0 && (
                        <span className="to-usage-details">
                          {item.usage_details.slice(0, 12).map((detail, index) => (
                            <span key={`${item.TO_UUID}-${detail.category}-${detail.source_uuid || index}-${index}`} className="to-usage-detail-line">
                              <span className={`to-usage-detail-category${detail.family === 'relationship' ? ' relationship' : ''}`}>
                                {localizeGeneratedLabel(detail.category, language)}
                              </span>
                              <span className="to-usage-detail-location">
                                {detail.location || detail.source_name || detail.source_type}
                              </span>
                              {detail.detail && (
                                <span className="to-usage-detail-text">
                                  {detail.detail}
                                </span>
                              )}
                            </span>
                          ))}
                          {hiddenDetailCount > 0 && (
                            <span className="to-usage-detail-more">
                              {tx(language, `weitere ${formatCount(hiddenDetailCount, language)} Stellen nicht in der Vorschau`, `${formatCount(hiddenDetailCount, language)} more locations not shown in preview`)}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade TO-Nutzungen...', 'Loading TO usage...')}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine Table Occurrences gefunden', 'No table occurrences found')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere TOs laden', 'Load more TOs')}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle TOs geladen', 'All TOs loaded')}
        </div>
      )}
    </div>
  );
}

interface ObjectUsageListProps {
  items: ObjectUsageRow[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: ObjectUsageRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function ObjectUsageList({
  items,
  totalCount,
  isLoading,
  hasMore,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: ObjectUsageListProps) {
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupByUsageBucket(items, item => item.usage_count, language), [items, language]);

  const toggleBucket = useCallback((key: string) => {
    setExpandedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container to-usage-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {tx(language, 'seltene oder unbenutzte Objekte gefunden', 'rare or unused objects found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="to-usage-list">
        {groups.map(({ bucket, items: bucketItems }) => {
          const collapsed = !expandedBuckets.has(bucket.key);
          return (
            <li key={bucket.key} className="usage-bucket-section">
              <button
                type="button"
                className="usage-bucket-button"
                onClick={() => toggleBucket(bucket.key)}
                aria-expanded={!collapsed}
              >
                <span className="usage-bucket-toggle">{collapsed ? '+' : '-'}</span>
                <span className="usage-bucket-label">{bucket.label}</span>
                <span className="usage-bucket-count">{formatCount(bucketItems.length, language)} {tx(language, 'geladen', 'loaded')}</span>
              </button>

              {!collapsed && bucketItems.map((item) => {
                const visibleDetailCount = Math.min(item.usage_details.length, 12);
                const hiddenDetailCount = Math.max(0, item.usage_count - visibleDetailCount);
                const isUnused = item.usage_count === 0;

                return (
                  <div key={`${item.Object_UUID}-${item.File_Name}`} className="to-usage-row">
                    <button
                      type="button"
                      className="to-usage-item"
                      onClick={() => onItemClick(item)}
                      aria-label={tx(language, `${item.Object_Name || 'Objekt'} öffnen`, `Open ${item.Object_Name || 'object'}`)}
                    >
                      <span className="to-usage-item-top">
                        <strong className="to-usage-name">{item.Object_Name || tx(language, '(ohne Objektname)', '(without object name)')}</strong>
                        <span className="to-usage-group-pill">{item.Object_Type}</span>
                        <span className={`to-usage-count${isUnused ? ' unused' : ''}`}>
                          {isUnused ? tx(language, '0 Referenzen', '0 references') : `${formatCount(item.usage_count, language)} ${tx(language, 'Referenzen', 'references')}`}
                        </span>
                      </span>

                      <span className="to-usage-meta">
                        {item.File_Name}
                        {item.Source_Table ? ` · ${tx(language, 'Quelle', 'Source')}: ${item.Source_Table}` : ''}
                      </span>

                      {isUnused && (
                        <span className="to-usage-breakdown">
                          <span className="to-usage-unused-badge">{tx(language, 'keine eingehende Referenz erkannt', 'no incoming reference detected')}</span>
                        </span>
                      )}

                      {item.usage_groups.length > 0 && (
                        <span className="to-usage-groups">
                          {item.usage_groups.map((group) => (
                            <span key={`${item.Object_UUID}-${group.category}`} className="to-usage-group-pill">
                              {localizeGeneratedLabel(group.category, language)} {formatCount(group.count, language)}
                            </span>
                          ))}
                        </span>
                      )}

                      {item.usage_details.length > 0 && (
                        <span className="to-usage-details">
                          {item.usage_details.slice(0, 12).map((detail, index) => (
                            <span key={`${item.Object_UUID}-${detail.category}-${detail.source_uuid || index}-${index}`} className="to-usage-detail-line">
                              <span className="to-usage-detail-category">
                                {localizeGeneratedLabel(detail.category, language)}
                              </span>
                              <span className="to-usage-detail-location">
                                {detail.location || detail.source_name || detail.source_type}
                              </span>
                              {detail.detail && (
                                <span className="to-usage-detail-text">
                                  {detail.detail}
                                </span>
                              )}
                            </span>
                          ))}
                          {hiddenDetailCount > 0 && (
                            <span className="to-usage-detail-more">
                              {tx(language, `weitere ${formatCount(hiddenDetailCount, language)} Referenzen nicht in der Vorschau`, `${formatCount(hiddenDetailCount, language)} more references not shown in preview`)}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade Objekt-Nutzungen...', 'Loading object usage...')}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine passenden Objekte gefunden', 'No matching objects found')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Objekte laden', 'Load more objects')}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle Objekte geladen', 'All objects loaded')}
        </div>
      )}
    </div>
  );
}

interface CredentialFindingsListProps {
  items: CredentialFindingRow[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  revealValues: boolean;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: CredentialFindingRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function riskLabel(risk: string, language: UiLanguage) {
  switch (risk) {
    case 'high': return tx(language, 'Hoch', 'High');
    case 'medium': return tx(language, 'Mittel', 'Medium');
    case 'info': return 'Info';
    default: return risk || 'Info';
  }
}

function credentialValue(item: CredentialFindingRow, revealValues: boolean, language: UiLanguage) {
  const value = item.Value_Text || '';
  if (!value) return tx(language, '(kein Wert im DDR)', '(no value in DDR)');
  if (revealValues || !item.Is_Secret) return value;
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function CredentialFindingsList({
  items,
  totalCount,
  isLoading,
  hasMore,
  revealValues,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: CredentialFindingsListProps) {
  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container credential-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {tx(language, 'Zugangsdaten-/Secret-Fundstellen gefunden', 'credential/secret findings found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="credential-list">
        {items.map((item) => (
          <li key={`${item.Finding_ID}-${item.Source_File}`} className="credential-row">
            <button
              type="button"
              className="credential-item"
              onClick={() => onItemClick(item)}
              aria-label={tx(language, `${item.Field_Name || 'Fundstelle'} öffnen`, `Open ${item.Field_Name || 'finding'}`)}
            >
              <span className="credential-item-top">
                <strong className="credential-name">{localizeGeneratedLabel(item.Field_Name, language)}</strong>
                <span className="to-usage-group-pill">{localizeGeneratedLabel(item.Source_Category, language)}</span>
                <span className={`credential-risk ${item.Risk_Level}`}>{riskLabel(item.Risk_Level, language)}</span>
                {item.Is_Secret && <span className="credential-secret-badge">Secret</span>}
              </span>

              <span className="credential-meta">
                {item.Source_File || tx(language, '(ohne Datei)', '(without file)')}
                {item.Source_Location ? ` · ${item.Source_Location}` : ''}
              </span>

              <span className="credential-value">
                <span className="credential-value-kind">{item.Value_Kind}</span>
                <span className="credential-value-text">{credentialValue(item, revealValues, language)}</span>
              </span>

              {item.Evidence_Text && (
                <span className="credential-evidence">
                  {item.Evidence_Text}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade Zugangsdaten...', 'Loading credentials...')}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine Zugangsdaten-Fundstellen gefunden', 'No credential findings found')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Fundstellen laden', 'Load more findings')}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle Fundstellen geladen', 'All findings loaded')}
        </div>
      )}
    </div>
  );
}

interface ApiIntegrationListProps {
  items: ApiIntegrationRow[];
  summary: ApiIntegrationSummaryRow[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: ApiIntegrationRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function apiIntegrationValue(item: ApiIntegrationRow, language: UiLanguage) {
  return item.Safe_Endpoint_Text || item.Endpoint_Text || tx(language, '(kein URL-/Pfadwert im DDR)', '(no URL/path value in DDR)');
}

function ApiIntegrationList({
  items,
  summary,
  totalCount,
  isLoading,
  hasMore,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: ApiIntegrationListProps) {
  const [expandedFamilies, setExpandedFamilies] = useState<Set<string>>(new Set());
  const summaryKey = summary.map(row => row.Summary_ID).join('|');

  useEffect(() => {
    setExpandedFamilies(new Set());
  }, [summaryKey]);

  const itemsByFamily = useMemo(() => {
    const map = new Map<string, ApiIntegrationRow[]>();
    for (const item of items) {
      const key = `${item.Integration_Type}||${item.Api_Family}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const toggleFamily = useCallback((key: string) => {
    setExpandedFamilies(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container api-integration-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {tx(language, 'API-/Integrations-Fundstellen gefunden', 'API/integration findings found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="to-usage-list api-integration-list">
        {summary.map((group) => {
          const groupKey = `${group.Integration_Type}||${group.Api_Family}`;
          const isExpanded = expandedFamilies.has(groupKey);
          const groupItems = itemsByFamily.get(groupKey) || [];
          const countLabel = group.Integration_Type === 'External Database'
            ? `${formatCount(group.External_TO_Count, language)} TOs`
            : `${formatCount(group.Source_Count, language)} ${tx(language, 'Quellen', 'sources')} · ${formatCount(group.Step_Count, language)} Steps`;

          return (
            <li key={group.Summary_ID} className="usage-bucket-section">
              <button
                type="button"
                className="usage-bucket-button"
                onClick={() => toggleFamily(groupKey)}
                aria-expanded={isExpanded}
              >
                <span className="usage-bucket-toggle">{isExpanded ? '-' : '+'}</span>
                <span className="usage-bucket-label">{group.Api_Family}</span>
                <span className="to-usage-group-pill">{group.Integration_Type === 'External Database' ? tx(language, 'Externe Datenquelle', 'External data source') : group.Integration_Type}</span>
                {group.Secret_Count > 0 && <span className="credential-secret-badge">Secret</span>}
                <span className="usage-bucket-count">{countLabel}</span>
              </button>

              {isExpanded && (
                <ul className="credential-list api-integration-items">
                  {groupItems.map((item) => (
                    <li key={`${item.Finding_ID}-${item.Source_File}`} className="credential-row">
                      <button
                        type="button"
                        className="credential-item"
                        onClick={() => onItemClick(item)}
                        aria-label={tx(language, `${item.Api_Family} öffnen`, `Open ${item.Api_Family}`)}
                      >
                        <span className="credential-item-top">
                          <strong className="credential-name">{item.Source_Name || item.Api_Name}</strong>
                          <span className="to-usage-group-pill">{localizeGeneratedLabel(item.Source_Category, language)}</span>
                          <span className={`credential-risk ${item.Risk_Level}`}>{riskLabel(item.Risk_Level, language)}</span>
                          {item.Is_Secret && <span className="credential-secret-badge">Secret</span>}
                        </span>

                        <span className="credential-meta">
                          {item.Source_File || tx(language, '(ohne Datei)', '(without file)')}
                          {item.Source_Location ? ` · ${item.Source_Location}` : ''}
                        </span>

                        <span className="credential-value">
                          <span className="credential-value-kind">{localizeGeneratedLabel(item.Field_Name || item.Value_Kind, language)}</span>
                          <span className="credential-value-text">{apiIntegrationValue(item, language)}</span>
                        </span>

                        {item.Evidence_Text && (
                          <span className="credential-evidence">
                            {item.Evidence_Text}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}

                  {groupItems.length === 0 && (
                    <li className="to-usage-detail-more">
                      {tx(language, 'Details dieser Gruppe liegen außerhalb der aktuell geladenen Fundstellen. Bitte Suche oder Filter weiter eingrenzen.', 'Details for this group are outside the currently loaded findings. Narrow the search or filters.')}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade API-Integrationen...', 'Loading API integrations...')}
        </div>
      )}

      {!isLoading && summary.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine API-/Integrations-Fundstellen gefunden', 'No API/integration findings found')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Fundstellen laden', 'Load more findings')}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle geladenen Fundstellen angezeigt', 'All loaded findings shown')}
        </div>
      )}
    </div>
  );
}

interface LayoutObjectQualityListProps {
  items: LayoutObjectQualityFindingRow[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: LayoutObjectQualityFindingRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function formatMetric(value: number | null | undefined, fractionDigits = 0) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
  return value.toLocaleString('de-DE', {
    maximumFractionDigits: fractionDigits,
  });
}

function objectDisplayName(name: string | null | undefined, type: string | null | undefined, id: number | null | undefined, language: UiLanguage = 'de') {
  const parts = [name?.trim() || tx(language, '(ohne Objektname)', '(without object name)'), type || tx(language, 'Objekt', 'Object')];
  if (typeof id === 'number') parts.push(`ID ${id}`);
  return parts.join(' · ');
}

function overlapStackText(item: LayoutObjectQualityFindingRow, language: UiLanguage) {
  if (!item.Related_Object_ID) return null;

  const current = {
    label: objectDisplayName(item.Object_Name, item.Object_Type, item.Object_ID, language),
    z: item.Z_Order,
  };
  const related = {
    label: objectDisplayName(item.Related_Object_Name, item.Related_Object_Type, item.Related_Object_ID, language),
    z: item.Related_Z_Order,
  };

  if (typeof current.z !== 'number' || typeof related.z !== 'number' || current.z === related.z) {
    return tx(language, `Stapel: ${current.label} (Z ${current.z ?? '?'}) | ${related.label} (Z ${related.z ?? '?'})`, `Stack: ${current.label} (Z ${current.z ?? '?'}) | ${related.label} (Z ${related.z ?? '?'})`);
  }

  const lower = current.z < related.z ? current : related;
  const upper = current.z < related.z ? related : current;
  return tx(language, `Stapel: unten ${lower.label} (Z ${lower.z}) | oben ${upper.label} (Z ${upper.z})`, `Stack: below ${lower.label} (Z ${lower.z}) | above ${upper.label} (Z ${upper.z})`);
}

function groupLayoutQualityByCategory(items: LayoutObjectQualityFindingRow[]) {
  const groups = new Map<string, LayoutObjectQualityFindingRow[]>();
  for (const item of items) {
    const key = item.Issue_Category || 'Sonstige';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const severityOrder: Record<string, number> = { high: 0, medium: 1, info: 2 };
  return [...groups.entries()]
    .map(([category, rows]) => ({
      category,
      rows: rows.sort((a, b) =>
        (severityOrder[a.Severity] ?? 3) - (severityOrder[b.Severity] ?? 3)
        || (a.Layout_Name || '').localeCompare(b.Layout_Name || '', 'de')
        || (a.Z_Order ?? 0) - (b.Z_Order ?? 0)
      ),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, 'de'));
}

function LayoutObjectQualityList({
  items,
  totalCount,
  isLoading,
  hasMore,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: LayoutObjectQualityListProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const groups = groupLayoutQualityByCategory(items);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container layout-quality-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {tx(language, 'Layout-Objekt-Fundstellen gefunden', 'layout object findings found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="layout-quality-list">
        {groups.map(({ category, rows }) => {
          const collapsed = !expandedCategories.has(category);
          return (
            <li key={category} className="usage-bucket-section">
              <button
                type="button"
                className="usage-bucket-button"
                onClick={() => toggleCategory(category)}
                aria-expanded={!collapsed}
              >
                <span className="usage-bucket-toggle">{collapsed ? '+' : '-'}</span>
                <span className="usage-bucket-label">{localizeGeneratedLabel(category, language)}</span>
                <span className="usage-bucket-count">{formatCount(rows.length, language)} {tx(language, 'geladen', 'loaded')}</span>
              </button>

              {!collapsed && (
                <div className="layout-quality-items">
                  {rows.map((item) => {
                    const stackText = overlapStackText(item, language);
                    const ratioPercent = typeof item.Overlap_Ratio === 'number'
                      ? `${formatMetric(item.Overlap_Ratio * 100, 1)} %`
                      : null;

                    return (
                      <div key={item.Finding_ID} className="layout-quality-row">
                        <button
                          type="button"
                          className="layout-quality-item"
                          onClick={() => onItemClick(item)}
                          aria-label={tx(language, `${item.Issue_Type || item.Issue_Category} im Layout ${item.Layout_Name} öffnen`, `Open ${item.Issue_Type || item.Issue_Category} in layout ${item.Layout_Name}`)}
                        >
                          <span className="layout-quality-item-top">
                            <strong className="layout-quality-name">{localizeGeneratedLabel(item.Issue_Type || item.Issue_Category, language)}</strong>
                            <span className="to-usage-group-pill">{item.Object_Type || tx(language, 'Objekt', 'Object')}</span>
                            <span className={`credential-risk ${item.Severity}`}>{riskLabel(item.Severity, language)}</span>
                          </span>

                          <span className="layout-quality-meta">
                            {item.File_Name || tx(language, '(ohne Datei)', '(without file)')} · {item.Layout_Name || tx(language, '(ohne Layoutname)', '(without layout name)')}
                            {item.Layout_TO_Name ? ` (${item.Layout_TO_Name})` : ''}
                          </span>

                          <span className="layout-quality-object">
                            {objectDisplayName(item.Object_Name, item.Object_Type, item.Object_ID, language)}
                          </span>

                          <span className="layout-quality-bounds">
                            <span>{tx(language, 'Position', 'Position')} {formatMetric(item.Abs_Left)}, {formatMetric(item.Abs_Top)} {tx(language, 'bis', 'to')} {formatMetric(item.Abs_Right)}, {formatMetric(item.Abs_Bottom)}</span>
                            <span>{tx(language, 'Größe', 'Size')} {formatMetric(item.Width)} x {formatMetric(item.Height)}</span>
                            <span>Z {formatMetric(item.Z_Order)}</span>
                            {typeof item.Nesting_Level === 'number' && <span>{tx(language, 'Ebene', 'Level')} {item.Nesting_Level}</span>}
                            {ratioPercent && <span>{tx(language, 'Überlappung', 'Overlap')} {ratioPercent}</span>}
                            {typeof item.Overlap_Area === 'number' && <span>{tx(language, 'Fläche', 'Area')} {formatMetric(item.Overlap_Area)}</span>}
                          </span>

                          {item.Related_Object_ID && (
                            <span className="layout-quality-related">
                              {tx(language, 'Betroffenes Objekt', 'Affected object')}: {objectDisplayName(item.Related_Object_Name, item.Related_Object_Type, item.Related_Object_ID, language)}
                            </span>
                          )}

                          {stackText && (
                            <span className="layout-quality-stack">
                              {stackText}
                            </span>
                          )}

                          {item.Detail_Text && (
                            <span className="layout-quality-detail">
                              {item.Detail_Text}
                            </span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade Layout-Prüfung...', 'Loading layout checks...')}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine Layout-Objekt-Fundstellen gefunden', 'No layout object findings found')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Fundstellen laden', 'Load more findings')}
          </button>
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="virtual-list-footer">
          {tx(language, 'Alle Fundstellen geladen', 'All findings loaded')}
        </div>
      )}
    </div>
  );
}

interface ScriptFolderRow {
  uuid: string;
  name: string;
  subtype: string;
  nesting_level: number;
  sequence: number;
}

interface ScriptFolderFilterProps {
  file?: string;
  selectedFolders: string[];
  sortMode: 'structure' | 'alpha';
  language: UiLanguage;
  onSelectedFoldersChange: (folders: string[]) => void;
  onSortModeChange: (mode: 'structure' | 'alpha') => void;
}

function ScriptFolderFilter({
  file,
  selectedFolders,
  sortMode,
  language,
  onSelectedFoldersChange,
  onSortModeChange,
}: ScriptFolderFilterProps) {
  const [folders, setFolders] = useState<ScriptFolderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedFolders), [selectedFolders]);

  useEffect(() => {
    let cancelled = false;
    async function loadFolders() {
      setLoading(true);
      try {
        const params: Record<string, string> = { subtype: 'ScriptCatalog' };
        if (file) params.file = file;
        const response = await fetchTemplateQuery('list_with_folders', params);
        if (cancelled) return;
        const rows = response.data
          .map((row) => ({
            uuid: String(row.uuid ?? ''),
            name: String(row.name ?? ''),
            subtype: String(row.subtype ?? ''),
            nesting_level: Number(row.nesting_level ?? 0),
            sequence: Number(row.sequence ?? 0),
          }))
          .filter(row => row.uuid && row.subtype === 'Folder');
        setFolders(rows);
      } catch (err) {
        console.error('Script folders failed:', err);
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadFolders();
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => {
    if (!folders.length || selectedFolders.length === 0) return;
    const available = new Set(folders.map(folder => folder.uuid));
    const next = selectedFolders.filter(uuid => available.has(uuid));
    if (next.length !== selectedFolders.length) {
      onSelectedFoldersChange(next);
    }
  }, [folders, selectedFolders, onSelectedFoldersChange]);

  const visibleFolders = useMemo(() => {
    const rows = [...folders];
    if (sortMode === 'alpha') {
      rows.sort((a, b) => a.name.localeCompare(b.name, 'de') || a.sequence - b.sequence);
    } else {
      rows.sort((a, b) => a.sequence - b.sequence);
    }
    return rows;
  }, [folders, sortMode]);

  const toggleFolder = (uuid: string) => {
    const next = new Set(selectedSet);
    if (next.has(uuid)) {
      next.delete(uuid);
    } else {
      next.add(uuid);
    }
    onSelectedFoldersChange([...next]);
  };

  return (
    <div className="script-folder-filter">
      <div className="script-folder-filter-head">
        <label className="checkbox-toggle">
          <input
            type="checkbox"
            checked={open || selectedFolders.length > 0}
            onChange={(event) => {
              setOpen(event.target.checked);
              if (!event.target.checked) {
                onSelectedFoldersChange([]);
              }
            }}
          />
          <span>{tx(language, 'Ordnerfilter', 'Folder filter')}</span>
        </label>
        <span className="script-folder-filter-summary">
          {selectedFolders.length > 0
            ? tx(language, `${formatCount(selectedFolders.length, language)} Ordner ausgewählt`, `${formatCount(selectedFolders.length, language)} folders selected`)
            : open
              ? tx(language, 'kein Ordner eingeschränkt', 'no folder restricted')
              : tx(language, 'deaktiviert', 'disabled')}
        </span>
      </div>

      {open && (
        <div className="script-folder-filter-panel">
          <div className="script-folder-filter-actions">
            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={sortMode === 'alpha'}
                onChange={(event) => onSortModeChange(event.target.checked ? 'alpha' : 'structure')}
              />
              <span>{tx(language, 'Alphabetisch sortieren', 'Sort alphabetically')}</span>
            </label>
            <button type="button" className="script-folder-filter-clear" onClick={() => onSelectedFoldersChange([])}>
              {tx(language, 'Auswahl löschen', 'Clear selection')}
            </button>
          </div>

          <div className="script-folder-list">
            {loading && <div className="script-folder-empty">{tx(language, 'Ordner werden geladen...', 'Loading folders...')}</div>}
            {!loading && visibleFolders.length === 0 && (
              <div className="script-folder-empty">{tx(language, 'Keine Script-Ordner gefunden', 'No script folders found')}</div>
            )}
            {!loading && visibleFolders.map(folder => (
              <label
                key={folder.uuid}
                className="script-folder-option"
                style={{ paddingLeft: sortMode === 'structure' ? `${0.75 + folder.nesting_level * 1.1}rem` : undefined }}
              >
                <input
                  type="checkbox"
                  checked={selectedSet.has(folder.uuid)}
                  onChange={() => toggleFolder(folder.uuid)}
                />
                <span>{folder.name || tx(language, '(ohne Ordnername)', '(without folder name)')}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface QualityDashboardProps {
  rows: QualityDashboardMetricRow[];
  loading: boolean;
  language: UiLanguage;
  onMetricClick: (metric: QualityDashboardMetricRow) => void;
}

function dashboardMetricCanNavigate(section: string) {
  return ['Objekte', 'Qualität', 'Layout-Prüfung', 'Zugangsdaten'].includes(section);
}

function QualityDashboard({ rows, loading, language, onMetricClick }: QualityDashboardProps) {
  const groups = useMemo(() => {
    const map = new Map<string, QualityDashboardMetricRow[]>();
    for (const row of rows) {
      if (!map.has(row.Section)) map.set(row.Section, []);
      map.get(row.Section)!.push(row);
    }
    return [...map.entries()].sort((a, b) => (a[1][0]?.Sort_Order ?? 0) - (b[1][0]?.Sort_Order ?? 0));
  }, [rows]);

  if (loading) {
    return <div className="virtual-list-empty">{tx(language, 'Dashboard wird geladen...', 'Loading dashboard...')}</div>;
  }

  return (
    <div className="dashboard-grid">
      {groups.map(([section, metrics]) => {
        const firstMetric = metrics[0];
        const sectionLabel = language === 'en'
          ? firstMetric?.Section_Label_EN || section
          : firstMetric?.Section_Label_DE || section;

        return (
        <section key={section} className="dashboard-panel">
          <h2>{sectionLabel}</h2>
          <div className="dashboard-metric-list">
            {metrics.slice(0, 12).map(metric => {
              const clickable = dashboardMetricCanNavigate(section);
              const metricLabel = language === 'en'
                ? metric.Metric_Label_EN || metric.Metric_Key
                : metric.Metric_Label_DE || metric.Metric_Key;
              return (
                <button
                  key={`${section}-${metric.Metric_Key}`}
                  type="button"
                  className={`dashboard-metric${clickable ? ' clickable' : ''}`}
                  aria-disabled={!clickable}
                  title={metric.Metric_Source_URL || undefined}
                  onClick={() => clickable && onMetricClick(metric)}
                >
                  <span>{metricLabel}</span>
                  <strong>{metric.Metric_Value.toLocaleString(language === 'en' ? 'en-US' : 'de-DE')}</strong>
                </button>
              );
            })}
          </div>
        </section>
      );})}
    </div>
  );
}

interface QualityFindingsListProps {
  items: QualityFindingRow[];
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  exportRawUrl: string;
  exportMarkdownUrl: string;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: QualityFindingRow) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollContainerRef: RefObject<HTMLDivElement>;
}

function groupQualityFindings(items: QualityFindingRow[]) {
  const groups = new Map<string, QualityFindingRow[]>();
  for (const item of items) {
    const key = `${item.Area || 'Sonstige'} / ${item.Issue_Category || 'Sonstige'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }
  return [...groups.entries()].map(([label, rows]) => ({ label, rows }));
}

function QualityFindingsList({
  items,
  totalCount,
  isLoading,
  hasMore,
  exportRawUrl,
  exportMarkdownUrl,
  language,
  onLoadMore,
  onItemClick,
  onScroll,
  scrollContainerRef,
}: QualityFindingsListProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const groups = groupQualityFindings(items);

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      ref={scrollContainerRef}
      className="virtual-list-container quality-results"
      onScroll={onScroll}
    >
      {totalCount !== null && (
        <div className="virtual-list-header quality-header">
          <span>
            {formatCount(totalCount, language)} {tx(language, 'Prüf-Fundstellen gefunden', 'check findings found')}
            {items.length < totalCount && (
              <span className="loaded-count">({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})</span>
            )}
          </span>
          <span className="quality-export-links">
            <a href={exportRawUrl} target="_blank" rel="noreferrer">CSV</a>
            <a href={exportMarkdownUrl} target="_blank" rel="noreferrer">Markdown</a>
          </span>
        </div>
      )}

      <ul className="quality-list">
        {groups.map(({ label, rows }) => {
          const collapsed = !expandedGroups.has(label);
          return (
            <li key={label} className="usage-bucket-section">
              <button
                type="button"
                className="usage-bucket-button"
                onClick={() => toggleGroup(label)}
                aria-expanded={!collapsed}
              >
                <span className="usage-bucket-toggle">{collapsed ? '+' : '-'}</span>
                <span className="usage-bucket-label">{label.split(' / ').map(part => localizeGeneratedLabel(part, language)).join(' / ')}</span>
                <span className="usage-bucket-count">{formatCount(rows.length, language)} {tx(language, 'geladen', 'loaded')}</span>
              </button>
              {!collapsed && rows.map(item => (
                <div key={item.Finding_ID} className="quality-row">
                  <button
                    type="button"
                    className="quality-item"
                    onClick={() => onItemClick(item)}
                    aria-label={tx(language, `${item.Issue_Type} öffnen`, `Open ${item.Issue_Type}`)}
                  >
                    <span className="quality-item-top">
                      <strong className="quality-name">{localizeGeneratedLabel(item.Issue_Type, language)}</strong>
                      {item.Object_Type && <span className="to-usage-group-pill">{item.Object_Type}</span>}
                      <span className={`credential-risk ${item.Severity}`}>{riskLabel(item.Severity, language)}</span>
                    </span>
                    <span className="quality-meta">
                      {item.File_Name || tx(language, '(ohne Datei)', '(without file)')}
                      {item.Source_Location ? ` · ${item.Source_Location}` : ''}
                    </span>
                    {item.Object_Name && <span className="quality-object">{item.Object_Name}</span>}
                    {item.Detail_Text && <span className="quality-detail">{item.Detail_Text}</span>}
                    {(item.Usage_Count !== null || item.Related_Name) && (
                      <span className="layout-quality-bounds">
                        {item.Usage_Count !== null && <span>{formatCount(item.Usage_Count, language)} {tx(language, 'Nutzung(en)', 'use(s)')}</span>}
                        {item.Related_Name && <span>{item.Related_Type || tx(language, 'Referenz', 'Reference')}: {item.Related_Name}</span>}
                        {item.Step_Number !== null && <span>{tx(language, 'Schritt', 'Step')} {item.Step_Number}</span>}
                      </span>
                    )}
                  </button>
                </div>
              ))}
            </li>
          );
        })}
      </ul>

      {isLoading && <div className="virtual-list-footer">{tx(language, 'Lade Prüfungen...', 'Loading checks...')}</div>}
      {!isLoading && items.length === 0 && <div className="virtual-list-empty">{tx(language, 'Keine Prüf-Fundstellen gefunden', 'No check findings found')}</div>}
      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Fundstellen laden', 'Load more findings')}
          </button>
        </div>
      )}
      {!hasMore && items.length > 0 && <div className="virtual-list-footer">{tx(language, 'Alle Fundstellen geladen', 'All findings loaded')}</div>}
    </div>
  );
}

interface ServerTopCallListProps {
  items: ServerTopCallSummaryRow[];
  calls: ServerTopCallRow[];
  dashboard: ServerTopCallDashboardRow[];
  waitAnalysis: ServerTopCallWaitAnalysis | null;
  totalCount: number | null;
  isLoading: boolean;
  hasMore: boolean;
  language: UiLanguage;
  onLoadMore: () => Promise<void>;
  onItemClick: (item: ServerTopCallSummaryRow) => void;
  onSendToAiChat?: (prompt: string) => void;
}

function metricMs(value: number | null | undefined, language: UiLanguage) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?';
  if (value >= 1000) return `${(value / 1000).toLocaleString(language === 'en' ? 'en-US' : 'de-DE', { maximumFractionDigits: 2 })} s`;
  return `${value.toLocaleString(language === 'en' ? 'en-US' : 'de-DE', { maximumFractionDigits: 0 })} ms`;
}

function metricPercent(value: number | null | undefined, language: UiLanguage) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '0 %';
  return `${value.toLocaleString(language === 'en' ? 'en-US' : 'de-DE', { maximumFractionDigits: 1 })} %`;
}

function localizeTopCallType(type: string | null | undefined, language: UiLanguage) {
  const value = type || 'Unmatched';
  if (language === 'en') return value;
  const labels: Record<string, string> = {
    BaseTable: 'Tabelle',
    Field: 'Feld',
    Layout: 'Layout',
    Script: 'Script',
    Unmatched: 'Nicht gematcht',
  };
  return labels[value] || value;
}

function localizeServerLogMetric(metric: ServerTopCallDashboardRow, language: UiLanguage) {
  if (language === 'en') return metric.Metric_Label;
  const labels: Record<string, string> = {
    top_call_rows: 'TopCall-Zeilen',
    matched_rows: 'Gematchte TopCall-Zeilen',
    layout_targets: 'Layout-Ziele',
    field_targets: 'Feld-Ziele',
    script_targets: 'Script-Ziele',
    base_table_targets: 'Tabellen-Ziele',
  };
  return labels[metric.Metric_Key] || metric.Metric_Label;
}

function ServerTopCallTimeBars({
  title,
  rows,
  language,
  topOnly = false,
}: {
  title: string;
  rows: ServerTopCallTimeProfileRow[];
  language: UiLanguage;
  topOnly?: boolean;
}) {
  const displayRows = topOnly
    ? [...rows].sort((a, b) => b.Wait_Time_Microseconds - a.Wait_Time_Microseconds).slice(0, 8)
    : rows;

  return (
    <div className="server-log-time-profile">
      <h3>{title}</h3>
      {displayRows.map((row) => (
        <div key={`${row.Bucket_Type}-${row.Time_Bucket_Order}`} className="server-log-time-row">
          <span className="server-log-time-label">{language === 'en' ? row.Time_Bucket_Label_EN : row.Time_Bucket_Label_DE}</span>
          <span className="server-log-time-bar-track" aria-hidden="true">
            <span
              className="server-log-time-bar"
              style={{ width: `${Math.max(0, Math.min(100, row.Wait_Share_Percent || 0))}%` }}
            />
          </span>
          <span className="server-log-time-value">
            {metricMs(row.Wait_Time_Milliseconds, language)} · {metricPercent(row.Wait_Share_Percent, language)} · {formatCount(row.Call_Count, language)}
          </span>
        </div>
      ))}
      {displayRows.length === 0 && <div className="muted">{tx(language, 'Keine Zeitdaten vorhanden', 'No time data available')}</div>}
    </div>
  );
}

function ServerTopCallOperationBars({
  rows,
  language,
}: {
  rows: ServerTopCallOperationProfileRow[];
  language: UiLanguage;
}) {
  const maxTotal = Math.max(...rows.map(row => row.Total_Elapsed_Milliseconds || 0), 1);
  const displayRows = rows.slice(0, 10);

  return (
    <div className="server-log-operation-profile">
      <h3>{tx(language, 'Operationen', 'Operations')}</h3>
      {displayRows.map((row) => {
        const width = Math.max(2, Math.min(100, ((row.Total_Elapsed_Milliseconds || 0) / maxTotal) * 100));
        return (
          <div key={row.Operation} className="server-log-operation-row">
            <span className="server-log-operation-label">{row.Operation}</span>
            <span className="server-log-operation-bar-track" aria-hidden="true">
              <span className="server-log-operation-bar" style={{ width: `${width}%` }} />
            </span>
            <span className="server-log-operation-value">
              {metricMs(row.Total_Elapsed_Milliseconds, language)} · {formatCount(row.Call_Count, language)} · max {metricMs(row.Max_Elapsed_Milliseconds, language)}
            </span>
          </div>
        );
      })}
      {displayRows.length === 0 && <div className="muted">{tx(language, 'Keine Operationen vorhanden', 'No operations available')}</div>}
    </div>
  );
}

function ServerTopCallTimelineChart({
  rows,
  language,
}: {
  rows: ServerTopCallTimelineRow[];
  language: UiLanguage;
}) {
  const maxTotal = Math.max(...rows.map(row => row.Total_Elapsed_Milliseconds || 0), 1);
  const maxBars = 96;
  const step = rows.length > maxBars ? Math.ceil(rows.length / maxBars) : 1;
  const displayRows = rows.filter((_, index) => index % step === 0).slice(0, maxBars);
  const strongest = [...rows].sort((a, b) => b.Total_Elapsed_Milliseconds - a.Total_Elapsed_Milliseconds)[0];

  return (
    <div className="server-log-timeline-profile">
      <div className="server-log-section-head">
        <h3>{tx(language, 'Timeline', 'Timeline')}</h3>
        {strongest && (
          <span>
            {tx(language, 'Spitze', 'Peak')}: <strong>{strongest.Bucket_Label}</strong> · {metricMs(strongest.Total_Elapsed_Milliseconds, language)}
          </span>
        )}
      </div>
      <div className="server-log-timeline-bars" role="img" aria-label={tx(language, 'TopCallStats-Zeitverlauf', 'TopCallStats timeline')}>
        {displayRows.map((row) => {
          const height = Math.max(4, Math.min(100, ((row.Total_Elapsed_Milliseconds || 0) / maxTotal) * 100));
          return (
            <span
              key={`${row.Bucket_Start_Text}-${row.Bucket_Granularity}`}
              className="server-log-timeline-bar"
              style={{ height: `${height}%` }}
              title={`${row.Bucket_Label}: ${metricMs(row.Total_Elapsed_Milliseconds, language)} · ${formatCount(row.Call_Count, language)} calls`}
            />
          );
        })}
      </div>
      <div className="server-log-timeline-axis">
        <span>{displayRows[0]?.Bucket_Label || ''}</span>
        <span>{displayRows[displayRows.length - 1]?.Bucket_Label || ''}</span>
      </div>
      {rows.length > displayRows.length && (
        <div className="server-log-transparency">
          {tx(language, `Anzeige komprimiert ${formatCount(rows.length, language)} Zeitpunkte auf ${formatCount(displayRows.length, language)} Balken.`, `Display compresses ${formatCount(rows.length, language)} time points into ${formatCount(displayRows.length, language)} bars.`)}
        </div>
      )}
    </div>
  );
}

function ServerTopCallRawRows({
  calls,
  language,
}: {
  calls: ServerTopCallRow[];
  language: UiLanguage;
}) {
  const rows = calls.slice(0, 12);
  if (!rows.length) return null;

  return (
    <details className="server-log-raw-panel">
      <summary>
        <span>{tx(language, 'Langsamste Einzelzeilen', 'Slowest log rows')}</span>
        <strong>{formatCount(rows.length, language)}</strong>
      </summary>
      <div className="server-log-raw-list">
        {rows.map((row) => (
          <div key={`${row.Log_File}-${row.Row_Number}`} className="server-log-raw-row">
            <span className="server-log-raw-primary">
              <strong>{row.Operation || tx(language, '(ohne Operation)', '(without operation)')}</strong>
              <span>{row.Target || row.Object_Name || tx(language, '(ohne Ziel)', '(without target)')}</span>
            </span>
            <span className="server-log-runtime-row">
              <span>{tx(language, 'Gesamt', 'Total')}: <strong>{metricMs((row.Total_Elapsed_Microseconds || 0) / 1000, language)}</strong></span>
              <span>{tx(language, 'Wait', 'Wait')}: <strong>{metricMs((row.Wait_Time_Microseconds || 0) / 1000, language)}</strong></span>
              <span>{tx(language, 'I/O', 'I/O')}: <strong>{metricMs((row.IO_Time_Microseconds || 0) / 1000, language)}</strong></span>
            </span>
            <span className="quality-meta">
              {row.Timestamp_Text || ''}
              {row.Client_Name ? ` · ${row.Client_Name}` : ''}
              {row.Object_Name ? ` · ${localizeTopCallType(row.Object_Type, language)}: ${row.Object_Name}` : ''}
              {row.Row_Number ? ` · row ${row.Row_Number}` : ''}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function buildServerLogAiPrompt({
  items,
  waitAnalysis,
  calls,
  language,
}: {
  items: ServerTopCallSummaryRow[];
  waitAnalysis: ServerTopCallWaitAnalysis | null;
  calls: ServerTopCallRow[];
  language: UiLanguage;
}) {
  const hotspots = (waitAnalysis?.hotspots || []).slice(0, 8)
    .map((item, index) => `${index + 1}. ${localizeTopCallType(item.Object_Type, language)} ${item.Object_Name} (${item.File_Name}) - wait ${metricMs(item.Wait_Time_Milliseconds, language)}, total ${metricMs(item.Total_Elapsed_Milliseconds, language)}, calls ${formatCount(item.Call_Count, language)}`)
    .join('\n');
  const operations = (waitAnalysis?.by_operation || []).slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.Operation} - total ${metricMs(item.Total_Elapsed_Milliseconds, language)}, avg ${metricMs(item.Avg_Elapsed_Milliseconds, language)}, calls ${formatCount(item.Call_Count, language)}`)
    .join('\n');
  const slowRows = calls.slice(0, 8)
    .map((item, index) => `${index + 1}. ${item.Timestamp_Text || ''} ${item.Operation || ''} ${item.Target || item.Object_Name || ''} - total ${metricMs((item.Total_Elapsed_Microseconds || 0) / 1000, language)}, wait ${metricMs((item.Wait_Time_Microseconds || 0) / 1000, language)}`)
    .join('\n');

  return tx(
    language,
    [
      'Bitte analysiere diese FileMaker-Server-TopCallStats-Auswertung und gib konkrete Optimierungs- und Refactoring-Vorschläge.',
      '',
      `Geladene aggregierte Ziele: ${formatCount(items.length, language)}`,
      '',
      'Hotspots nach Wait Time:',
      hotspots || '- keine Hotspots',
      '',
      'Operationen mit höchster Gesamtlaufzeit:',
      operations || '- keine Operationen',
      '',
      'Langsamste Einzelzeilen:',
      slowRows || '- keine Einzelzeilen',
      '',
      'Bitte liefere priorisierte Maßnahmen: kurzfristige Checks, betroffene Scripts/Layouts/Felder, mögliche Index-/Relationship-/Layout-Probleme, und welche DDR-Objekte ich zuerst prüfen sollte.',
    ].join('\n'),
    [
      'Please analyze this FileMaker Server TopCallStats result and provide concrete optimization and refactoring suggestions.',
      '',
      `Loaded aggregated targets: ${formatCount(items.length, language)}`,
      '',
      'Hotspots by wait time:',
      hotspots || '- no hotspots',
      '',
      'Operations with highest total runtime:',
      operations || '- no operations',
      '',
      'Slowest individual log rows:',
      slowRows || '- no log rows',
      '',
      'Please provide prioritized actions: short-term checks, affected scripts/layouts/fields, possible index/relationship/layout issues, and which DDR objects should be inspected first.',
    ].join('\n')
  );
}

function ServerTopCallWaitOverview({
  waitAnalysis,
  language,
}: {
  waitAnalysis: ServerTopCallWaitAnalysis | null;
  language: UiLanguage;
}) {
  const hotspots = waitAnalysis?.hotspots || [];
  const topHotspot = hotspots[0];
  const strongestWeekday = [...(waitAnalysis?.by_weekday || [])].sort((a, b) => b.Wait_Time_Microseconds - a.Wait_Time_Microseconds)[0];
  const strongestHour = [...(waitAnalysis?.by_hour || [])].sort((a, b) => b.Wait_Time_Microseconds - a.Wait_Time_Microseconds)[0];

  if (!topHotspot && !strongestWeekday && !strongestHour) return null;

  return (
    <section className="server-log-wait-overview">
      <div className="server-log-overview-header">
        <div>
          <h2>{tx(language, 'Wartezeit-Hotspots', 'Wait-time hotspots')}</h2>
          <p>
            {tx(
              language,
              'Basis: Summe der Wait Time aus TopCallStats, gruppiert nach gematchtem Objekt oder Log-Ziel.',
              'Basis: sum of Wait Time from TopCallStats, grouped by matched object or log target.'
            )}
          </p>
        </div>
        {topHotspot && (
          <div className="server-log-top-wait">
            <span>{tx(language, 'Größte Summe', 'Largest total')}</span>
            <strong>{metricMs(topHotspot.Wait_Time_Milliseconds, language)}</strong>
            <small>
              {localizeTopCallType(topHotspot.Object_Type, language)} · {topHotspot.Object_Name} · {metricPercent(topHotspot.Wait_Share_Percent, language)}
            </small>
          </div>
        )}
      </div>

      <div className="server-log-wait-cards">
        {hotspots.slice(0, 5).map((hotspot, index) => (
          <div key={`${hotspot.Object_Type}-${hotspot.File_Name}-${hotspot.Object_UUID || hotspot.Object_Name}`} className="server-log-wait-card">
            <span className="server-log-rank">#{index + 1}</span>
            <strong>{hotspot.Object_Name}</strong>
            <span>{localizeTopCallType(hotspot.Object_Type, language)} · {hotspot.File_Name}</span>
            <span className="server-log-runtime-row">
              <span>{tx(language, 'Wait', 'Wait')}: <strong>{metricMs(hotspot.Wait_Time_Milliseconds, language)}</strong></span>
              <span>{tx(language, 'Anteil', 'Share')}: <strong>{metricPercent(hotspot.Wait_Share_Percent, language)}</strong></span>
              <span>{tx(language, 'Calls', 'Calls')}: <strong>{formatCount(hotspot.Call_Count, language)}</strong></span>
            </span>
          </div>
        ))}
      </div>

      <div className="server-log-time-summary">
        {strongestWeekday && (
          <span>
            {tx(language, 'Stärkster Wochentag', 'Strongest weekday')}: <strong>{language === 'en' ? strongestWeekday.Time_Bucket_Label_EN : strongestWeekday.Time_Bucket_Label_DE}</strong>
            {' '}({metricPercent(strongestWeekday.Wait_Share_Percent, language)})
          </span>
        )}
        {strongestHour && (
          <span>
            {tx(language, 'Stärkste Stunde', 'Strongest hour')}: <strong>{language === 'en' ? strongestHour.Time_Bucket_Label_EN : strongestHour.Time_Bucket_Label_DE}</strong>
            {' '}({metricPercent(strongestHour.Wait_Share_Percent, language)})
          </span>
        )}
      </div>

      <div className="server-log-time-grid">
        <ServerTopCallTimeBars title={tx(language, 'Nach Wochentag', 'By weekday')} rows={waitAnalysis?.by_weekday || []} language={language} />
        <ServerTopCallTimeBars title={tx(language, 'Stärkste Uhrzeiten', 'Strongest hours')} rows={waitAnalysis?.by_hour || []} language={language} topOnly />
      </div>

      <p className="server-log-transparency">
        {tx(
          language,
          'Transparenz: Script-Ziele werden nur eindeutig gematcht, wenn TopCallStats eine Script-ID enthält; reine Datei-Ziele bleiben als nicht gematcht sichtbar.',
          'Transparency: script targets are matched only when TopCallStats contains a script ID; file-only targets remain visible as unmatched.'
        )}
      </p>
    </section>
  );
}

function ServerTopCallList({
  items,
  calls,
  dashboard,
  waitAnalysis,
  totalCount,
  isLoading,
  hasMore,
  language,
  onLoadMore,
  onItemClick,
  onSendToAiChat,
}: ServerTopCallListProps) {
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const groupedItems = useMemo(() => {
    const groups = new Map<string, ServerTopCallSummaryRow[]>();
    for (const item of items) {
      const key = item.Object_Type || 'Unmatched';
      const group = groups.get(key) || [];
      group.push(item);
      groups.set(key, group);
    }
    return [...groups.entries()]
      .map(([type, groupItems]) => ({
        type,
        items: groupItems,
        waitMs: groupItems.reduce((sum, item) => sum + (item.Wait_Time_Milliseconds || 0), 0),
        totalMs: groupItems.reduce((sum, item) => sum + (item.Total_Elapsed_Milliseconds || 0), 0),
      }))
      .sort((a, b) => b.waitMs - a.waitMs || a.type.localeCompare(b.type));
  }, [items]);

  const toggleType = useCallback((type: string) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  return (
    <div className="server-log-results">
      <div className="server-log-dashboard">
        {dashboard.map((metric) => (
          <div key={metric.Metric_Key} className="server-log-metric">
            <span>{localizeServerLogMetric(metric, language)}</span>
            <strong>{formatCount(metric.Metric_Value, language)}</strong>
          </div>
        ))}
      </div>

      <ServerTopCallWaitOverview waitAnalysis={waitAnalysis} language={language} />

      <section className="server-log-explorer">
        <div className="server-log-section-head">
          <div>
            <h2>{tx(language, 'TopCallStats Explorer', 'TopCallStats explorer')}</h2>
            <p>
              {tx(
                language,
                'Zeitverlauf, Operationen und Einzelzeilen aus demselben gefilterten Log-Ausschnitt.',
                'Timeline, operations, and individual rows from the same filtered log slice.'
              )}
            </p>
          </div>
          {onSendToAiChat && (
            <button
              type="button"
              className="script-search-load-more server-log-ai-button"
              onClick={() => onSendToAiChat(buildServerLogAiPrompt({ items, waitAnalysis, calls, language }))}
            >
              {tx(language, 'An AI-Chat übergeben', 'Send to AI chat')}
            </button>
          )}
        </div>
        <div className="server-log-explorer-grid">
          <ServerTopCallTimelineChart rows={waitAnalysis?.timeline || []} language={language} />
          <ServerTopCallOperationBars rows={waitAnalysis?.by_operation || []} language={language} />
        </div>
        <ServerTopCallRawRows calls={calls} language={language} />
      </section>

      {totalCount !== null && (
        <div className="virtual-list-header">
          {formatCount(totalCount, language)} {tx(language, 'Top-Call-Ziele gefunden', 'top-call targets found')}
          {items.length < totalCount && (
            <span className="loaded-count">
              ({formatCount(items.length, language)} {tx(language, 'geladen', 'loaded')})
            </span>
          )}
        </div>
      )}

      <ul className="quality-list server-log-list">
        {groupedItems.map((group) => {
          const isOpen = expandedTypes.has(group.type);
          return (
            <li key={group.type} className="server-log-accordion-group">
              <button type="button" className="server-log-accordion-header" onClick={() => toggleType(group.type)} aria-expanded={isOpen}>
                <span className="usage-bucket-icon">{isOpen ? '-' : '+'}</span>
                <strong>{localizeTopCallType(group.type, language)}</strong>
                <span>{formatCount(group.items.length, language)} {tx(language, 'geladen', 'loaded')}</span>
                <span>{tx(language, 'Wait', 'Wait')}: {metricMs(group.waitMs, language)}</span>
                <span>{tx(language, 'Summe', 'Total')}: {metricMs(group.totalMs, language)}</span>
              </button>
              {isOpen && (
                <ul className="server-log-accordion-items">
                  {group.items.map((item) => (
                    <li key={`${item.Object_Type}-${item.File_Name}-${item.Object_UUID || item.Object_Name}`} className="quality-row">
                      <button
                        type="button"
                        className="quality-item server-log-item"
                        onClick={() => onItemClick(item)}
                        disabled={!item.Object_UUID}
                      >
                        <span className="quality-item-top">
                          <strong className="quality-name">{item.Object_Name}</strong>
                          <span className="to-usage-group-pill">{localizeTopCallType(item.Object_Type, language)}</span>
                          <span className={`credential-risk ${item.Match_Confidence === 'high' ? 'info' : 'medium'}`}>
                            {item.Match_Confidence === 'high' ? tx(language, 'gematcht', 'matched') : tx(language, 'nicht gematcht', 'unmatched')}
                          </span>
                        </span>

                        <span className="quality-meta">
                          {item.File_Name}
                          {item.Related_TO_Name ? ` · TO ${item.Related_TO_Name}` : ''}
                          {item.Related_Table_Name ? ` · ${item.Related_Table_Name}` : ''}
                        </span>

                        <span className="server-log-runtime-row">
                          <span>{tx(language, 'Summe', 'Total')}: <strong>{metricMs(item.Total_Elapsed_Milliseconds, language)}</strong></span>
                          <span>{tx(language, 'Max', 'Max')}: <strong>{metricMs(item.Max_Elapsed_Milliseconds, language)}</strong></span>
                          <span>{tx(language, 'Wait', 'Wait')}: <strong>{metricMs(item.Wait_Time_Milliseconds, language)}</strong></span>
                          <span>{tx(language, 'I/O', 'I/O')}: <strong>{metricMs(item.IO_Time_Milliseconds, language)}</strong></span>
                          <span>{tx(language, 'Calls', 'Calls')}: <strong>{formatCount(item.Call_Count, language)}</strong></span>
                        </span>

                        {item.Operations && <span className="quality-detail">{item.Operations}</span>}
                        <span className="quality-detail">{item.Optimization_Hint}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      {isLoading && (
        <div className="virtual-list-footer">
          {tx(language, 'Lade Server-Logs...', 'Loading server logs...')}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(language, 'Keine Server-Log-Daten gefunden. Importiere zuerst TopCallStats.log mit tools/import_server_logs.ps1.', 'No server log data found. Import TopCallStats.log with tools/import_server_logs.ps1 first.')}
        </div>
      )}

      {!isLoading && hasMore && (
        <div className="virtual-list-footer">
          <button type="button" className="script-search-load-more" onClick={() => { void onLoadMore(); }}>
            {tx(language, 'Weitere Ziele laden', 'Load more targets')}
          </button>
        </div>
      )}
    </div>
  );
}

function SearchView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { saveScrollPosition, restoreScrollPosition } = useScrollRestore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Initialize filter states from URL params (for deep linking & back-navigation)
  const [mode, setMode] = useState<ViewMode>(urlToMode(searchParams.get('mode')));
  const [searchName, setSearchName] = useState(searchParams.get('q') || '');
  const [selectedFile, setSelectedFile] = useState<string>(searchParams.get('file') || '');
  const [objectType, setObjectType] = useState<string>(searchParams.get('type') || '');
  const [treeSubtype, setTreeSubtype] = useState<FolderTreeSubtype>(urlToSubtype(searchParams.get('subtype')));
  const [toUsageUnusedOnly, setToUsageUnusedOnly] = useState(searchParams.get('unused') === '1' || searchParams.get('unused_only') === 'true');
  const [objectUsageType, setObjectUsageType] = useState(searchParams.get('usage_type') || 'Script');
  const [objectUsageMaxUsage, setObjectUsageMaxUsage] = useState(searchParams.get('max_usage') || '2');
  const [credentialCategory, setCredentialCategory] = useState(searchParams.get('category') || '');
  const [credentialRisk, setCredentialRisk] = useState(searchParams.get('risk') || '');
  const [credentialSecretOnly, setCredentialSecretOnly] = useState(searchParams.get('secret_only') === '1');
  const [credentialRevealValues, setCredentialRevealValues] = useState(searchParams.get('reveal') !== '0');
  const [apiIntegrationType, setApiIntegrationType] = useState(urlToMode(searchParams.get('mode')) === 'api-integrations' ? searchParams.get('integration_type') || '' : '');
  const [apiIntegrationRisk, setApiIntegrationRisk] = useState(urlToMode(searchParams.get('mode')) === 'api-integrations' ? searchParams.get('risk') || '' : '');
  const [apiIntegrationSecretOnly, setApiIntegrationSecretOnly] = useState(urlToMode(searchParams.get('mode')) === 'api-integrations' && searchParams.get('secret_only') === '1');
  const [layoutQualityCategory, setLayoutQualityCategory] = useState(urlToMode(searchParams.get('mode')) === 'layout-quality' ? searchParams.get('category') || '' : '');
  const [layoutQualitySeverity, setLayoutQualitySeverity] = useState(urlToMode(searchParams.get('mode')) === 'layout-quality' ? searchParams.get('severity') || '' : '');
  const [qualityArea, setQualityArea] = useState(urlToMode(searchParams.get('mode')) === 'quality' ? searchParams.get('area') || '' : '');
  const [qualityCategory, setQualityCategory] = useState(urlToMode(searchParams.get('mode')) === 'quality' ? searchParams.get('category') || '' : '');
  const [qualitySeverity, setQualitySeverity] = useState(urlToMode(searchParams.get('mode')) === 'quality' ? searchParams.get('severity') || '' : '');
  const [qualityObjectType, setQualityObjectType] = useState(urlToMode(searchParams.get('mode')) === 'quality' ? searchParams.get('quality_type') || '' : '');
  const [serverLogObjectType, setServerLogObjectType] = useState(urlToMode(searchParams.get('mode')) === 'server-logs' ? searchParams.get('log_type') || '' : '');
  const [serverLogMatchedOnly, setServerLogMatchedOnly] = useState(urlToMode(searchParams.get('mode')) === 'server-logs' && searchParams.get('matched_only') === '1');
  const [serverLogMinElapsed, setServerLogMinElapsed] = useState(urlToMode(searchParams.get('mode')) === 'server-logs' ? searchParams.get('min_elapsed_ms') || '' : '');
  const [scriptFolderSortMode, setScriptFolderSortMode] = useState<'structure' | 'alpha'>(searchParams.get('folder_sort') === 'alpha' ? 'alpha' : 'structure');
  const [selectedScriptFolders, setSelectedScriptFolders] = useState<string[]>(
    (urlToMode(searchParams.get('mode')) === 'script-content' ? searchParams.get('folders') || '' : '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  );
  const [searchAccordionEnabled, setSearchAccordionEnabled] = useState(searchParams.get('accordion') !== '0');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [dashboardRows, setDashboardRows] = useState<QualityDashboardMetricRow[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(getUiLanguage);
  const [localizationRows, setLocalizationRows] = useState<LocalizationLabelRow[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>((searchParams.get('sort') as SortOption) || 'standard');
  const [groupBy, setGroupBy] = useState<GroupOption>((searchParams.get('group') as GroupOption) || 'none');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Ref to track if search input should maintain focus
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wasFocusedRef = useRef(false);

  // Debounce search/filter input (300ms delay)
  const debouncedSearchName = useDebounce(searchName, 300);
  const hasSearchQuery = debouncedSearchName.trim().length > 0;
  const localizationMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of localizationRows) {
      if (row.Language_Code === uiLanguage) {
        map.set(row.Label_Key, row.Label_Text);
      }
    }
    return map;
  }, [localizationRows, uiLanguage]);
  const labelFor = useCallback((key: string, fallback: string) => localizationMap.get(key) || fallback, [localizationMap]);
  const isSearchAccordionActive =
    mode === 'search' &&
    searchAccordionEnabled &&
    !hasSearchQuery &&
    !SEARCH_ACCORDION_EXCLUDED_TYPES.has(objectType);

  // Use infinite search hook (only relevant in 'search' mode, but called unconditionally
  // to keep hook order stable; the result is simply ignored when mode === 'tree').
  const { items, loading, loadingMore, hasMore, totalCount, error, loadMore } = useInfiniteSearch({
    searchName: debouncedSearchName || '*',
    selectedFile,
    objectType,
    enabled: mode === 'search' && !isSearchAccordionActive,
  });

  const {
    items: scriptSearchItems,
    loading: scriptSearchLoading,
    loadingMore: scriptSearchLoadingMore,
    hasMore: scriptSearchHasMore,
    totalCount: scriptSearchTotalCount,
    error: scriptSearchError,
    minQueryLength: scriptSearchMinQueryLength,
    loadMore: loadMoreScriptResults,
  } = useInfiniteScriptContentSearch({
    query: debouncedSearchName,
    selectedFile,
    selectedFolders: selectedScriptFolders,
    enabled: mode === 'script-content',
  });

  const {
    items: toUsageItems,
    loading: toUsageLoading,
    loadingMore: toUsageLoadingMore,
    hasMore: toUsageHasMore,
    totalCount: toUsageTotalCount,
    error: toUsageError,
    loadMore: loadMoreToUsage,
  } = useInfiniteTableOccurrenceUsage({
    query: debouncedSearchName,
    selectedFile,
    unusedOnly: toUsageUnusedOnly,
    enabled: mode === 'to-usage',
  });

  const {
    items: objectUsageItems,
    loading: objectUsageLoading,
    loadingMore: objectUsageLoadingMore,
    hasMore: objectUsageHasMore,
    totalCount: objectUsageTotalCount,
    error: objectUsageError,
    loadMore: loadMoreObjectUsage,
  } = useInfiniteObjectUsage({
    query: debouncedSearchName,
    selectedFile,
    objectType: objectUsageType,
    maxUsage: objectUsageMaxUsage,
    enabled: mode === 'object-usage',
  });

  const {
    items: credentialItems,
    loading: credentialLoading,
    loadingMore: credentialLoadingMore,
    hasMore: credentialHasMore,
    totalCount: credentialTotalCount,
    error: credentialError,
    loadMore: loadMoreCredentials,
  } = useInfiniteCredentialFindings({
    query: debouncedSearchName,
    selectedFile,
    category: credentialCategory,
    risk: credentialRisk,
    secretOnly: credentialSecretOnly,
    enabled: mode === 'credentials',
  });

  const {
    items: apiIntegrationItems,
    summary: apiIntegrationSummary,
    loading: apiIntegrationLoading,
    loadingMore: apiIntegrationLoadingMore,
    hasMore: apiIntegrationHasMore,
    totalCount: apiIntegrationTotalCount,
    error: apiIntegrationError,
    loadMore: loadMoreApiIntegrations,
  } = useInfiniteApiIntegrations({
    query: debouncedSearchName,
    selectedFile,
    type: apiIntegrationType,
    risk: apiIntegrationRisk,
    secretOnly: apiIntegrationSecretOnly,
    enabled: mode === 'api-integrations',
  });

  const {
    items: layoutQualityItems,
    loading: layoutQualityLoading,
    loadingMore: layoutQualityLoadingMore,
    hasMore: layoutQualityHasMore,
    totalCount: layoutQualityTotalCount,
    error: layoutQualityError,
    loadMore: loadMoreLayoutQuality,
  } = useInfiniteLayoutObjectQuality({
    query: debouncedSearchName,
    selectedFile,
    category: layoutQualityCategory,
    severity: layoutQualitySeverity,
    enabled: mode === 'layout-quality',
  });

  const {
    items: qualityItems,
    loading: qualityLoading,
    loadingMore: qualityLoadingMore,
    hasMore: qualityHasMore,
    totalCount: qualityTotalCount,
    error: qualityError,
    loadMore: loadMoreQuality,
  } = useInfiniteQualityFindings({
    query: debouncedSearchName,
    selectedFile,
    area: qualityArea,
    category: qualityCategory,
    severity: qualitySeverity,
    objectType: qualityObjectType,
    enabled: mode === 'quality',
  });

  const {
    summary: serverLogSummary,
    calls: serverLogCalls,
    dashboard: serverLogDashboard,
    waitAnalysis: serverLogWaitAnalysis,
    loading: serverLogLoading,
    loadingMore: serverLogLoadingMore,
    hasMore: serverLogHasMore,
    totalCount: serverLogTotalCount,
    error: serverLogError,
    loadMore: loadMoreServerLogs,
  } = useInfiniteServerTopCalls({
    query: debouncedSearchName,
    selectedFile,
    objectType: serverLogObjectType,
    matchedOnly: serverLogMatchedOnly,
    minElapsedMs: serverLogMinElapsed ? Number(serverLogMinElapsed) : undefined,
    enabled: mode === 'server-logs',
  });

  // Sync filter state to URL (replace to avoid polluting history)
  useEffect(() => {
    const params = new URLSearchParams();
    if (mode === 'dashboard') {
      params.set('mode', 'dashboard');
    } else if (mode === 'tree') {
      params.set('mode', 'tree');
      params.set('subtype', TREE_SUBTYPE_URL[treeSubtype]);
      if (selectedFile) params.set('file', selectedFile);
      if (debouncedSearchName) params.set('q', debouncedSearchName);
    } else if (mode === 'script-content') {
      params.set('mode', 'scripts');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (selectedScriptFolders.length > 0) params.set('folders', selectedScriptFolders.join(','));
      if (scriptFolderSortMode === 'alpha') params.set('folder_sort', 'alpha');
    } else if (mode === 'to-usage') {
      params.set('mode', 'to-usage');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (toUsageUnusedOnly) params.set('unused', '1');
    } else if (mode === 'object-usage') {
      params.set('mode', 'object-usage');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (objectUsageType) params.set('usage_type', objectUsageType);
      if (objectUsageMaxUsage !== '') params.set('max_usage', objectUsageMaxUsage);
    } else if (mode === 'credentials') {
      params.set('mode', 'credentials');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (credentialCategory) params.set('category', credentialCategory);
      if (credentialRisk) params.set('risk', credentialRisk);
      if (credentialSecretOnly) params.set('secret_only', '1');
      if (!credentialRevealValues) params.set('reveal', '0');
    } else if (mode === 'api-integrations') {
      params.set('mode', 'api-integrations');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (apiIntegrationType) params.set('integration_type', apiIntegrationType);
      if (apiIntegrationRisk) params.set('risk', apiIntegrationRisk);
      if (apiIntegrationSecretOnly) params.set('secret_only', '1');
    } else if (mode === 'layout-quality') {
      params.set('mode', 'layout-quality');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (layoutQualityCategory) params.set('category', layoutQualityCategory);
      if (layoutQualitySeverity) params.set('severity', layoutQualitySeverity);
    } else if (mode === 'quality') {
      params.set('mode', 'quality');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (qualityArea) params.set('area', qualityArea);
      if (qualityCategory) params.set('category', qualityCategory);
      if (qualitySeverity) params.set('severity', qualitySeverity);
      if (qualityObjectType) params.set('quality_type', qualityObjectType);
    } else if (mode === 'server-logs') {
      params.set('mode', 'server-logs');
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (serverLogObjectType) params.set('log_type', serverLogObjectType);
      if (serverLogMatchedOnly) params.set('matched_only', '1');
      if (serverLogMinElapsed) params.set('min_elapsed_ms', serverLogMinElapsed);
    } else if (mode === 'ai-chat') {
      params.set('mode', 'ai-chat');
    } else {
      if (debouncedSearchName) params.set('q', debouncedSearchName);
      if (selectedFile) params.set('file', selectedFile);
      if (objectType) params.set('type', objectType);
      if (sortBy !== 'standard') params.set('sort', sortBy);
      if (groupBy !== 'none') params.set('group', groupBy);
      if (!searchAccordionEnabled) params.set('accordion', '0');
    }
    setSearchParams(params, { replace: true });
  }, [mode, treeSubtype, debouncedSearchName, selectedFile, objectType, sortBy, groupBy, toUsageUnusedOnly, objectUsageType, objectUsageMaxUsage, credentialCategory, credentialRisk, credentialSecretOnly, credentialRevealValues, apiIntegrationType, apiIntegrationRisk, apiIntegrationSecretOnly, layoutQualityCategory, layoutQualitySeverity, qualityArea, qualityCategory, qualitySeverity, qualityObjectType, serverLogObjectType, serverLogMatchedOnly, serverLogMinElapsed, selectedScriptFolders, scriptFolderSortMode, searchAccordionEnabled, setSearchParams]);

  // Load available files on mount
  useEffect(() => {
    async function loadFiles() {
      try {
        const response = await api.info();
        if (response.success && response.data?.solution?.files) {
          setFiles(response.data.solution.files);
        }
      } catch (err) {
        console.error('Fehler beim Laden der Dateien:', err);
      }
    }
    loadFiles();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem('fm-lab-ui-language', uiLanguage);
    } catch {
      // Local storage may be unavailable; the in-memory language still works.
    }
  }, [uiLanguage]);

  useEffect(() => {
    let cancelled = false;
    async function loadLocalization() {
      try {
        const response = await getLocalizationLabels();
        if (!cancelled) {
          setLocalizationRows(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        console.error('Fehler beim Laden der Lokalisierung:', err);
      }
    }
    void loadLocalization();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode !== 'dashboard') return;
    let cancelled = false;
    async function loadDashboard() {
      setDashboardLoading(true);
      setDashboardError(null);
      try {
        const response = await getQualityDashboard();
        if (!cancelled) {
          setDashboardRows(Array.isArray(response.data) ? response.data : []);
        }
      } catch (err) {
        if (!cancelled) {
          setDashboardError(err instanceof Error ? err.message : 'Dashboard konnte nicht geladen werden');
        }
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    }
    void loadDashboard();
    return () => { cancelled = true; };
  }, [mode]);

  // Restore focus to search input after loading states change
  useEffect(() => {
    const activeLoading = mode === 'script-content'
      ? scriptSearchLoading
      : mode === 'to-usage'
        ? toUsageLoading
        : mode === 'object-usage'
          ? objectUsageLoading
          : mode === 'credentials'
            ? credentialLoading
            : mode === 'api-integrations'
              ? apiIntegrationLoading
              : mode === 'layout-quality'
                ? layoutQualityLoading
                : mode === 'quality'
                  ? qualityLoading
                  : mode === 'server-logs'
                    ? serverLogLoading
                  : loading;
    if (wasFocusedRef.current && searchInputRef.current && !activeLoading) {
      searchInputRef.current.focus();
    }
  }, [loading, mode, scriptSearchLoading, toUsageLoading, objectUsageLoading, credentialLoading, apiIntegrationLoading, layoutQualityLoading, qualityLoading, serverLogLoading]);

  // Restore scroll position when items are loaded (after back-navigation)
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (mode === 'search' && items.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('search-list', scrollContainerRef.current);
    }
    if (mode === 'script-content' && scriptSearchItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('script-search-list', scrollContainerRef.current);
    }
    if (mode === 'to-usage' && toUsageItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('to-usage-list', scrollContainerRef.current);
    }
    if (mode === 'object-usage' && objectUsageItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('object-usage-list', scrollContainerRef.current);
    }
    if (mode === 'credentials' && credentialItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('credential-list', scrollContainerRef.current);
    }
    if (mode === 'api-integrations' && apiIntegrationItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('api-integration-list', scrollContainerRef.current);
    }
    if (mode === 'layout-quality' && layoutQualityItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('layout-quality-list', scrollContainerRef.current);
    }
    if (mode === 'quality' && qualityItems.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('quality-list', scrollContainerRef.current);
    }
  }, [mode, items.length, scriptSearchItems.length, toUsageItems.length, objectUsageItems.length, credentialItems.length, apiIntegrationItems.length, layoutQualityItems.length, qualityItems.length, serverLogSummary.length, restoreScrollPosition]);

  // Reset restore flag when search params change
  useEffect(() => {
    hasRestoredRef.current = false;
  }, [debouncedSearchName, selectedFile, objectType, mode, treeSubtype, toUsageUnusedOnly, objectUsageType, objectUsageMaxUsage, credentialCategory, credentialRisk, credentialSecretOnly, apiIntegrationType, apiIntegrationRisk, apiIntegrationSecretOnly, layoutQualityCategory, layoutQualitySeverity, qualityArea, qualityCategory, qualitySeverity, qualityObjectType, serverLogObjectType, serverLogMatchedOnly, serverLogMinElapsed, selectedScriptFolders, searchAccordionEnabled]);

  // Reset expanded groups when grouping changes (all collapsed by default)
  useEffect(() => {
    setExpandedGroups(new Set());
  }, [groupBy]);

  // Sort and group items for the virtual list
  const processedRows: VirtualListRow[] = useMemo(() => {
    let sorted: FMObject[];
    if (sortBy === 'standard') {
      sorted = items;
    } else {
      sorted = [...items].sort((a, b) => {
        switch (sortBy) {
          case 'name':
            return (a.Object_Name || '').localeCompare(b.Object_Name || '', 'de');
          case 'type':
            return (a.Object_Type || '').localeCompare(b.Object_Type || '', 'de')
              || (a.Object_Name || '').localeCompare(b.Object_Name || '', 'de');
          case 'file':
            return (a.File_Name || '').localeCompare(b.File_Name || '', 'de')
              || (a.Object_Name || '').localeCompare(b.Object_Name || '', 'de');
          default:
            return 0;
        }
      });
    }

    if (groupBy === 'none') {
      return sorted.map(obj => ({ _type: 'item' as const, object: obj }));
    }

    const groups = new Map<string, FMObject[]>();
    for (const obj of sorted) {
      const key = groupBy === 'type'
        ? (obj.Object_Type || '(Unbekannt)')
        : (obj.File_Name || '(Unbekannt)');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(obj);
    }

    const sortedKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, 'de'));

    const rows: VirtualListRow[] = [];
    for (const key of sortedKeys) {
      const groupItems = groups.get(key)!;
      const isExpanded = expandedGroups.has(key);
      rows.push({ _type: 'header', groupKey: key, groupLabel: key, itemCount: groupItems.length, isExpanded });
      if (isExpanded) {
        for (const obj of groupItems) {
          rows.push({ _type: 'item', object: obj });
        }
      }
    }
    return rows;
  }, [items, sortBy, groupBy, expandedGroups]);

  // Reset scroll position when sort/group changes
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [sortBy, groupBy]);

  const handleToggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const handleItemClick = useCallback((uuid: string) => {
    saveScrollPosition('search-list', scrollContainerRef.current);
    navigate(`/object/${uuid}`);
  }, [navigate, saveScrollPosition]);

  const handleScriptResultClick = useCallback((item: ScriptContentSearchResult) => {
    saveScrollPosition('script-search-list', scrollContainerRef.current);
    navigate(`/object/${item.Script_UUID}?step=${item.Step_Number}`);
  }, [navigate, saveScrollPosition]);

  const handleTableOccurrenceUsageClick = useCallback((item: TableOccurrenceUsageRow) => {
    saveScrollPosition('to-usage-list', scrollContainerRef.current);
    navigate(`/object/${item.TO_UUID}`);
  }, [navigate, saveScrollPosition]);

  const handleObjectUsageClick = useCallback((item: ObjectUsageRow) => {
    saveScrollPosition('object-usage-list', scrollContainerRef.current);
    navigate(`/object/${item.Object_UUID}`);
  }, [navigate, saveScrollPosition]);

  const handleCredentialClick = useCallback((item: CredentialFindingRow) => {
    saveScrollPosition('credential-list', scrollContainerRef.current);
    if (item.Source_Type === 'Script' && item.Source_UUID && item.Step_Number) {
      navigate(`/object/${item.Source_UUID}?step=${item.Step_Number}`);
      return;
    }
    if (item.Source_UUID) {
      navigate(`/object/${item.Source_UUID}`);
    }
  }, [navigate, saveScrollPosition]);

  const handleApiIntegrationClick = useCallback((item: ApiIntegrationRow) => {
    saveScrollPosition('api-integration-list', scrollContainerRef.current);
    if (item.Source_Type === 'Script' && item.Source_UUID && item.Step_Number) {
      navigate(`/object/${item.Source_UUID}?step=${item.Step_Number}`);
      return;
    }
    if (item.Source_UUID) {
      navigate(`/object/${item.Source_UUID}`);
    }
  }, [navigate, saveScrollPosition]);

  const handleLayoutQualityClick = useCallback((item: LayoutObjectQualityFindingRow) => {
    saveScrollPosition('layout-quality-list', scrollContainerRef.current);
    navigate(`/layout/${item.Layout_UUID}?ref=${item.Object_UUID}`);
  }, [navigate, saveScrollPosition]);

  const handleQualityClick = useCallback((item: QualityFindingRow) => {
    saveScrollPosition('quality-list', scrollContainerRef.current);
    if (item.Object_Type === 'LayoutObject' && item.Source_UUID && item.Object_UUID) {
      navigate(`/layout/${item.Source_UUID}?ref=${item.Object_UUID}`);
      return;
    }
    if (item.Object_Type === 'Script' && item.Object_UUID && item.Step_Number) {
      navigate(`/object/${item.Object_UUID}?step=${item.Step_Number}`);
      return;
    }
    if (item.Object_UUID) {
      navigate(`/object/${item.Object_UUID}`);
    }
  }, [navigate, saveScrollPosition]);

  const handleServerTopCallClick = useCallback((item: ServerTopCallSummaryRow) => {
    if (!item.Object_UUID) return;
    if (item.Object_Type === 'Layout') {
      navigate(`/layout/${item.Object_UUID}`);
      return;
    }
    navigate(`/object/${item.Object_UUID}`);
  }, [navigate]);

  const handleSendToAiChat = useCallback((prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    try {
      window.sessionStorage.setItem(AI_CHAT_DRAFT_STORAGE_KEY, trimmed);
    } catch {
      // Wenn Session Storage blockiert ist, bleibt der Moduswechsel trotzdem nutzbar.
    }
    setMode('ai-chat');
  }, []);

  const handleDashboardMetricClick = useCallback((metric: QualityDashboardMetricRow) => {
    setSearchName('');
    setSelectedFile('');

    if (metric.Section === 'Objekte') {
      setObjectType(metric.Metric_Key);
      setSortBy('standard');
      setGroupBy('none');
      setSearchAccordionEnabled(false);
      setMode('search');
      return;
    }

    if (metric.Section === 'Qualität') {
      setQualityArea(metric.Metric_Key);
      setQualityCategory('');
      setQualitySeverity('');
      setQualityObjectType('');
      setMode('quality');
      return;
    }

    if (metric.Section === 'Layout-Prüfung') {
      setLayoutQualityCategory(metric.Metric_Key);
      setLayoutQualitySeverity('');
      setMode('layout-quality');
      return;
    }

    if (metric.Section === 'Zugangsdaten') {
      setCredentialCategory(metric.Metric_Key);
      setCredentialRisk('');
      setCredentialSecretOnly(false);
      setCredentialRevealValues(true);
      setMode('credentials');
    }
  }, []);

  const handleScriptResultsScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && scriptSearchHasMore && !scriptSearchLoading && !scriptSearchLoadingMore) {
      void loadMoreScriptResults();
    }
  }, [loadMoreScriptResults, scriptSearchHasMore, scriptSearchLoading, scriptSearchLoadingMore]);

  const handleTableOccurrenceUsageScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && toUsageHasMore && !toUsageLoading && !toUsageLoadingMore) {
      void loadMoreToUsage();
    }
  }, [loadMoreToUsage, toUsageHasMore, toUsageLoading, toUsageLoadingMore]);

  const handleObjectUsageScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && objectUsageHasMore && !objectUsageLoading && !objectUsageLoadingMore) {
      void loadMoreObjectUsage();
    }
  }, [loadMoreObjectUsage, objectUsageHasMore, objectUsageLoading, objectUsageLoadingMore]);

  const handleCredentialScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && credentialHasMore && !credentialLoading && !credentialLoadingMore) {
      void loadMoreCredentials();
    }
  }, [loadMoreCredentials, credentialHasMore, credentialLoading, credentialLoadingMore]);

  const handleApiIntegrationScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && apiIntegrationHasMore && !apiIntegrationLoading && !apiIntegrationLoadingMore) {
      void loadMoreApiIntegrations();
    }
  }, [loadMoreApiIntegrations, apiIntegrationHasMore, apiIntegrationLoading, apiIntegrationLoadingMore]);

  const handleLayoutQualityScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && layoutQualityHasMore && !layoutQualityLoading && !layoutQualityLoadingMore) {
      void loadMoreLayoutQuality();
    }
  }, [loadMoreLayoutQuality, layoutQualityHasMore, layoutQualityLoading, layoutQualityLoadingMore]);

  const handleQualityScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (distanceToBottom < 240 && qualityHasMore && !qualityLoading && !qualityLoadingMore) {
      void loadMoreQuality();
    }
  }, [loadMoreQuality, qualityHasMore, qualityLoading, qualityLoadingMore]);

  const isTreeMode = mode === 'tree';
  const isScriptSearchMode = mode === 'script-content';
  const isToUsageMode = mode === 'to-usage';
  const isObjectUsageMode = mode === 'object-usage';
  const isCredentialMode = mode === 'credentials';
  const isApiIntegrationMode = mode === 'api-integrations';
  const isLayoutQualityMode = mode === 'layout-quality';
  const isQualityMode = mode === 'quality';
  const isServerLogMode = mode === 'server-logs';
  const isAiChatMode = mode === 'ai-chat';
  const isDashboardMode = mode === 'dashboard';
  const filterLabel = isTreeMode ? tx(uiLanguage, 'Filter:', 'Filter:') : isScriptSearchMode ? tx(uiLanguage, 'Script-Inhalt:', 'Script content:') : isToUsageMode ? tx(uiLanguage, 'TO-Suche:', 'TO search:') : isObjectUsageMode ? tx(uiLanguage, 'Objekt-Suche:', 'Object search:') : isApiIntegrationMode ? tx(uiLanguage, 'API-/Integrations-Suche:', 'API/integration search:') : isCredentialMode ? tx(uiLanguage, 'Zugangsdaten-Suche:', 'Credential search:') : isLayoutQualityMode ? tx(uiLanguage, 'Layout-Prüfung:', 'Layout checks:') : isQualityMode ? tx(uiLanguage, 'Prüfung:', 'Check:') : isServerLogMode ? tx(uiLanguage, 'Server-Log-Suche:', 'Server log search:') : tx(uiLanguage, 'Suche nach Name:', 'Search by name:');
  const filterPlaceholder = isTreeMode
    ? tx(uiLanguage, 'Filtere die Hierarchie nach Namen', 'Filter hierarchy by name')
    : isScriptSearchMode
      ? tx(uiLanguage, 'z.B. $$Variable, Feldname, Kommentar, Set Variable', 'e.g. $$Variable, field name, comment, Set Variable')
      : isToUsageMode
        ? tx(uiLanguage, 'z.B. TO_Name, Tabelle*, Datenquelle', 'e.g. TO_Name, Table*, data source')
        : isObjectUsageMode
          ? tx(uiLanguage, 'z.B. Scriptname, Layout*, Feldname, Werteliste', 'e.g. script name, Layout*, field name, value list')
          : isApiIntegrationMode
          ? tx(uiLanguage, 'z.B. REST, OAuth, ODBC, URL', 'e.g. REST, OAuth, ODBC, URL')
          : isCredentialMode
            ? tx(uiLanguage, 'z.B. SMTP, Authorization, token, Benutzername', 'e.g. SMTP, Authorization, token, username')
          : isLayoutQualityMode
            ? tx(uiLanguage, 'z.B. Überlappung, leer, Objektname, 1 px', 'e.g. overlap, empty, object name, 1 px')
          : isQualityMode
            ? tx(uiLanguage, 'z.B. fehlendes Feld, riskanter Scriptstep, Kopie', 'e.g. missing field, risky script step, copy')
          : isServerLogMode
            ? tx(uiLanguage, 'z.B. Layoutname, Feldname, Query, Client', 'e.g. layout name, field name, query, client')
          : tx(uiLanguage, 'z.B. Objektname, Script*, Feldname (leer = alle Objekte)', 'e.g. object name, Script*, field name (empty = all objects)');
  const filterTitle = isTreeMode
    ? tx(uiLanguage, 'Items mit diesem Text im Namen werden hervorgehoben (inkl. Eltern-Folder)', 'Items with this text in the name are highlighted, including parent folders.')
    : isScriptSearchMode
      ? tx(uiLanguage, 'Sucht in Script-Schritten, Variablen, Formeln, Parametern und Referenzen. Mindestens 2 Zeichen.', 'Searches script steps, variables, formulas, parameters and references. Minimum 2 characters.')
      : isToUsageMode
        ? tx(uiLanguage, 'Sucht in TO-Name, Basistabelle und Datenquelle. Wildcard * ist erlaubt.', 'Searches TO name, base table and data source. Wildcard * is allowed.')
      : isObjectUsageMode
        ? tx(uiLanguage, 'Sucht in Objektnamen. Wildcard * ist erlaubt.', 'Searches object names. Wildcard * is allowed.')
          : isApiIntegrationMode
            ? tx(uiLanguage, 'Sucht in API-Familien, URL-Services, Datenquellen, Scriptnamen und Endpunktwerten. Wildcard * ist erlaubt.', 'Searches API families, URL services, data sources, script names and endpoint values. Wildcard * is allowed.')
          : isCredentialMode
            ? tx(uiLanguage, 'Sucht in Zugangsdaten-Fundstellen, Werten, Quellen und Script-Kontext. Wildcard * ist erlaubt.', 'Searches credential findings, values, sources and script context. Wildcard * is allowed.')
          : isLayoutQualityMode
            ? tx(uiLanguage, 'Sucht in Layoutnamen, Objektnamen, Objekttypen, Problemtyp und Detailtext. Wildcard * ist erlaubt.', 'Searches layout names, object names, object types, issue type and detail text. Wildcard * is allowed.')
          : isQualityMode
            ? tx(uiLanguage, 'Sucht in Prüfbereich, Problem, Objektname, Quelle und Detailtext. Wildcard * ist erlaubt.', 'Searches check area, issue, object name, source and detail text. Wildcard * is allowed.')
          : isServerLogMode
            ? tx(uiLanguage, 'Sucht in TopCallStats-Zielen, Operationen, gematchten Layouts/Feldern und Tabellen. Wildcard * ist erlaubt.', 'Searches TopCallStats targets, operations, matched layouts/fields and tables. Wildcard * is allowed.')
          : tx(uiLanguage, 'Wildcard * für beliebige Zeichen (z.B. *Name, Script*). Leer lassen für alle Objekte.', 'Wildcard * for any characters (e.g. *Name, Script*). Leave empty for all objects.');

  const qualityExportParams = {
    q: debouncedSearchName || undefined,
    file: selectedFile || undefined,
    area: qualityArea || undefined,
    category: qualityCategory || undefined,
    severity: qualitySeverity || undefined,
    type: qualityObjectType || undefined,
  };

  const navigationGroups = [
    {
      id: 'overview',
      label: tx(uiLanguage, 'Übersicht', 'Overview'),
      defaultMode: 'dashboard' as ViewMode,
      items: [
        { mode: 'dashboard' as ViewMode, label: labelFor('ui.tab.dashboard', 'Dashboard') },
      ],
    },
    {
      id: 'objects',
      label: tx(uiLanguage, 'Objekte', 'Objects'),
      defaultMode: 'search' as ViewMode,
      items: [
        { mode: 'search' as ViewMode, label: labelFor('ui.tab.search', tx(uiLanguage, 'Suche', 'Search')) },
        { mode: 'tree' as ViewMode, label: labelFor('ui.tab.hierarchy', tx(uiLanguage, 'Hierarchie', 'Hierarchy')) },
        { mode: 'script-content' as ViewMode, label: labelFor('ui.tab.script_content', tx(uiLanguage, 'Script-Inhalte', 'Script content')) },
        { mode: 'ai-chat' as ViewMode, label: labelFor('ui.tab.ai_chat', tx(uiLanguage, 'AI-Chat', 'AI chat')) },
      ],
    },
    {
      id: 'analysis',
      label: tx(uiLanguage, 'Analyse', 'Analysis'),
      defaultMode: 'to-usage' as ViewMode,
      items: [
        { mode: 'to-usage' as ViewMode, label: labelFor('ui.tab.to_usage', tx(uiLanguage, 'TO-Nutzung', 'TO usage')) },
        { mode: 'object-usage' as ViewMode, label: labelFor('ui.tab.object_usage', tx(uiLanguage, 'Objekt-Nutzung', 'Object usage')) },
        { mode: 'layout-quality' as ViewMode, label: labelFor('ui.tab.layout_quality', tx(uiLanguage, 'Layout-Prüfung', 'Layout checks')) },
        { mode: 'quality' as ViewMode, label: labelFor('ui.tab.quality', tx(uiLanguage, 'Prüfungen', 'Checks')) },
      ],
    },
    {
      id: 'operations',
      label: tx(uiLanguage, 'Betrieb', 'Operations'),
      defaultMode: 'server-logs' as ViewMode,
      items: [
        { mode: 'server-logs' as ViewMode, label: labelFor('ui.tab.server_logs', tx(uiLanguage, 'Server-Logs', 'Server logs')) },
        { mode: 'api-integrations' as ViewMode, label: labelFor('ui.tab.api_integrations', tx(uiLanguage, 'APIs', 'APIs')) },
        { mode: 'credentials' as ViewMode, label: labelFor('ui.tab.credentials', tx(uiLanguage, 'Zugangsdaten', 'Credentials')) },
      ],
    },
  ];
  const activeNavigationGroup = navigationGroups.find(group => group.items.some(item => item.mode === mode)) || navigationGroups[0];
  const treeHasActiveFilters = isTreeMode && (
    searchName.trim().length > 0 ||
    selectedFile.length > 0 ||
    treeSubtype !== 'ScriptCatalog'
  );

  const resetTreeFilters = () => {
    setSearchName('');
    setSelectedFile('');
    setTreeSubtype('ScriptCatalog');
  };

  return (
    <div className="app">
      <div className="app-title-row">
        <h1>FileMaker Object Browser</h1>
        <div className="app-title-actions">
          <select
            className="language-select"
            value={uiLanguage}
            onChange={(event) => setUiLanguage(event.target.value === 'en' ? 'en' : 'de')}
            aria-label="Sprache / Language"
            title="Sprache / Language"
          >
            <option value="de">DE</option>
            <option value="en">EN</option>
          </select>
          <ThemeToggle />
          <Link to="/settings" className="app-settings-link" aria-label="Plugin-Einstellungen" title="Plugin-Einstellungen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
        </div>
      </div>

      <nav className="app-mode-tabs app-mode-tabs-primary" role="tablist" aria-label={tx(uiLanguage, 'Themenbereiche', 'Sections')}>
        {navigationGroups.map((group) => {
          const isActive = group.id === activeNavigationGroup.id;
          return (
            <button
              key={group.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`tab-button${isActive ? ' active' : ''}`}
              onClick={() => setMode(group.defaultMode)}
            >
              {group.label}
            </button>
          );
        })}
      </nav>

      {activeNavigationGroup.items.length > 1 && (
        <nav className="app-submode-tabs" role="tablist" aria-label={tx(uiLanguage, 'Register im Bereich', 'Tabs in section')}>
          {activeNavigationGroup.items.map((item) => (
            <button
              key={item.mode}
              type="button"
              role="tab"
              aria-selected={mode === item.mode}
              className={`subtab-button${mode === item.mode ? ' active' : ''}`}
              onClick={() => setMode(item.mode)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {!isDashboardMode && !isAiChatMode && (
        <div className={`search-form${isTreeMode ? ' search-form-tree' : ''}`}>
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="search-name">{filterLabel}</label>
            <input
              ref={searchInputRef}
              id="search-name"
              type="text"
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchName('');
                  e.currentTarget.blur();
                }
              }}
              onFocus={() => { wasFocusedRef.current = true; }}
              onBlur={() => { wasFocusedRef.current = false; }}
              placeholder={filterPlaceholder}
              title={filterTitle}
            />
          </div>

          <div className="form-group">
            <label htmlFor="file-name">{tx(uiLanguage, 'Datei:', 'File:')}</label>
            <select
              id="file-name"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
            >
              <option value="">{tx(uiLanguage, 'Alle Dateien', 'All files')}</option>
              {files.map((file) => (
                <option key={file.File_Name || ''} value={file.File_Name || ''}>
                  {file.File_Name}
                </option>
              ))}
            </select>
          </div>

          {isTreeMode ? (
            <div className="form-group">
              <label htmlFor="tree-subtype">{tx(uiLanguage, 'Typ:', 'Type:')}</label>
              <select
                id="tree-subtype"
                value={treeSubtype}
                onChange={(e) => setTreeSubtype(e.target.value as FolderTreeSubtype)}
              >
                {(Object.keys(TREE_SUBTYPE_LABELS) as FolderTreeSubtype[]).map(st => (
                  <option key={st} value={st}>{tx(uiLanguage, TREE_SUBTYPE_LABELS[st].de, TREE_SUBTYPE_LABELS[st].en)}</option>
                ))}
              </select>
            </div>
          ) : !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode ? (
            <>
              <div className="form-group">
                <label htmlFor="object-type">{tx(uiLanguage, 'Objekttyp:', 'Object type:')}</label>
                <select
                  id="object-type"
                  value={objectType}
                  onChange={(e) => setObjectType(e.target.value)}
                >
                  <option value="">{tx(uiLanguage, 'Alle Typen', 'All types')}</option>
                  {OBJECT_TYPES.filter(t => !PSEUDO_TYPE_SET.has(t)).map((type) => (
                    <option key={type} value={type}>
                      {labelFor(`object.${type}`, type)}
                    </option>
                  ))}
                  <optgroup label={tx(uiLanguage, 'Verwendete Tokens', 'Used tokens')}>
                    {PSEUDO_TYPE_GROUP.map((type) => (
                      <option key={type} value={type}>
                        {labelFor(`object.${type}`, OBJECT_TYPE_LABELS_DE[type] ?? type)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              <div className="form-group search-accordion-toggle">
                <label htmlFor="search-accordion-enabled">{tx(uiLanguage, 'Startansicht:', 'Start view:')}</label>
                <label className="checkbox-toggle">
                  <input
                    id="search-accordion-enabled"
                    type="checkbox"
                    checked={searchAccordionEnabled}
                    onChange={(e) => setSearchAccordionEnabled(e.target.checked)}
                  />
                  <span>{tx(uiLanguage, 'Typ-Akkordeon', 'Type accordion')}</span>
                </label>
              </div>
            </>
          ) : isToUsageMode ? (
            <div className="form-group to-usage-filter-toggle">
              <label htmlFor="to-unused-only">{tx(uiLanguage, 'Filter:', 'Filter:')}</label>
              <label className="checkbox-toggle">
                <input
                  id="to-unused-only"
                  type="checkbox"
                  checked={toUsageUnusedOnly}
                  onChange={(e) => setToUsageUnusedOnly(e.target.checked)}
                />
                <span>{tx(uiLanguage, 'Nur unbenutzte TOs', 'Only unused TOs')}</span>
              </label>
            </div>
          ) : isObjectUsageMode ? (
            <>
              <div className="form-group">
                <label htmlFor="object-usage-type">{tx(uiLanguage, 'Objekttyp:', 'Object type:')}</label>
                <select
                  id="object-usage-type"
                  value={objectUsageType}
                  onChange={(e) => setObjectUsageType(e.target.value)}
                >
                  {OBJECT_USAGE_TYPES.map((typeOption) => (
                    <option key={typeOption.value || 'all'} value={typeOption.value}>
                      {optionLabel(typeOption, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="object-usage-max">{tx(uiLanguage, 'Nutzung:', 'Usage:')}</label>
                <select
                  id="object-usage-max"
                  value={objectUsageMaxUsage}
                  onChange={(e) => setObjectUsageMaxUsage(e.target.value)}
                >
                  {OBJECT_USAGE_MAX_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : isApiIntegrationMode ? (
            <>
              <div className="form-group">
                <label htmlFor="api-integration-type">{tx(uiLanguage, 'Typ:', 'Type:')}</label>
                <select
                  id="api-integration-type"
                  value={apiIntegrationType}
                  onChange={(e) => setApiIntegrationType(e.target.value)}
                >
                  {API_INTEGRATION_TYPES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="api-integration-risk">{tx(uiLanguage, 'Risiko:', 'Risk:')}</label>
                <select
                  id="api-integration-risk"
                  value={apiIntegrationRisk}
                  onChange={(e) => setApiIntegrationRisk(e.target.value)}
                >
                  {CREDENTIAL_RISKS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group credential-toggle-group">
                <label htmlFor="api-integration-secret-only">{tx(uiLanguage, 'Filter:', 'Filter:')}</label>
                <label className="checkbox-toggle">
                  <input
                    id="api-integration-secret-only"
                    type="checkbox"
                    checked={apiIntegrationSecretOnly}
                    onChange={(e) => setApiIntegrationSecretOnly(e.target.checked)}
                  />
                  <span>{tx(uiLanguage, 'Nur Secrets', 'Only secrets')}</span>
                </label>
              </div>
            </>
          ) : isCredentialMode ? (
            <>
              <div className="form-group">
                <label htmlFor="credential-category">{tx(uiLanguage, 'Quelle:', 'Source:')}</label>
                <select
                  id="credential-category"
                  value={credentialCategory}
                  onChange={(e) => setCredentialCategory(e.target.value)}
                >
                  {CREDENTIAL_CATEGORIES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="credential-risk">{tx(uiLanguage, 'Risiko:', 'Risk:')}</label>
                <select
                  id="credential-risk"
                  value={credentialRisk}
                  onChange={(e) => setCredentialRisk(e.target.value)}
                >
                  {CREDENTIAL_RISKS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group credential-toggle-group">
                <label htmlFor="credential-secret-only">{tx(uiLanguage, 'Filter:', 'Filter:')}</label>
                <label className="checkbox-toggle">
                  <input
                    id="credential-secret-only"
                    type="checkbox"
                    checked={credentialSecretOnly}
                    onChange={(e) => setCredentialSecretOnly(e.target.checked)}
                  />
                  <span>{tx(uiLanguage, 'Nur Secrets', 'Only secrets')}</span>
                </label>
              </div>

              <div className="form-group credential-toggle-group">
                <label htmlFor="credential-reveal-values">{tx(uiLanguage, 'Werte:', 'Values:')}</label>
                <label className="checkbox-toggle">
                  <input
                    id="credential-reveal-values"
                    type="checkbox"
                    checked={credentialRevealValues}
                    onChange={(e) => setCredentialRevealValues(e.target.checked)}
                  />
                  <span>{tx(uiLanguage, 'Anzeigen', 'Show')}</span>
                </label>
              </div>
            </>
          ) : isLayoutQualityMode ? (
            <>
              <div className="form-group">
                <label htmlFor="layout-quality-category">{tx(uiLanguage, 'Problem:', 'Issue:')}</label>
                <select
                  id="layout-quality-category"
                  value={layoutQualityCategory}
                  onChange={(e) => setLayoutQualityCategory(e.target.value)}
                >
                  {LAYOUT_QUALITY_CATEGORIES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="layout-quality-severity">{tx(uiLanguage, 'Risiko:', 'Risk:')}</label>
                <select
                  id="layout-quality-severity"
                  value={layoutQualitySeverity}
                  onChange={(e) => setLayoutQualitySeverity(e.target.value)}
                >
                  {LAYOUT_QUALITY_SEVERITIES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : isQualityMode ? (
            <>
              <div className="form-group">
                <label htmlFor="quality-area">{tx(uiLanguage, 'Bereich:', 'Area:')}</label>
                <select
                  id="quality-area"
                  value={qualityArea}
                  onChange={(e) => setQualityArea(e.target.value)}
                >
                  {QUALITY_AREAS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="quality-severity">{tx(uiLanguage, 'Risiko:', 'Risk:')}</label>
                <select
                  id="quality-severity"
                  value={qualitySeverity}
                  onChange={(e) => setQualitySeverity(e.target.value)}
                >
                  {QUALITY_SEVERITIES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="quality-type">{tx(uiLanguage, 'Typ:', 'Type:')}</label>
                <select
                  id="quality-type"
                  value={qualityObjectType}
                  onChange={(e) => setQualityObjectType(e.target.value)}
                >
                  {QUALITY_OBJECT_TYPES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : isServerLogMode ? (
            <>
              <div className="form-group">
                <label htmlFor="server-log-type">{tx(uiLanguage, 'Zieltyp:', 'Target type:')}</label>
                <select
                  id="server-log-type"
                  value={serverLogObjectType}
                  onChange={(e) => setServerLogObjectType(e.target.value)}
                >
                  {SERVER_LOG_OBJECT_TYPES.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="server-log-min">{tx(uiLanguage, 'Laufzeit:', 'Runtime:')}</label>
                <select
                  id="server-log-min"
                  value={serverLogMinElapsed}
                  onChange={(e) => setServerLogMinElapsed(e.target.value)}
                >
                  {SERVER_LOG_MIN_ELAPSED.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {optionLabel(option, uiLanguage)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group credential-toggle-group">
                <label htmlFor="server-log-matched">{tx(uiLanguage, 'Filter:', 'Filter:')}</label>
                <label className="checkbox-toggle">
                  <input
                    id="server-log-matched"
                    type="checkbox"
                    checked={serverLogMatchedOnly}
                    onChange={(e) => setServerLogMatchedOnly(e.target.checked)}
                  />
                  <span>{tx(uiLanguage, 'Nur gematchte Ziele', 'Only matched targets')}</span>
                </label>
              </div>
            </>
          ) : null}

          {isTreeMode && (
            <div className="form-group form-group-action">
              <button
                type="button"
                className="search-form-reset"
                onClick={resetTreeFilters}
                disabled={!treeHasActiveFilters}
              >
                {tx(uiLanguage, 'Zurücksetzen', 'Reset')}
              </button>
            </div>
          )}

          {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && (
            <button
              className="search-options-toggle"
              onClick={() => setOptionsOpen(prev => !prev)}
              aria-expanded={optionsOpen}
              type="button"
            >
              {optionsOpen ? tx(uiLanguage, 'Optionen ▴', 'Options ▴') : tx(uiLanguage, 'Optionen...', 'Options...')}
            </button>
          )}
        </div>

        {isScriptSearchMode && (
          <ScriptFolderFilter
            file={selectedFile || undefined}
            selectedFolders={selectedScriptFolders}
            sortMode={scriptFolderSortMode}
            language={uiLanguage}
            onSelectedFoldersChange={setSelectedScriptFolders}
            onSortModeChange={setScriptFolderSortMode}
          />
        )}

        {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && optionsOpen && (
          <SearchOptions
            sortBy={sortBy}
            groupBy={groupBy}
            language={uiLanguage}
            onSortChange={setSortBy}
            onGroupChange={setGroupBy}
          />
        )}
      </div>
      )}

      {/* Error message (search mode only) */}
      {isDashboardMode && dashboardError && (
        <div className="error-message">
          {dashboardError}
        </div>
      )}

      {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && !isSearchAccordionActive && error && objectType !== 'RelationshipGraph' && (
        <div className="error-message">
          {error}
        </div>
      )}

      {isScriptSearchMode && scriptSearchError && (
        <div className="error-message">
          {scriptSearchError}
        </div>
      )}

      {isToUsageMode && toUsageError && (
        <div className="error-message">
          {toUsageError}
        </div>
      )}

      {isObjectUsageMode && objectUsageError && (
        <div className="error-message">
          {objectUsageError}
        </div>
      )}

      {isCredentialMode && credentialError && (
        <div className="error-message">
          {credentialError}
        </div>
      )}

      {isApiIntegrationMode && apiIntegrationError && (
        <div className="error-message">
          {apiIntegrationError}
        </div>
      )}

      {isLayoutQualityMode && layoutQualityError && (
        <div className="error-message">
          {layoutQualityError}
        </div>
      )}

      {isQualityMode && qualityError && (
        <div className="error-message">
          {qualityError}
        </div>
      )}

      {isServerLogMode && serverLogError && (
        <div className="error-message">
          {serverLogError}
        </div>
      )}

      {/* RelationshipGraph: Spezial-Einstiegspunkt — keine Liste, sondern Direktlink */}
      {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && objectType === 'RelationshipGraph' && (
        <div className="relationship-graph-entry">
          {selectedFile ? (
            <Link
              to={`/relationship-graph/${encodeURIComponent(selectedFile)}`}
              className="relationship-graph-entry-card"
            >
              <span className="relationship-graph-entry-title">
                {tx(uiLanguage, 'Beziehungsdiagramm öffnen', 'Open relationship graph')}
              </span>
              <span className="relationship-graph-entry-file">{selectedFile}</span>
              <span className="relationship-graph-entry-hint">→</span>
            </Link>
          ) : (
            <div className="relationship-graph-entry-empty">
              {tx(uiLanguage, 'Bitte oben eine Datei auswählen, um das Beziehungsdiagramm anzuzeigen.', 'Select a file above to show the relationship graph.')}
            </div>
          )}
        </div>
      )}

      {/* Search mode: Pseudo-Token-Typen — eigene aggregierte Ansicht (PRD §8) */}
      {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && PSEUDO_TYPE_SET.has(objectType) && (
        <PseudoTokenView
          objectType={objectType}
          file={selectedFile || undefined}
          onItemClick={handleItemClick}
          onSendToAiChat={handleSendToAiChat}
          initialCategory={searchParams.get('category') || undefined}
          initialSort={(searchParams.get('sort') as 'usage' | 'name' | 'category') || undefined}
        />
      )}

      {/* Search mode start view: grouped by object type, loaded only on expand */}
      {isSearchAccordionActive && (
        <TypeAccordionList
          key={`type-accordion-${selectedFile}-${objectType}`}
          selectedFile={selectedFile}
          selectedType={objectType}
          language={uiLanguage}
          labelFor={labelFor}
          onItemClick={handleItemClick}
          onSendToAiChat={handleSendToAiChat}
          onScroll={() => {}}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Script content mode: step-level matches inside scripts */}
      {isScriptSearchMode && (
        <ScriptContentSearchList
          items={scriptSearchItems}
          totalCount={scriptSearchTotalCount}
          isLoading={scriptSearchLoading || scriptSearchLoadingMore}
          hasMore={scriptSearchHasMore}
          query={debouncedSearchName}
          minQueryLength={scriptSearchMinQueryLength}
          language={uiLanguage}
          onLoadMore={loadMoreScriptResults}
          onItemClick={handleScriptResultClick}
          onScroll={handleScriptResultsScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* TO usage mode: precomputed table occurrence usage analysis */}
      {isToUsageMode && (
        <TableOccurrenceUsageList
          items={toUsageItems}
          totalCount={toUsageTotalCount}
          isLoading={toUsageLoading || toUsageLoadingMore}
          hasMore={toUsageHasMore}
          unusedOnly={toUsageUnusedOnly}
          language={uiLanguage}
          onLoadMore={loadMoreToUsage}
          onItemClick={handleTableOccurrenceUsageClick}
          onScroll={handleTableOccurrenceUsageScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Object usage mode: unused and rarely referenced objects */}
      {isObjectUsageMode && (
        <ObjectUsageList
          key={`object-usage-${objectUsageType}-${objectUsageMaxUsage}-${selectedFile}-${debouncedSearchName}`}
          items={objectUsageItems}
          totalCount={objectUsageTotalCount}
          isLoading={objectUsageLoading || objectUsageLoadingMore}
          hasMore={objectUsageHasMore}
          language={uiLanguage}
          onLoadMore={loadMoreObjectUsage}
          onItemClick={handleObjectUsageClick}
          onScroll={handleObjectUsageScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Credentials mode: accounts, SMTP, API/cURL and credential keywords */}
      {isCredentialMode && (
        <CredentialFindingsList
          items={credentialItems}
          totalCount={credentialTotalCount}
          isLoading={credentialLoading || credentialLoadingMore}
          hasMore={credentialHasMore}
          revealValues={credentialRevealValues}
          language={uiLanguage}
          onLoadMore={loadMoreCredentials}
          onItemClick={handleCredentialClick}
          onScroll={handleCredentialScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {isApiIntegrationMode && (
        <ApiIntegrationList
          items={apiIntegrationItems}
          summary={apiIntegrationSummary}
          totalCount={apiIntegrationTotalCount}
          isLoading={apiIntegrationLoading || apiIntegrationLoadingMore}
          hasMore={apiIntegrationHasMore}
          language={uiLanguage}
          onLoadMore={loadMoreApiIntegrations}
          onItemClick={handleApiIntegrationClick}
          onScroll={handleApiIntegrationScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {isDashboardMode && (
        <QualityDashboard
          rows={dashboardRows}
          loading={dashboardLoading}
          language={uiLanguage}
          onMetricClick={handleDashboardMetricClick}
        />
      )}

      {isAiChatMode && (
        <AiChatPanel language={uiLanguage} />
      )}

      {/* Layout quality mode: problematic layout objects and overlap stacks */}
      {isLayoutQualityMode && (
        <LayoutObjectQualityList
          items={layoutQualityItems}
          totalCount={layoutQualityTotalCount}
          isLoading={layoutQualityLoading || layoutQualityLoadingMore}
          hasMore={layoutQualityHasMore}
          language={uiLanguage}
          onLoadMore={loadMoreLayoutQuality}
          onItemClick={handleLayoutQualityClick}
          onScroll={handleLayoutQualityScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Quality mode: cross-cutting checks and risk scanners */}
      {isQualityMode && (
        <QualityFindingsList
          items={qualityItems}
          totalCount={qualityTotalCount}
          isLoading={qualityLoading || qualityLoadingMore}
          hasMore={qualityHasMore}
          exportRawUrl={getQualityExportUrl(qualityExportParams, 'raw')}
          exportMarkdownUrl={getQualityExportUrl(qualityExportParams, 'markdown')}
          language={uiLanguage}
          onLoadMore={loadMoreQuality}
          onItemClick={handleQualityClick}
          onScroll={handleQualityScroll}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {isServerLogMode && (
        <ServerTopCallList
          items={serverLogSummary}
          calls={serverLogCalls}
          dashboard={serverLogDashboard}
          waitAnalysis={serverLogWaitAnalysis}
          totalCount={serverLogTotalCount}
          isLoading={serverLogLoading || serverLogLoadingMore}
          hasMore={serverLogHasMore}
          language={uiLanguage}
          onLoadMore={loadMoreServerLogs}
          onItemClick={handleServerTopCallClick}
          onSendToAiChat={handleSendToAiChat}
        />
      )}

      {/* Search mode: Virtual list (Standard-Typen) */}
      {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && !isSearchAccordionActive && !error && objectType !== 'RelationshipGraph' && !PSEUDO_TYPE_SET.has(objectType) && (
        <VirtualList
          rows={processedRows}
          itemCount={items.length}
          isLoading={loading || loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          totalCount={totalCount}
          language={uiLanguage}
          onItemClick={handleItemClick}
          onSendToAiChat={handleSendToAiChat}
          onToggleGroup={handleToggleGroup}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Search mode: Initial loading state (nicht für Pseudo-Typen — eigener Loader) */}
      {!isTreeMode && !isScriptSearchMode && !isToUsageMode && !isObjectUsageMode && !isApiIntegrationMode && !isCredentialMode && !isLayoutQualityMode && !isQualityMode && !isServerLogMode && !isAiChatMode && !isSearchAccordionActive && objectType !== 'RelationshipGraph' && !PSEUDO_TYPE_SET.has(objectType) && loading && items.length === 0 && (
        <div className="virtual-list-empty">
          {tx(uiLanguage, 'Lade Objekte...', 'Loading objects...')}
        </div>
      )}

      {/* Tree mode: Folder tree */}
      {isTreeMode && (
        <FolderTree
          subtype={treeSubtype}
          file={selectedFile || undefined}
          filter={debouncedSearchName}
          onSendToAiChat={handleSendToAiChat}
        />
      )}
    </div>
  );
}

export { SearchView };

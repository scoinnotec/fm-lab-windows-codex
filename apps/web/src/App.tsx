import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Routes, Route, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from './api/client';
import { OBJECT_TYPES } from '@packages/shared/constants';
import { useInfiniteSearch, useDebounce, useScrollRestore } from './hooks';
import { VirtualList, DetailView, SearchOptions } from './components';
import { SettingsView } from './views/SettingsView';
import type { SortOption, GroupOption, VirtualListRow, FMObject } from './types';
import './App.css';

type FileInfo = {
  File_Name?: string;
  File_FullName?: string;
  FileMaker_Version?: string;
  Has_DDR_INFO?: boolean;
  Import_Timestamp?: string;
};

function SearchView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { saveScrollPosition, restoreScrollPosition } = useScrollRestore();
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Initialize filter states from URL params (for deep linking & back-navigation)
  const [searchName, setSearchName] = useState(searchParams.get('q') || '');
  const [selectedFile, setSelectedFile] = useState<string>(searchParams.get('file') || '');
  const [objectType, setObjectType] = useState<string>(searchParams.get('type') || '');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>((searchParams.get('sort') as SortOption) || 'standard');
  const [groupBy, setGroupBy] = useState<GroupOption>((searchParams.get('group') as GroupOption) || 'none');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Ref to track if search input should maintain focus
  const searchInputRef = useRef<HTMLInputElement>(null);
  const wasFocusedRef = useRef(false);

  // Debounce search input for Search-as-you-type (300ms delay)
  const debouncedSearchName = useDebounce(searchName, 300);

  // Use infinite search hook
  const { items, loading, loadingMore, hasMore, totalCount, error, loadMore } = useInfiniteSearch({
    searchName: debouncedSearchName || '*',
    selectedFile,
    objectType,
  });

  // Sync search params to URL (replace to avoid polluting history)
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedSearchName) params.set('q', debouncedSearchName);
    if (selectedFile) params.set('file', selectedFile);
    if (objectType) params.set('type', objectType);
    if (sortBy !== 'standard') params.set('sort', sortBy);
    if (groupBy !== 'none') params.set('group', groupBy);
    setSearchParams(params, { replace: true });
  }, [debouncedSearchName, selectedFile, objectType, sortBy, groupBy, setSearchParams]);

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

  // Restore focus to search input after loading states change
  useEffect(() => {
    if (wasFocusedRef.current && searchInputRef.current && !loading) {
      searchInputRef.current.focus();
    }
  }, [loading]);

  // Restore scroll position when items are loaded (after back-navigation)
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (items.length > 0 && !hasRestoredRef.current) {
      hasRestoredRef.current = true;
      restoreScrollPosition('search-list', scrollContainerRef.current);
    }
  }, [items.length, restoreScrollPosition]);

  // Reset restore flag when search params change
  useEffect(() => {
    hasRestoredRef.current = false;
  }, [debouncedSearchName, selectedFile, objectType]);

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

  return (
    <div className="app">
      <div className="app-title-row">
        <h1>FileMaker Object Browser</h1>
        <Link to="/settings" className="app-settings-link" aria-label="Plugin-Einstellungen" title="Plugin-Einstellungen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </Link>
      </div>

      <div className="search-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="search-name">Suche nach Name:</label>
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
              placeholder="z.B. Import, Email (leer = alle Objekte)"
              title="Wildcard * für beliebige Zeichen (z.B. *Import, Email*). Leer lassen für alle Objekte."
            />
          </div>

          <div className="form-group">
            <label htmlFor="file-name">Datei:</label>
            <select
              id="file-name"
              value={selectedFile}
              onChange={(e) => setSelectedFile(e.target.value)}
            >
              <option value="">Alle Dateien</option>
              {files.map((file) => (
                <option key={file.File_Name || ''} value={file.File_Name || ''}>
                  {file.File_Name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="object-type">Objekttyp:</label>
            <select
              id="object-type"
              value={objectType}
              onChange={(e) => setObjectType(e.target.value)}
            >
              <option value="">Alle Typen</option>
              {OBJECT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <button
            className="search-options-toggle"
            onClick={() => setOptionsOpen(prev => !prev)}
            aria-expanded={optionsOpen}
            type="button"
          >
            {optionsOpen ? 'Optionen \u25B4' : 'Optionen...'}
          </button>
        </div>

        {optionsOpen && (
          <SearchOptions
            sortBy={sortBy}
            groupBy={groupBy}
            onSortChange={setSortBy}
            onGroupChange={setGroupBy}
          />
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {/* Virtual List with Infinite Scrolling */}
      {!error && (
        <VirtualList
          rows={processedRows}
          itemCount={items.length}
          isLoading={loading || loadingMore}
          hasMore={hasMore}
          onLoadMore={loadMore}
          totalCount={totalCount}
          onItemClick={handleItemClick}
          onToggleGroup={handleToggleGroup}
          scrollContainerRef={scrollContainerRef}
        />
      )}

      {/* Initial loading state */}
      {loading && items.length === 0 && (
        <div className="virtual-list-empty">
          Lade Objekte...
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<SearchView />} />
      <Route path="/object/:uuid" element={<DetailView />} />
      <Route path="/settings" element={<SettingsView />} />
    </Routes>
  );
}

export default App;

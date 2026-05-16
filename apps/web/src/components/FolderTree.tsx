import React, { useMemo, useRef, useState, useCallback, useEffect, useDeferredValue } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTemplateQuery } from '../hooks/useTemplateQuery';
import { LoadingSpinner } from './LoadingSpinner';
import { ErrorMessage } from './ErrorMessage';
import { currentText } from '../lib/uiLanguage';
import './FolderTree.css';

const ROW_HEIGHT = 42;
const SEPARATOR_HEIGHT = 14;
const INDENT_PX = 18;

export type FolderTreeSubtype = 'ScriptCatalog' | 'Layouts' | 'CustomFunctionsCatalog';

interface TreeRow {
  uuid: string;
  name: string;
  type: string;       // Folder | Script | Layout | CustomFunction | Separator
  subtype: string;    // Folder | Item | Separator
  nesting_level: number;
  file: string;
  sequence: number;
}

interface FolderTreeProps {
  subtype: FolderTreeSubtype;
  file?: string;
  filter?: string;
  onSendToAiChat?: (prompt: string) => void;
}

function loadExpandedFromStorage(subtype: FolderTreeSubtype): Set<string> {
  try {
    const raw = localStorage.getItem(`folderTree:expanded:${subtype}`);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpandedToStorage(subtype: FolderTreeSubtype, expanded: Set<string>): void {
  try {
    localStorage.setItem(`folderTree:expanded:${subtype}`, JSON.stringify([...expanded]));
  } catch {
    // ignore quota errors
  }
}

function computeUnfilteredVisibleRows(rows: TreeRow[], expanded: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  let hideUntilLevel = -1;
  for (const row of rows) {
    if (hideUntilLevel >= 0 && row.nesting_level > hideUntilLevel) {
      continue;
    }
    hideUntilLevel = -1;
    out.push(row);
    if (row.subtype === 'Folder' && !expanded.has(row.uuid)) {
      hideUntilLevel = row.nesting_level;
    }
  }
  return out;
}

interface FilterVisibility {
  visibleSet: Set<string>;
  folderSet: Set<string>;
}

function computeFilteredVisibility(rows: TreeRow[], filterLower: string): FilterVisibility {
  const visibleSet = new Set<string>();
  const folderSet = new Set<string>();
  const folderStack: { level: number; uuid: string }[] = [];

  const markFolderPath = () => {
    for (const f of folderStack) {
      visibleSet.add(f.uuid);
      folderSet.add(f.uuid);
    }
  };

  for (const row of rows) {
    while (folderStack.length > 0 && folderStack[folderStack.length - 1].level >= row.nesting_level) {
      folderStack.pop();
    }
    if (row.subtype === 'Folder') {
      folderStack.push({ level: row.nesting_level, uuid: row.uuid });
      if (row.name.toLowerCase().includes(filterLower)) {
        markFolderPath();
      }
    } else if (row.subtype === 'Item') {
      if (row.name.toLowerCase().includes(filterLower)) {
        visibleSet.add(row.uuid);
        markFolderPath();
      }
    }
  }

  return { visibleSet, folderSet };
}

function computeFilteredVisibleRows(rows: TreeRow[], visibility: FilterVisibility, expanded: Set<string>): TreeRow[] {
  const out: TreeRow[] = [];
  const { visibleSet } = visibility;
  const currentStack: { level: number; uuid: string; visible: boolean; expanded: boolean }[] = [];
  let hideUntilLevel = -1;

  for (const row of rows) {
    while (currentStack.length > 0 && currentStack[currentStack.length - 1].level >= row.nesting_level) {
      currentStack.pop();
    }
    if (hideUntilLevel >= 0 && row.nesting_level > hideUntilLevel) {
      continue;
    }
    hideUntilLevel = -1;

    if (row.subtype === 'Folder') {
      const isVis = visibleSet.has(row.uuid);
      const isExpanded = expanded.has(row.uuid);
      currentStack.push({ level: row.nesting_level, uuid: row.uuid, visible: isVis, expanded: isExpanded });
      if (isVis) {
        out.push(row);
        if (!isExpanded) {
          hideUntilLevel = row.nesting_level;
        }
      }
    } else if (row.subtype === 'Item') {
      if (visibleSet.has(row.uuid)) out.push(row);
    } else if (row.subtype === 'Separator') {
      const parent = currentStack.length > 0 ? currentStack[currentStack.length - 1] : null;
      if (parent?.visible && parent.expanded) out.push(row);
    }
  }
  return out;
}

export const FolderTree: React.FC<FolderTreeProps> = ({ subtype, file, filter, onSendToAiChat }) => {
  const navigate = useNavigate();
  const params = useMemo(() => {
    const p: Record<string, string> = { subtype };
    if (file) p.file = file;
    return p;
  }, [subtype, file]);

  const { data, loading, error, retry } = useTemplateQuery('list_with_folders', params, true);

  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpandedFromStorage(subtype));
  const lastFilterAutoExpandKeyRef = useRef<string>('');

  useEffect(() => {
    setExpanded(loadExpandedFromStorage(subtype));
  }, [subtype]);

  useEffect(() => {
    saveExpandedToStorage(subtype, expanded);
  }, [subtype, expanded]);

  const rows: TreeRow[] = useMemo(() => {
    if (!data) return [];
    return data.map(r => ({
      uuid: String(r.uuid ?? ''),
      name: String(r.name ?? ''),
      type: String(r.type ?? 'Item'),
      subtype: String(r.subtype ?? 'Item'),
      nesting_level: Number(r.nesting_level ?? 0),
      file: String(r.file ?? ''),
      sequence: Number(r.sequence ?? 0),
    }));
  }, [data]);

  const deferredFilter = useDeferredValue(filter ?? '');
  const filterTrimmed = deferredFilter.trim();
  const filterActive = filterTrimmed.length > 0;
  const filterLower = filterTrimmed.toLowerCase();
  const filterVisibility = useMemo<FilterVisibility>(() => {
    if (!filterActive) {
      return { visibleSet: new Set(), folderSet: new Set() };
    }
    return computeFilteredVisibility(rows, filterLower);
  }, [filterActive, filterLower, rows]);

  useEffect(() => {
    if (!filterActive) {
      lastFilterAutoExpandKeyRef.current = '';
      return;
    }
    const key = `${subtype}|${file ?? ''}|${filterLower}|${rows.length}|${filterVisibility.folderSet.size}`;
    if (lastFilterAutoExpandKeyRef.current === key) return;
    lastFilterAutoExpandKeyRef.current = key;
    setExpanded(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const uuid of filterVisibility.folderSet) {
        if (!next.has(uuid)) {
          next.add(uuid);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [file, filterActive, filterLower, filterVisibility, rows.length, subtype]);

  const visibleRows: TreeRow[] = useMemo(() => {
    if (filterActive) {
      return computeFilteredVisibleRows(rows, filterVisibility, expanded);
    }
    return computeUnfilteredVisibleRows(rows, expanded);
  }, [rows, expanded, filterActive, filterVisibility]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) =>
      visibleRows[index]?.subtype === 'Separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT,
    overscan: 12,
  });

  // Wenn der Filter sich ändert, muss der Virtualizer die Höhen neu berechnen
  useEffect(() => {
    virtualizer.measure();
  }, [filterActive, filterTrimmed, virtualizer]);

  const toggleFolder = useCallback((uuid: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (filterActive) {
      setExpanded(prev => {
        const next = new Set(prev);
        for (const uuid of filterVisibility.folderSet) {
          next.add(uuid);
        }
        return next;
      });
      return;
    }
    setExpanded(new Set(rows.filter(r => r.subtype === 'Folder').map(r => r.uuid)));
  }, [filterActive, filterVisibility, rows]);

  const collapseAll = useCallback(() => {
    if (filterActive) {
      setExpanded(prev => {
        const next = new Set(prev);
        for (const uuid of filterVisibility.folderSet) {
          next.delete(uuid);
        }
        return next;
      });
      return;
    }
    setExpanded(new Set());
  }, [filterActive, filterVisibility]);

  const handleItemClick = useCallback((row: TreeRow) => {
    if (row.subtype === 'Separator') return;
    navigate(`/object/${row.uuid}`);
  }, [navigate]);

  const folderCount = rows.filter(r => r.subtype === 'Folder').length;
  const itemCount = rows.filter(r => r.subtype === 'Item').length;
  const visibleItemCount = visibleRows.filter(r => r.subtype === 'Item').length;
  const visibleFolderCount = visibleRows.filter(r => r.subtype === 'Folder').length;
  const hasActiveScope = filterActive || Boolean(file) || subtype !== 'ScriptCatalog';
  const currentLanguage = currentText('de', 'en') === 'en' ? 'en' : 'de';

  const buildRowAiPrompt = useCallback((row: TreeRow) => {
    return currentText(
      [
        'Bitte untersuche dieses FileMaker-Objekt aus der Hierarchie und gib konkrete Optimierungs- und Refactoring-Hinweise.',
        '',
        'Kontext:',
        `- Objekt: ${row.name || '(ohne Namen)'}`,
        `- Typ: ${row.type}`,
        `- Datei: ${row.file || file || 'Alle Dateien'}`,
        `- UUID: ${row.uuid}`,
        `- Hierarchie: ${subtypeLabel(subtype, 'de')}`,
        `- Ebene: ${row.nesting_level}`,
        filterTrimmed ? `- Aktueller Filter: ${filterTrimmed}` : '- Aktueller Filter: keiner',
        '',
        'Bitte prüfe vor allem:',
        '- Referenzen und Verwendungen',
        '- Risiken oder tote Bereiche',
        '- konkrete Vereinfachungen',
        '- sinnvolle nächste Refactoring-Schritte',
      ].join('\n'),
      [
        'Please analyze this FileMaker object from the hierarchy and provide concrete optimization and refactoring suggestions.',
        '',
        'Context:',
        `- Object: ${row.name || '(without name)'}`,
        `- Type: ${row.type}`,
        `- File: ${row.file || file || 'All files'}`,
        `- UUID: ${row.uuid}`,
        `- Hierarchy: ${subtypeLabel(subtype, 'en')}`,
        `- Level: ${row.nesting_level}`,
        filterTrimmed ? `- Current filter: ${filterTrimmed}` : '- Current filter: none',
        '',
        'Please focus on:',
        '- references and usage',
        '- risks or dead areas',
        '- concrete simplifications',
        '- useful next refactoring steps',
      ].join('\n')
    );
  }, [file, filterTrimmed, subtype]);

  if (loading) {
    return <LoadingSpinner message="Hierarchie wird geladen..." />;
  }
  if (error) {
    return <ErrorMessage message={error} onRetry={retry} />;
  }
  if (!rows.length) {
    return <div className="folder-tree-empty">{currentText('Keine Einträge', 'No entries')}</div>;
  }

  return (
    <div className="folder-tree">
      <div className="folder-tree-toolbar">
        <span className="folder-tree-stats">
          {filterActive ? (
            <>
              {visibleItemCount.toLocaleString('de-DE')} / {itemCount.toLocaleString('de-DE')} Einträge{' · '}
              {visibleFolderCount.toLocaleString('de-DE')} / {folderCount.toLocaleString('de-DE')} Ordner
            </>
          ) : (
            <>
              {itemCount.toLocaleString('de-DE')} Einträge{' · '}
              {folderCount.toLocaleString('de-DE')} Ordner
            </>
          )}
        </span>
        <div className="folder-tree-toolbar-actions">
          <button
            type="button"
            onClick={expandAll}
            className="folder-tree-toolbar-button"
            title="Alle sichtbaren Ordner aufklappen"
          >
            Aufklappen
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="folder-tree-toolbar-button"
            title="Alle sichtbaren Ordner zuklappen"
          >
            Zuklappen
          </button>
        </div>
      </div>

      {hasActiveScope && (
        <div className="folder-tree-filter-summary" aria-label={currentText('Aktive Filter', 'Active filters')}>
          <span className="folder-tree-filter-summary-label">
            {currentText('Aktiv', 'Active')}
          </span>
          {filterActive && (
            <span className="folder-tree-filter-chip">
              {currentText('Filter', 'Filter')}: {filterTrimmed}
            </span>
          )}
          {file && (
            <span className="folder-tree-filter-chip">
              {currentText('Datei', 'File')}: {file}
            </span>
          )}
          {subtype !== 'ScriptCatalog' && (
            <span className="folder-tree-filter-chip">
              {currentText('Typ', 'Type')}: {subtypeLabel(subtype, currentLanguage)}
            </span>
          )}
        </div>
      )}

      <div ref={parentRef} className="folder-tree-scroll">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map(vi => {
            const row = visibleRows[vi.index];
            const isFolder = row.subtype === 'Folder';
            const isSeparator = row.subtype === 'Separator';
            const isExpanded = isFolder && expanded.has(row.uuid);
            const indent = row.nesting_level * INDENT_PX;

            return (
              <div
                key={`${row.uuid}-${row.sequence}`}
                className={`folder-tree-row folder-tree-row-${row.subtype.toLowerCase()}`}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${vi.size}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {isSeparator ? (
                  <div className="folder-tree-separator" style={{ paddingLeft: indent + 8 }}>
                    <hr />
                  </div>
                ) : (
                  <div
                    className="folder-tree-item"
                    style={{ paddingLeft: indent + 8 }}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      if (isFolder) {
                        toggleFolder(row.uuid);
                      } else {
                        handleItemClick(row);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isFolder) toggleFolder(row.uuid);
                        else handleItemClick(row);
                      }
                    }}
                  >
                    <span className="folder-tree-toggle">
                      {isFolder ? (isExpanded ? '▾' : '▸') : ''}
                    </span>
                    <span className={`folder-tree-badge folder-tree-badge-${row.type.toLowerCase()}`} title={badgeTitleForType(row.type)}>
                      {badgeForType(row.type)}
                    </span>
                    <span className="folder-tree-name">
                      <HighlightedName name={row.name || '(ohne Namen)'} query={filterTrimmed} />
                    </span>
                    <span className="folder-tree-file">{row.file}</span>
                    <span className="folder-tree-actions">
                      {onSendToAiChat && (
                        <button
                          type="button"
                          className="folder-tree-ai-link"
                          title={currentText('Diesen Eintrag an den AI-Chat übergeben', 'Send this entry to AI chat')}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSendToAiChat(buildRowAiPrompt(row));
                          }}
                        >
                          AI
                        </button>
                      )}
                      {isFolder && (
                        <button
                          type="button"
                          className="folder-tree-detail-link"
                          title="Folder-Details anzeigen"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleItemClick(row);
                          }}
                        >
                          Details
                        </button>
                      )}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function badgeForType(type: string): string {
  switch (type) {
    case 'Folder':         return 'DIR';
    case 'Script':         return 'SCR';
    case 'Layout':         return 'LAY';
    case 'CustomFunction': return 'CF';
    default:               return '';
  }
}

function badgeTitleForType(type: string): string {
  switch (type) {
    case 'Folder':         return 'Ordner';
    case 'Script':         return 'Script';
    case 'Layout':         return 'Layout';
    case 'CustomFunction': return 'Eigene Funktion';
    default:               return type || 'Objekt';
  }
}

function HighlightedName({ name, query }: { name: string; query: string }) {
  const trimmed = query.trim();
  if (!trimmed) return <>{name}</>;

  const haystack = name.toLocaleLowerCase('de-DE');
  const needle = trimmed.toLocaleLowerCase('de-DE');
  const index = haystack.indexOf(needle);
  if (index < 0) return <>{name}</>;

  return (
    <>
      {name.slice(0, index)}
      <mark className="folder-tree-match">{name.slice(index, index + trimmed.length)}</mark>
      {name.slice(index + trimmed.length)}
    </>
  );
}

function subtypeLabel(subtype: FolderTreeSubtype, language: 'de' | 'en'): string {
  const labels: Record<FolderTreeSubtype, { de: string; en: string }> = {
    ScriptCatalog: { de: 'Scripts', en: 'Scripts' },
    Layouts: { de: 'Layouts', en: 'Layouts' },
    CustomFunctionsCatalog: { de: 'Eigene Funktionen', en: 'Custom functions' },
  };
  return labels[subtype][language];
}

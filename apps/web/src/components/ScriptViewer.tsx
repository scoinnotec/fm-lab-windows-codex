import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ScriptTokens, ViewMode, ScriptRef, RefType } from '../script/types';
import { computeFoldRanges, computeHiddenLines, buildFoldStartIndex } from '../script/folding';
import { computeMarginRoleMap } from '../script/marginBar';
import { ScriptLine } from './ScriptLine';
import { ScriptViewerHeader, type FilterStyle } from './ScriptViewerHeader';
import { ScriptSearchFilter } from './ScriptSearchFilter';
import { useUrlState, stringSetCodec } from '../hooks/useUrlState';
import { HighlightRefContext, ScriptSearchContext, type ScriptSearchPredicate } from '../script/highlightContext';
import './ScriptViewer.css';

interface ScriptViewerProps {
  tokens: ScriptTokens;
  /** Cross-Reference Highlight: Token-Match auf Tokens mit `ref.uuid ∈ Set`. */
  highlightRefUuids?: Set<string> | null;
}

const VALID_MODES = new Set<ViewMode>([
  'normal',
  'compact',
  'comments-only',
  'control-only',
  'subscript-only',
  'assignments-only',
  'executive-only',
]);

const VALID_FILTER_STYLES = new Set<FilterStyle>(['dim', 'hide']);

const EMPTY_TYPES: Set<RefType> = new Set();

export const ScriptViewer: React.FC<ScriptViewerProps> = ({ tokens, highlightRefUuids }) => {
  const lines = tokens.lines;
  const [routeSearchParams] = useSearchParams();
  const focusedLineParam = routeSearchParams.get('step');
  const focusedLine = useMemo(() => {
    const value = Number(focusedLineParam);
    return Number.isInteger(value) && value > 0 ? value : null;
  }, [focusedLineParam]);

  const foldRanges = useMemo(() => computeFoldRanges(lines), [lines]);
  const foldStartIndex = useMemo(() => buildFoldStartIndex(foldRanges), [foldRanges]);
  const marginRoleMap = useMemo(() => computeMarginRoleMap(lines), [lines]);

  const [foldedStarts, setFoldedStarts] = useState<Set<number>>(() => new Set());

  const hiddenLines = useMemo(
    () => computeHiddenLines(foldRanges, foldedStarts),
    [foldRanges, foldedStarts],
  );

  const [modeRaw, setModeRaw] = useUrlState<string>('mode', 'normal');
  const mode: ViewMode = (VALID_MODES.has(modeRaw as ViewMode) ? modeRaw : 'normal') as ViewMode;
  const setMode = useCallback((m: ViewMode) => setModeRaw(m), [setModeRaw]);

  // Default 'dim' (Zusammenhang bleibt sichtbar). 'hide' = klassisches Ausblenden.
  const [filterRaw, setFilterRaw] = useUrlState<string>('filter', 'dim');
  const filterStyle: FilterStyle = (VALID_FILTER_STYLES.has(filterRaw as FilterStyle)
    ? filterRaw
    : 'dim') as FilterStyle;
  const setFilterStyle = useCallback((f: FilterStyle) => setFilterRaw(f), [setFilterRaw]);

  const stepCount = useMemo(
    () => lines.filter(l => l.kind === 'step').length,
    [lines],
  );

  // Suche/Filter-State analog zur Referenzen-Filterleiste (HierarchyTree).
  // Eigene Param-Namen 'sq'/'stypes', damit sie nicht mit den 'q'/'types'-
  // Params der Referenzen-Tab kollidieren — beide Tabs leben in derselben URL.
  const [searchQuery, setSearchQuery] = useUrlState<string>('sq', '');
  const [activeRefTypes, setActiveRefTypes] = useUrlState<Set<string>>(
    'stypes',
    EMPTY_TYPES as Set<string>,
    stringSetCodec,
  );
  const activeTypes = activeRefTypes as Set<RefType>;

  // Alle Refs des Scripts in einer flachen Liste — Basis für Type-Counts und Match-Logik.
  const allRefs = useMemo<ScriptRef[]>(() => {
    const out: ScriptRef[] = [];
    for (const line of lines) {
      if (line.refs) out.push(...line.refs);
    }
    return out;
  }, [lines]);

  const typeCounts = useMemo(() => {
    const m = new Map<RefType, number>();
    for (const ref of allRefs) {
      m.set(ref.type, (m.get(ref.type) ?? 0) + 1);
    }
    return m;
  }, [allRefs]);

  const queryLower = searchQuery.trim().toLowerCase();

  // Predicate: ein Ref matched, wenn ALLE aktiven Filter zustimmen.
  // - Aktive Typ-Pillen: Ref-Type muss enthalten sein (sonst kein Treffer)
  // - Sucheingabe: Substring-Match (case-insensitive) auf Ref-Name oder Sub-Funktion
  // Wenn weder Query noch Pillen aktiv: predicate ist `null` → kein Highlight.
  const searchPredicate = useMemo<ScriptSearchPredicate | null>(() => {
    const hasTypeFilter = activeTypes.size > 0;
    const hasQuery = queryLower !== '';
    if (!hasTypeFilter && !hasQuery) return null;
    return (ref: ScriptRef) => {
      if (hasTypeFilter && !activeTypes.has(ref.type)) return false;
      if (hasQuery) {
        const haystack = `${ref.name ?? ''} ${ref.subFunction ?? ''}`.toLowerCase();
        if (!haystack.includes(queryLower)) return false;
      }
      return true;
    };
  }, [activeTypes, queryLower]);

  const matchCount = useMemo(() => {
    if (!searchPredicate) return 0;
    return allRefs.filter(searchPredicate).length;
  }, [allRefs, searchPredicate]);

  const toggleRefType = useCallback((type: RefType) => {
    setActiveRefTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, [setActiveRefTypes]);

  const clearRefTypes = useCallback(() => {
    setActiveRefTypes(EMPTY_TYPES as Set<string>);
  }, [setActiveRefTypes]);

  const toggleFold = useCallback((startLine: number) => {
    setFoldedStarts(prev => {
      const next = new Set(prev);
      if (next.has(startLine)) next.delete(startLine);
      else next.add(startLine);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setFoldedStarts(new Set()), []);
  const collapseAll = useCallback(() => {
    setFoldedStarts(new Set(foldRanges.map(r => r.startLine)));
  }, [foldRanges]);
  const collapseMultiline = useCallback(() => {
    setFoldedStarts(new Set(
      foldRanges.filter(r => r.kind === 'multiline').map(r => r.startLine),
    ));
  }, [foldRanges]);

  // Beim Erscheinen eines Highlight-Sets: das erste markierte Token in den
  // sichtbaren Bereich scrollen. Vermeidet, dass der User in einem langen
  // Script manuell nach dem Treffer suchen muss. Nutzt `requestAnimationFrame`,
  // damit die DOM-Mutation der Highlight-Klassen bereits abgeschlossen ist.
  const rootRef = useRef<HTMLDivElement>(null);
  const highlightSig = highlightRefUuids ? Array.from(highlightRefUuids).sort().join(',') : '';
  useEffect(() => {
    if (!highlightSig || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const first = rootRef.current?.querySelector('.fm-ref--highlighted');
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightSig]);

  useEffect(() => {
    if (!focusedLine || !rootRef.current) return;
    const id = requestAnimationFrame(() => {
      const target = rootRef.current?.querySelector(`[data-line="${focusedLine}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return () => cancelAnimationFrame(id);
  }, [focusedLine, lines.length]);

  return (
    <HighlightRefContext.Provider value={highlightRefUuids ?? null}>
      <ScriptSearchContext.Provider value={searchPredicate}>
        <div ref={rootRef} className="object-detail fm-script-root" aria-label="Script-Text">
          <ScriptViewerHeader
            stepCount={stepCount}
            mode={mode}
            onModeChange={setMode}
            filterStyle={filterStyle}
            onFilterStyleChange={setFilterStyle}
            onExpandAll={expandAll}
            onCollapseAll={collapseAll}
            onCollapseMultiline={collapseMultiline}
          />
          {allRefs.length > 0 && (
            <ScriptSearchFilter
              typeCounts={typeCounts}
              activeTypes={activeTypes}
              onToggleType={toggleRefType}
              onClearTypes={clearRefTypes}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              matchCount={matchCount}
              totalCount={allRefs.length}
            />
          )}
          <ol className={`fm-script fm-mode--${mode} fm-filter--${filterStyle}`}>
            {lines.map(line => {
              const starts = foldStartIndex.get(line.line);
              const folded = foldedStarts.has(line.line);
              const marginRole = marginRoleMap.get(line.line) ?? null;
              return (
                <ScriptLine
                  key={line.line}
                  line={line}
                  marginRole={marginRole}
                  hidden={hiddenLines.has(line.line)}
                  focused={line.line === focusedLine}
                  foldStarts={starts}
                  folded={folded}
                  onToggleFold={toggleFold}
                />
              );
            })}
          </ol>
        </div>
      </ScriptSearchContext.Provider>
    </HighlightRefContext.Provider>
  );
};

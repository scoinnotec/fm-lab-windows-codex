import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LayoutObject } from './useLayoutData';
import { useUrlState, stringSetCodec } from './useUrlState';

const EMPTY_TYPES = new Set<string>();

export type LayoutSearchAPI = {
  query: string;
  setQuery: (q: string) => void;

  activeTypes: Set<string>;
  toggleType: (type: string) => void;
  setTypes: (types: string[], active: boolean) => void;
  clearTypes: () => void;

  matchUuids: Set<string>;
  matches: LayoutObject[];

  selectedUuid: string | null;
  selectNext: () => void;
  selectPrev: () => void;
  clear: () => void;

  filterActive: boolean;
};

/**
 * Konsolidierter Such-Text pro Layout-Objekt (PRD §5.4 F14):
 * deckt Feldname, Script-Caption, Text-Inhalt, Object_Name und Object_Type ab,
 * sodass eine einzelne Substring-Eingabe alle relevanten Bezeichnungen findet.
 */
function buildSearchText(o: LayoutObject): string {
  return [
    o.field_name ?? '',
    o.script_name ?? '',
    o.text_content ?? '',
    o.object_name ?? '',
    o.object_type,
  ].join(' ').toLowerCase();
}

/**
 * Steuert Such-Filter, Typ-Pillen-Filter und Selektion (TAB-Cursor) für die Layout-Ansicht.
 *
 * Sortierung der Fundmenge entspricht der SVG-Render-Reihenfolge: (Nesting_Level, Object_ID).
 * Die Daten kommen bereits sortiert aus dem SQL-Template, deshalb reicht ein einfacher Filter.
 */
export function useLayoutSearch(objects: LayoutObject[]): LayoutSearchAPI {
  // Such- und Filter-State liegt in der URL — Stack erhält den State beim
  // Zurück-Navigieren. selectedUuid bleibt transient (Cursor pro TAB-Schritt
  // soll nicht in jedem Render die URL fluten).
  const [query, setQueryState] = useUrlState<string>('q', '');
  const [activeTypes, setActiveTypes] = useUrlState<Set<string>>('types', EMPTY_TYPES, stringSetCodec);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  // Bei Layout-Wechsel: nur Selektion zurücksetzen — Suche/Filter bleiben durch
  // URL-Persistenz intakt; auto-select-Effekt greift im neuen Match-Set.
  useEffect(() => {
    setSelectedUuid(null);
  }, [objects]);

  const matches = useMemo<LayoutObject[]>(() => {
    const typeFiltered = activeTypes.size === 0
      ? objects
      : objects.filter(o => activeTypes.has(o.object_type));
    if (query === '') return typeFiltered;
    const q = query.toLowerCase();
    return typeFiltered.filter(o => buildSearchText(o).includes(q));
  }, [objects, activeTypes, query]);

  const matchUuids = useMemo(() => {
    const s = new Set<string>();
    for (const o of matches) s.add(o.object_uuid);
    return s;
  }, [matches]);

  // Selektion mit Fundmenge synchronisieren — analog useGraphSearch:
  //  - genau 1 Treffer → diesen automatisch selektieren (rote Umrandung sofort)
  //  - selektierte UUID nicht mehr in der Fundmenge → Selektion verwerfen
  useEffect(() => {
    if (matches.length === 1) {
      const only = matches[0].object_uuid;
      if (selectedUuid !== only) setSelectedUuid(only);
      return;
    }
    if (selectedUuid !== null && !matchUuids.has(selectedUuid)) {
      setSelectedUuid(null);
    }
  }, [matches, matchUuids, selectedUuid]);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
  // Setter aus useUrlState ist stabil; lint-deps absichtlich entkoppeln.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleType = useCallback((type: string) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bulk-Setter für Gruppen-Pillen: aktiviert oder deaktiviert mehrere Typen auf einen Schlag,
  // ohne die anderen aktiven Typen zu verlieren.
  const setTypes = useCallback((types: string[], active: boolean) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (active) {
        for (const t of types) next.add(t);
      } else {
        for (const t of types) next.delete(t);
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTypes = useCallback(() => {
    setActiveTypes(EMPTY_TYPES);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectByOffset = useCallback((offset: 1 | -1) => {
    if (matches.length === 0) return;
    const currentIdx = selectedUuid
      ? matches.findIndex(o => o.object_uuid === selectedUuid)
      : -1;
    let nextIdx: number;
    if (currentIdx < 0) {
      nextIdx = offset === 1 ? 0 : matches.length - 1;
    } else {
      nextIdx = (currentIdx + offset + matches.length) % matches.length;
    }
    setSelectedUuid(matches[nextIdx].object_uuid);
  }, [matches, selectedUuid]);

  const selectNext = useCallback(() => selectByOffset(1), [selectByOffset]);
  const selectPrev = useCallback(() => selectByOffset(-1), [selectByOffset]);

  const clear = useCallback(() => {
    setQueryState('');
    setSelectedUuid(null);
  }, []);

  const filterActive = query !== '' || activeTypes.size > 0;

  return {
    query,
    setQuery,
    activeTypes,
    toggleType,
    setTypes,
    clearTypes,
    matchUuids,
    matches,
    selectedUuid,
    selectNext,
    selectPrev,
    clear,
    filterActive,
  };
}

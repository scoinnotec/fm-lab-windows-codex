import { useMemo, useRef } from 'react';
import { getUiLanguage, objectTypeLabel, tx } from '../lib/uiLanguage';

type Props = {
  typeCounts: Map<string, number>;
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
  onClearTypes: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
  onJumpToList?: (direction: 'first' | 'last') => void;
};

/**
 * Toolbar oberhalb der Referenz-Liste. Suchfeld + Typ-Filter-Pillen
 * orientieren sich am Verhalten von LayoutTypeFilter und
 * RelationshipGraph-Suche: ESC leert die Eingabe; Pillen sind
 * Mehrfachauswahl mit OR-Verknüpfung.
 */
export function ReferencesFilter({
  typeCounts,
  activeTypes,
  onToggleType,
  onClearTypes,
  query,
  onQueryChange,
  matchCount,
  totalCount,
  onJumpToList,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const language = getUiLanguage();

  // Sortierung: nach Anzahl absteigend, danach alphabetisch — der häufigste
  // Typ steht links und ist am schnellsten erreichbar.
  const sortedTypes = useMemo(() => {
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1] || objectTypeLabel(a[0], language).localeCompare(objectTypeLabel(b[0], language)));
  }, [typeCounts, language]);

  const hasAnyActive = activeTypes.size > 0;
  const filterActive = hasAnyActive || query !== '';

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // ESC bewusst NICHT lokal abfangen — der globale ESC-Stack auf View-Ebene
    // (siehe useEscapeStack in DetailView) regelt die Stufenlogik
    // (Suchfeld leeren → Filter leeren → Zurück).
    if (e.key === 'ArrowDown' && onJumpToList) {
      e.preventDefault();
      onJumpToList('first');
    } else if (e.key === 'ArrowUp' && onJumpToList) {
      e.preventDefault();
      onJumpToList('last');
    }
  };

  return (
    <div className="references-filter">
      <div className="references-filter-search">
        <input
          ref={inputRef}
          type="search"
          placeholder={tx(language, 'Referenzen durchsuchen...', 'Search references...')}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          title={tx(language, 'Esc: Eingabe leeren', 'Esc: clear input')}
          aria-label={tx(language, 'Referenzen durchsuchen', 'Search references')}
        />
        {filterActive && (
          <span className="references-filter-count">
            {matchCount} / {totalCount}
          </span>
        )}
      </div>
      {sortedTypes.length > 0 && (
        <div className="references-filter-pills">
          {sortedTypes.map(([type, count]) => {
            const active = activeTypes.has(type);
            const label = objectTypeLabel(type, language);
            return (
              <button
                key={type}
                type="button"
                className={`references-filter-pill${active ? ' active' : ''}`}
                onClick={() => onToggleType(type)}
                title={`${label} (${count})`}
              >
                {label}
                <span className="references-filter-pill-count">({count})</span>
              </button>
            );
          })}
          {hasAnyActive && (
            <button
              type="button"
              className="references-filter-link"
              onClick={onClearTypes}
              title={tx(language, 'Alle Typ-Filter aufheben', 'Clear all type filters')}
            >
              {tx(language, 'Filter zurücksetzen', 'Reset filter')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

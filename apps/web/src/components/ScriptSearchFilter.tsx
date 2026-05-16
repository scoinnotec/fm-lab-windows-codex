import { useMemo, useRef } from 'react';
import type { RefType } from '../script/types';
import { getUiLanguage, refTypeLabel, tx } from '../lib/uiLanguage';

type Props = {
  typeCounts: Map<RefType, number>;
  activeTypes: Set<RefType>;
  onToggleType: (type: RefType) => void;
  onClearTypes: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  matchCount: number;
  totalCount: number;
};

/**
 * Anzeige-Labels pro RefType — analog zur Layout-/Referenzen-Filterleiste.
 * Bewusst sprechende deutsche Begriffe statt der raw camelCase-RefType-Werte,
 * damit die Pills im UI lesbar bleiben.
 */
/**
 * Filterleiste unterhalb des Script-Viewer-Headers — analog zu
 * ReferencesFilter (DetailView) und LayoutTypeFilter. Nutzt die globalen
 * `.references-filter*`-Klassen aus DetailView.css für identisches Look-and-Feel.
 *
 * Match-Logik (im ScriptViewer aufgebaut):
 *   - Aktive Typ-Pillen filtern Refs auf RefType-Match (OR-Verknüpfung)
 *   - Sucheingabe matched case-insensitive auf den Ref-Namen
 *   - Ohne Filter ist das Predicate `null` — keine Highlights
 */
export function ScriptSearchFilter({
  typeCounts,
  activeTypes,
  onToggleType,
  onClearTypes,
  query,
  onQueryChange,
  matchCount,
  totalCount,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const language = getUiLanguage();

  // Sortierung: nach Anzahl absteigend, dann alphabetisch nach Label.
  // Konsistent mit ReferencesFilter — häufigster Typ links.
  const sortedTypes = useMemo(() => {
    return Array.from(typeCounts.entries())
      .sort((a, b) => b[1] - a[1] || refTypeLabel(a[0], language).localeCompare(refTypeLabel(b[0], language)));
  }, [typeCounts, language]);

  const hasAnyActive = activeTypes.size > 0;
  const filterActive = hasAnyActive || query !== '';

  return (
    <div className="references-filter fm-script-search">
      <div className="references-filter-search">
        <input
          ref={inputRef}
          type="search"
          placeholder={tx(language, 'Refs durchsuchen...', 'Search refs...')}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          aria-label={tx(language, 'Refs durchsuchen', 'Search refs')}
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
            const label = refTypeLabel(type, language);
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

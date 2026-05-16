import React, { useState } from 'react';
import { getUiLanguage, tx } from '../lib/uiLanguage';

/**
 * Filter-Toolbar für Pseudo-Token-Listen (PRD prd_pseudo_object_types_filter.md §8.2).
 *
 * Render-Bedingung: nur für die drei Token-Pseudo-Typen
 * (ScriptStepType, BuiltinFunction, PluginFunction). PluginComponent rendert keine
 * Toolbar (ist selbst die Category-Ebene).
 */

export type CategoryEntry = {
  category: string | null;
  token_count: number;
  total_usage: number;
};

export type SortMode = 'usage' | 'name' | 'category';

interface Props {
  /** Categories vom /api/list/categories Endpoint */
  categories: CategoryEntry[];
  /** Aktive Categories (mehrere via OR-Verknüpfung) */
  activeCategories: string[];
  onToggleCategory: (category: string) => void;
  onClearCategories: () => void;
  /** Aktuelle Sortierung */
  sort: SortMode;
  onSortChange: (sort: SortMode) => void;
  /** Lokaler Filter-Text (clientseitig) */
  searchText: string;
  onSearchTextChange: (s: string) => void;
  /** Trefferzähler-Anzeige: 'aktuell / total' */
  filteredCount: number;
  totalCount: number;
  /** Header-Label für die Kategorie-Sektion ('Kategorie' | 'Komponente') */
  categoryLabel: string;
}

const VISIBLE_THRESHOLD = 8;

export const PseudoTokenFilterToolbar: React.FC<Props> = ({
  categories,
  activeCategories,
  onToggleCategory,
  onClearCategories,
  sort,
  onSortChange,
  searchText,
  onSearchTextChange,
  filteredCount,
  totalCount,
  categoryLabel,
}) => {
  const [expanded, setExpanded] = useState(false);
  const language = getUiLanguage();

  // Pillen-Sortierung: aktiv → nach total_usage desc; Pseudo-NULL ("Sonstige") ganz hinten
  const sortedCategories = [...categories].sort((a, b) => {
    if (a.category == null && b.category != null) return 1;
    if (b.category == null && a.category != null) return -1;
    return b.total_usage - a.total_usage;
  });

  const visibleCategories = expanded
    ? sortedCategories
    : sortedCategories.slice(0, VISIBLE_THRESHOLD);
  const hasMore = sortedCategories.length > VISIBLE_THRESHOLD;
  const activeSet = new Set(activeCategories);

  return (
    <div className="pseudo-token-toolbar">
      <div className="pseudo-token-toolbar-row1">
        <div className="pseudo-token-toolbar-search">
          <label htmlFor="pseudo-token-search-input">{tx(language, 'Suchen:', 'Search:')}</label>
          <input
            id="pseudo-token-search-input"
            type="text"
            value={searchText}
            onChange={(e) => onSearchTextChange(e.target.value)}
            placeholder={tx(language, 'Token-Name filtern...', 'Filter token name...')}
          />
          <span className="pseudo-token-count">
            {filteredCount} / {totalCount}
          </span>
        </div>
        <div className="pseudo-token-toolbar-sort">
          <label htmlFor="pseudo-token-sort-select">{tx(language, 'Sortierung:', 'Sort:')}</label>
          <select
            id="pseudo-token-sort-select"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortMode)}
          >
            <option value="usage">↓ {tx(language, 'Häufigkeit', 'Usage')}</option>
            <option value="name">A → Z</option>
            <option value="category">{categoryLabel}</option>
          </select>
        </div>
      </div>

      {sortedCategories.length > 0 && (
        <div className="pseudo-token-toolbar-row2">
          <span className="pseudo-token-toolbar-category-label">
            {categoryLabel}:
          </span>
          <div className="pseudo-token-toolbar-pills">
            {visibleCategories.map((c) => {
              const label = c.category ?? tx(language, 'Sonstige', 'Other');
              const active = c.category != null && activeSet.has(c.category);
              return (
                <button
                  key={c.category ?? '__null__'}
                  type="button"
                  className={`pseudo-token-pill${active ? ' active' : ''}${c.category == null ? ' pseudo-token-pill-null' : ''}`}
                  onClick={() => {
                    if (c.category == null) return;
                    onToggleCategory(c.category);
                  }}
                  disabled={c.category == null}
                  title={
                    c.category == null
                      ? tx(language, 'Tokens ohne Kategorie (nicht filterbar)', 'Tokens without category (not filterable)')
                      : tx(language, `${label} - ${c.token_count} Tokens, ${c.total_usage} Verwendungen`, `${label} - ${c.token_count} tokens, ${c.total_usage} uses`)
                  }
                >
                  {label} ({c.token_count})
                </button>
              );
            })}
            {hasMore && (
              <button
                type="button"
                className="pseudo-token-pill pseudo-token-pill-toggle"
                onClick={() => setExpanded((e) => !e)}
              >
                {expanded ? tx(language, 'Weniger ▴', 'Less ▴') : tx(language, `Details ▾ (${sortedCategories.length - VISIBLE_THRESHOLD})`, `Details ▾ (${sortedCategories.length - VISIBLE_THRESHOLD})`)}
              </button>
            )}
            {activeCategories.length > 0 && (
              <button
                type="button"
                className="pseudo-token-pill pseudo-token-pill-clear"
                onClick={onClearCategories}
              >
                {tx(language, 'Filter zurücksetzen', 'Reset filter')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import type { components } from '@packages/shared/types';
import { CATEGORY_LABEL_DE, type PseudoTokenType } from '@packages/shared/constants';
import {
  PseudoTokenFilterToolbar,
  type CategoryEntry,
  type SortMode,
} from './PseudoTokenFilterToolbar';
import { ObjectListItem } from './ObjectListItem';

type FMObject = components['schemas']['FMObject'];
type AggObject = FMObject & {
  usage_count?: number;
  category?: string | null;
  category_id?: number | null;
};

/**
 * PseudoTokenView — Listenansicht für Pseudo-Token-Typen mit Aggregations-Layer
 * (PRD prd_pseudo_object_types_filter.md §8).
 *
 * Lädt /api/list mit ?with_usage / ?with_category / ?category / ?sort und
 * /api/list/categories für die Filter-Pillen. Für PluginComponent entfällt
 * die Filter-Toolbar — es ist selbst die Category-Ebene.
 */

const PSEUDO_TOKEN_TYPES = new Set<string>(['ScriptStepType', 'BuiltinFunction', 'PluginFunction']);

interface Props {
  objectType: string;
  file?: string;
  onItemClick: (uuid: string) => void;
  initialCategory?: string;
  initialSort?: SortMode;
  onUrlStateChange?: (state: { category?: string; sort?: SortMode }) => void;
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:3003';

async function fetchList(params: URLSearchParams) {
  const url = `${API_BASE}/api/list?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/api/list ${res.status}: ${text}`);
  }
  return res.json();
}

async function fetchCategories(type: string, file: string | undefined) {
  const params = new URLSearchParams({ type: type.toLowerCase() });
  if (file) params.set('file', file);
  const url = `${API_BASE}/api/list/categories?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`/api/list/categories ${res.status}: ${text}`);
  }
  return res.json();
}

export const PseudoTokenView: React.FC<Props> = ({
  objectType,
  file,
  onItemClick,
  initialCategory,
  initialSort,
  onUrlStateChange,
}) => {
  const isTokenType = PSEUDO_TOKEN_TYPES.has(objectType);
  const isComponentType = objectType === 'PluginComponent';

  const [items, setItems] = useState<AggObject[]>([]);
  const [categories, setCategories] = useState<CategoryEntry[]>([]);
  const [activeCategories, setActiveCategories] = useState<string[]>(
    initialCategory ? initialCategory.split(',').filter(Boolean) : []
  );
  const [sort, setSort] = useState<SortMode>(initialSort || 'usage');
  const [searchText, setSearchText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL-State melden (für ?category= und ?sort=)
  useEffect(() => {
    onUrlStateChange?.({
      category: activeCategories.length > 0 ? activeCategories.join(',') : undefined,
      sort,
    });
  }, [activeCategories, sort, onUrlStateChange]);

  // Reset wenn der Typ wechselt
  useEffect(() => {
    setItems([]);
    setActiveCategories([]);
    setSearchText('');
    setSort('usage');
  }, [objectType]);

  // Categories laden (nur für Token-Typen)
  useEffect(() => {
    if (!isTokenType) {
      setCategories([]);
      return;
    }
    let cancelled = false;
    fetchCategories(objectType, file)
      .then((r) => {
        if (!cancelled) setCategories(r.data || []);
      })
      .catch((e) => {
        if (!cancelled) console.error('PseudoTokenView categories error:', e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [objectType, file, isTokenType]);

  // Liste laden — bei Pseudo-Typen mit Aggregations
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      type: objectType.toLowerCase(),
      limit: '500',
      sort,
    });
    if (file) params.set('file', file);

    if (isTokenType || isComponentType) {
      params.set('with_usage', 'true');
    }
    if (isTokenType) {
      params.set('with_category', 'true');
      if (activeCategories.length > 0) {
        params.set('category', activeCategories.join(','));
      }
    }

    fetchList(params)
      .then((r) => {
        if (!cancelled) setItems(r.data || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [objectType, file, sort, activeCategories, isTokenType, isComponentType]);

  // Clientseitiges Filtern nach searchText
  const filteredItems = useMemo(() => {
    if (!searchText.trim()) return items;
    const lower = searchText.toLowerCase();
    return items.filter((it) => (it.Object_Name || '').toLowerCase().includes(lower));
  }, [items, searchText]);

  const handleToggleCategory = (cat: string) => {
    setActiveCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleClearCategories = () => {
    setActiveCategories([]);
  };

  const handleListItemCategoryClick = (cat: string) => {
    // Toggling-Verhalten: Klick auf Pille im Listenelement aktiviert sie.
    setActiveCategories((prev) => (prev.includes(cat) ? prev : [...prev, cat]));
    // Scroll nach oben — Konvention aus PRD §8.3
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const categoryLabel = isTokenType
    ? CATEGORY_LABEL_DE[objectType as PseudoTokenType] || 'Kategorie'
    : 'Kategorie';

  return (
    <div className="pseudo-token-view">
      {isTokenType && (
        <PseudoTokenFilterToolbar
          categories={categories}
          activeCategories={activeCategories}
          onToggleCategory={handleToggleCategory}
          onClearCategories={handleClearCategories}
          sort={sort}
          onSortChange={setSort}
          searchText={searchText}
          onSearchTextChange={setSearchText}
          filteredCount={filteredItems.length}
          totalCount={items.length}
          categoryLabel={categoryLabel}
        />
      )}

      {isComponentType && (
        <div className="pseudo-token-toolbar pseudo-token-toolbar-component">
          <div className="pseudo-token-toolbar-row1">
            <div className="pseudo-token-toolbar-search">
              <label htmlFor="pseudo-token-search-input">Suchen:</label>
              <input
                id="pseudo-token-search-input"
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Komponente filtern…"
              />
              <span className="pseudo-token-count">
                {filteredItems.length} / {items.length}
              </span>
            </div>
            <div className="pseudo-token-toolbar-sort">
              <label htmlFor="pseudo-token-sort-select">Sortierung:</label>
              <select
                id="pseudo-token-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
              >
                <option value="usage">↓ Häufigkeit</option>
                <option value="name">A → Z</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="virtual-list-empty">Lade Tokens…</div>
      )}

      {error && (
        <div className="error-message">{error}</div>
      )}

      {!loading && filteredItems.length === 0 && !error && (
        <div className="virtual-list-empty">Keine Tokens gefunden.</div>
      )}

      <div className="pseudo-token-list">
        {filteredItems.map((obj) => (
          <ObjectListItem
            key={obj.Object_UUID}
            object={obj}
            onClick={onItemClick}
            onCategoryClick={isTokenType ? handleListItemCategoryClick : undefined}
          />
        ))}
      </div>
    </div>
  );
};

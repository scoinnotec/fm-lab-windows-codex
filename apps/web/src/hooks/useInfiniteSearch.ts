import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api/client';
import type { components } from '@packages/shared/types';

type FMObject = components['schemas']['FMObject'];

const CHUNK_SIZE = 100;

interface UseInfiniteSearchOptions {
  searchName: string;
  selectedFile: string;
  objectType: string;
  enabled?: boolean;
}

interface UseInfiniteSearchResult {
  items: FMObject[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalCount: number | null;
  error: string | null;
  loadMore: () => Promise<void>;
  reset: () => void;
}

/**
 * Infinite Search Hook
 * Manages infinite scrolling with offset-based pagination
 *
 * Features:
 * - Auto-loads initial data
 * - Loads more data in chunks (100 items)
 * - Prevents duplicate requests
 * - Tracks total count
 * - Resets when search params change
 *
 * @example
 * const { items, loading, hasMore, loadMore } = useInfiniteSearch({
 *   searchName: '%',
 *   selectedFile: 'MyFile',
 *   objectType: 'Script'
 * });
 */
export const useInfiniteSearch = ({
  searchName,
  selectedFile,
  objectType,
  enabled = true,
}: UseInfiniteSearchOptions): UseInfiniteSearchResult => {
  const [items, setItems] = useState<FMObject[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prevent duplicate requests
  const isFetchingRef = useRef(false);

  // Build search params (normalize to API format)
  const buildSearchParams = useCallback((withOffset: number = 0) => {
    // Wildcard-Mapping: * → % (SQL-Wildcard)
    let pattern = searchName.trim().replace(/\*/g, '%');

    // Wenn Pattern keine Wildcards enthält, füge sie automatisch hinzu
    if (!pattern.includes('%')) {
      pattern = `%${pattern}%`;
    }

    return {
      name: pattern,
      file: selectedFile || undefined,
      type: objectType as any || undefined,
      limit: CHUNK_SIZE,
      offset: withOffset,
    };
  }, [searchName, selectedFile, objectType]);

  /**
   * Reset and load initial data
   */
  const reset = useCallback(async () => {
    // Reset state
    setItems([]);
    setOffset(0);
    setError(null);
    setTotalCount(enabled ? null : 0);
    setLoading(enabled);
    isFetchingRef.current = false;

    if (!enabled) {
      return;
    }

    try {
      const searchParams = buildSearchParams(0);

      // Parallel requests: search + count
      const [searchResponse, countResponse] = await Promise.all([
        api.search(searchParams),
        api.searchCount({
          name: searchParams.name,
          file: searchParams.file,
          type: searchParams.type,
        }),
      ]);

      if (searchResponse.success && searchResponse.data) {
        const items = Array.isArray(searchResponse.data) ? searchResponse.data : [];
        setItems(items);
        setOffset(CHUNK_SIZE);
      } else {
        setError('Suche fehlgeschlagen');
      }

      // Extract total count
      if (countResponse.success && countResponse.data) {
        const countData = Array.isArray(countResponse.data)
          ? countResponse.data
          : [countResponse.data];
        if (countData.length > 0 && 'count' in countData[0]) {
          setTotalCount(countData[0].count as number);
        } else {
          setTotalCount(null);
        }
      } else {
        setTotalCount(null);
      }
    } catch (err) {
      console.error('Search failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler bei der Suche');
    } finally {
      setLoading(false);
    }
  }, [buildSearchParams, enabled]);

  /**
   * Load more items (next chunk)
   */
  const loadMore = useCallback(async () => {
    // Guard clauses
    if (!enabled || isFetchingRef.current || loadingMore || loading) {
      return;
    }

    if (totalCount !== null && items.length >= totalCount) {
      return; // No more items to load
    }

    isFetchingRef.current = true;
    setLoadingMore(true);
    setError(null);

    try {
      const searchParams = buildSearchParams(offset);

      const response = await api.search(searchParams);

      if (response.success && response.data) {
        const newItems = Array.isArray(response.data) ? response.data : [];
        setItems((prev) => [...prev, ...newItems]);
        setOffset((prev) => prev + CHUNK_SIZE);
      } else {
        setError('Laden fehlgeschlagen');
      }
    } catch (err) {
      console.error('Load more failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
    } finally {
      isFetchingRef.current = false;
      setLoadingMore(false);
    }
  }, [buildSearchParams, offset, items.length, totalCount, loadingMore, loading, enabled]);

  /**
   * Reset when search params change
   */
  useEffect(() => {
    reset();
  }, [reset]);

  const hasMore = totalCount !== null && items.length < totalCount;

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    totalCount,
    error,
    loadMore,
    reset,
  };
};

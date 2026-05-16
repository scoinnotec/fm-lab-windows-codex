import { useCallback, useEffect, useRef, useState } from 'react';
import { searchScriptContents, searchScriptContentsCount } from '../api/client';
import type { ScriptContentSearchResult } from '../types';

const CHUNK_SIZE = 100;
const MIN_QUERY_LENGTH = 2;

interface UseInfiniteScriptContentSearchOptions {
  query: string;
  selectedFile: string;
  selectedFolders?: string[];
  enabled: boolean;
}

interface UseInfiniteScriptContentSearchResult {
  items: ScriptContentSearchResult[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalCount: number | null;
  error: string | null;
  minQueryLength: number;
  loadMore: () => Promise<void>;
  reset: () => Promise<void>;
}

function getCount(data: { count?: number } | { count?: number }[] | undefined) {
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return typeof row?.count === 'number' ? row.count : null;
}

function isSearchable(query: string) {
  return query.replace(/\*/g, '').trim().length >= MIN_QUERY_LENGTH;
}

export const useInfiniteScriptContentSearch = ({
  query,
  selectedFile,
  selectedFolders = [],
  enabled,
}: UseInfiniteScriptContentSearchOptions): UseInfiniteScriptContentSearchResult => {
  const [items, setItems] = useState<ScriptContentSearchResult[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const trimmedQuery = query.trim();
  const canSearch = enabled && isSearchable(trimmedQuery);

  const buildParams = useCallback((withOffset = 0) => ({
    q: trimmedQuery,
    file: selectedFile || undefined,
    folders: selectedFolders.length > 0 ? selectedFolders.join(',') : undefined,
    limit: CHUNK_SIZE,
    offset: withOffset,
  }), [trimmedQuery, selectedFile, selectedFolders]);

  const reset = useCallback(async () => {
    isFetchingRef.current = false;
    setItems([]);
    setOffset(0);
    setTotalCount(canSearch ? null : 0);
    setError(null);

    if (!canSearch) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const params = buildParams(0);
      const [searchResponse, countResponse] = await Promise.all([
        searchScriptContents(params),
        searchScriptContentsCount({ q: params.q, file: params.file, folders: params.folders }),
      ]);

      setItems(Array.isArray(searchResponse.data) ? searchResponse.data : []);
      setOffset(CHUNK_SIZE);
      setTotalCount(getCount(countResponse.data));
    } catch (err) {
      console.error('Script content search failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler bei der Script-Suche');
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [buildParams, canSearch]);

  const loadMore = useCallback(async () => {
    if (!canSearch || isFetchingRef.current || loadingMore || loading) return;
    if (totalCount !== null && items.length >= totalCount) return;

    isFetchingRef.current = true;
    setLoadingMore(true);
    setError(null);

    try {
      const response = await searchScriptContents(buildParams(offset));
      const nextItems = Array.isArray(response.data) ? response.data : [];
      setItems(prev => [...prev, ...nextItems]);
      setOffset(prev => prev + CHUNK_SIZE);
    } catch (err) {
      console.error('Script content load more failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Nachladen der Script-Treffer');
    } finally {
      isFetchingRef.current = false;
      setLoadingMore(false);
    }
  }, [buildParams, canSearch, items.length, loading, loadingMore, offset, totalCount]);

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
    minQueryLength: MIN_QUERY_LENGTH,
    loadMore,
    reset,
  };
};

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTableOccurrenceUsage, getTableOccurrenceUsageCount } from '../api/client';
import type { TableOccurrenceUsageRow } from '../types';

const CHUNK_SIZE = 100;

interface UseInfiniteTableOccurrenceUsageOptions {
  query: string;
  selectedFile: string;
  unusedOnly: boolean;
  enabled: boolean;
}

interface UseInfiniteTableOccurrenceUsageResult {
  items: TableOccurrenceUsageRow[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalCount: number | null;
  error: string | null;
  loadMore: () => Promise<void>;
  reset: () => Promise<void>;
}

function getCount(data: { count?: number } | { count?: number }[] | undefined) {
  if (!data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return typeof row?.count === 'number' ? row.count : null;
}

export const useInfiniteTableOccurrenceUsage = ({
  query,
  selectedFile,
  unusedOnly,
  enabled,
}: UseInfiniteTableOccurrenceUsageOptions): UseInfiniteTableOccurrenceUsageResult => {
  const [items, setItems] = useState<TableOccurrenceUsageRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const trimmedQuery = query.trim();

  const buildParams = useCallback((withOffset = 0) => ({
    q: trimmedQuery || undefined,
    file: selectedFile || undefined,
    unused_only: unusedOnly,
    limit: CHUNK_SIZE,
    offset: withOffset,
  }), [trimmedQuery, selectedFile, unusedOnly]);

  const reset = useCallback(async () => {
    isFetchingRef.current = false;
    setItems([]);
    setOffset(0);
    setTotalCount(enabled ? null : 0);
    setError(null);

    if (!enabled) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const params = buildParams(0);
      const [usageResponse, countResponse] = await Promise.all([
        getTableOccurrenceUsage(params),
        getTableOccurrenceUsageCount({
          q: params.q,
          file: params.file,
          unused_only: params.unused_only,
        }),
      ]);

      setItems(Array.isArray(usageResponse.data) ? usageResponse.data : []);
      setOffset(CHUNK_SIZE);
      setTotalCount(getCount(countResponse.data));
    } catch (err) {
      console.error('Table occurrence usage search failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler bei der TO-Nutzungsanalyse');
      setTotalCount(null);
    } finally {
      setLoading(false);
    }
  }, [buildParams, enabled]);

  const loadMore = useCallback(async () => {
    if (!enabled || isFetchingRef.current || loadingMore || loading) return;
    if (totalCount !== null && items.length >= totalCount) return;

    isFetchingRef.current = true;
    setLoadingMore(true);
    setError(null);

    try {
      const response = await getTableOccurrenceUsage(buildParams(offset));
      const nextItems = Array.isArray(response.data) ? response.data : [];
      setItems(prev => [...prev, ...nextItems]);
      setOffset(prev => prev + CHUNK_SIZE);
    } catch (err) {
      console.error('Table occurrence usage load more failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Nachladen der TO-Nutzungen');
    } finally {
      isFetchingRef.current = false;
      setLoadingMore(false);
    }
  }, [buildParams, enabled, items.length, loading, loadingMore, offset, totalCount]);

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

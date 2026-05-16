import { useCallback, useEffect, useRef, useState } from 'react';
import { getObjectUsage, getObjectUsageCount } from '../api/client';
import type { ObjectUsageRow } from '../types';

const CHUNK_SIZE = 100;

interface UseInfiniteObjectUsageOptions {
  query: string;
  selectedFile: string;
  objectType: string;
  maxUsage: string;
  enabled: boolean;
}

interface UseInfiniteObjectUsageResult {
  items: ObjectUsageRow[];
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

function parseMaxUsage(value: string) {
  if (value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const useInfiniteObjectUsage = ({
  query,
  selectedFile,
  objectType,
  maxUsage,
  enabled,
}: UseInfiniteObjectUsageOptions): UseInfiniteObjectUsageResult => {
  const [items, setItems] = useState<ObjectUsageRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const trimmedQuery = query.trim();

  const buildParams = useCallback((withOffset = 0) => ({
    type: objectType || undefined,
    q: trimmedQuery || undefined,
    file: selectedFile || undefined,
    max_usage: parseMaxUsage(maxUsage),
    sort: 'rare' as const,
    limit: CHUNK_SIZE,
    offset: withOffset,
  }), [trimmedQuery, selectedFile, objectType, maxUsage]);

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
        getObjectUsage(params),
        getObjectUsageCount({
          type: params.type,
          q: params.q,
          file: params.file,
          max_usage: params.max_usage,
        }),
      ]);

      setItems(Array.isArray(usageResponse.data) ? usageResponse.data : []);
      setOffset(CHUNK_SIZE);
      setTotalCount(getCount(countResponse.data));
    } catch (err) {
      console.error('Object usage search failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler bei der Objekt-Nutzungsanalyse');
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
      const response = await getObjectUsage(buildParams(offset));
      const nextItems = Array.isArray(response.data) ? response.data : [];
      setItems(prev => [...prev, ...nextItems]);
      setOffset(prev => prev + CHUNK_SIZE);
    } catch (err) {
      console.error('Object usage load more failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Nachladen der Objekt-Nutzungen');
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

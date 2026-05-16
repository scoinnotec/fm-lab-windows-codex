import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLayoutObjectQualityFindings, getLayoutObjectQualityFindingsCount } from '../api/client';
import type { LayoutObjectQualityFindingRow } from '../types';

const PAGE_SIZE = 100;

interface UseInfiniteLayoutObjectQualityOptions {
  query: string;
  selectedFile?: string;
  category?: string;
  severity?: string;
  enabled?: boolean;
}

interface UseInfiniteLayoutObjectQualityResult {
  items: LayoutObjectQualityFindingRow[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalCount: number | null;
  error: string | null;
  loadMore: () => Promise<void>;
}

function extractCount(data: unknown): number | null {
  if (Array.isArray(data)) {
    const first = data[0] as { count?: number } | undefined;
    return typeof first?.count === 'number' ? first.count : null;
  }
  if (data && typeof data === 'object' && 'count' in data) {
    const count = (data as { count?: number }).count;
    return typeof count === 'number' ? count : null;
  }
  return null;
}

export const useInfiniteLayoutObjectQuality = ({
  query,
  selectedFile,
  category,
  severity,
  enabled = true,
}: UseInfiniteLayoutObjectQualityOptions): UseInfiniteLayoutObjectQualityResult => {
  const [items, setItems] = useState<LayoutObjectQualityFindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const params = useMemo(() => ({
    q: query.trim() || undefined,
    file: selectedFile || undefined,
    category: category || undefined,
    severity: severity || undefined,
    limit: PAGE_SIZE,
  }), [query, selectedFile, category, severity]);

  const reset = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setOffset(0);
      setHasMore(true);
      setTotalCount(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setOffset(0);

    try {
      const [listResponse, countResponse] = await Promise.all([
        getLayoutObjectQualityFindings({ ...params, offset: 0 }),
        getLayoutObjectQualityFindingsCount(params),
      ]);

      const rows = Array.isArray(listResponse.data) ? listResponse.data : [];
      setItems(rows);
      setOffset(rows.length);
      setHasMore(rows.length === PAGE_SIZE);
      setTotalCount(extractCount(countResponse.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Layout-Pruefung fehlgeschlagen');
      setItems([]);
      setHasMore(false);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [enabled, params]);

  useEffect(() => {
    void reset();
  }, [reset]);

  const loadMore = useCallback(async () => {
    if (!enabled || loading || loadingMore || !hasMore) return;

    setLoadingMore(true);
    setError(null);

    try {
      const response = await getLayoutObjectQualityFindings({ ...params, offset });
      const rows = Array.isArray(response.data) ? response.data : [];
      setItems(prev => [...prev, ...rows]);
      setOffset(prev => prev + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Weitere Layout-Fundstellen konnten nicht geladen werden');
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, loading, loadingMore, hasMore, params, offset]);

  return {
    items,
    loading,
    loadingMore,
    hasMore,
    totalCount,
    error,
    loadMore,
  };
};

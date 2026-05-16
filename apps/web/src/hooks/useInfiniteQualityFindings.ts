import { useCallback, useEffect, useMemo, useState } from 'react';
import { getQualityFindings, getQualityFindingsCount } from '../api/client';
import type { QualityFindingRow } from '../types';

const PAGE_SIZE = 100;

interface UseInfiniteQualityFindingsOptions {
  query: string;
  selectedFile?: string;
  area?: string;
  category?: string;
  severity?: string;
  objectType?: string;
  enabled?: boolean;
}

interface UseInfiniteQualityFindingsResult {
  items: QualityFindingRow[];
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

export const useInfiniteQualityFindings = ({
  query,
  selectedFile,
  area,
  category,
  severity,
  objectType,
  enabled = true,
}: UseInfiniteQualityFindingsOptions): UseInfiniteQualityFindingsResult => {
  const [items, setItems] = useState<QualityFindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const params = useMemo(() => ({
    q: query.trim() || undefined,
    file: selectedFile || undefined,
    area: area || undefined,
    category: category || undefined,
    severity: severity || undefined,
    type: objectType || undefined,
    limit: PAGE_SIZE,
  }), [query, selectedFile, area, category, severity, objectType]);

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
        getQualityFindings({ ...params, offset: 0 }),
        getQualityFindingsCount(params),
      ]);

      const rows = Array.isArray(listResponse.data) ? listResponse.data : [];
      setItems(rows);
      setOffset(rows.length);
      setHasMore(rows.length === PAGE_SIZE);
      setTotalCount(extractCount(countResponse.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Qualitaetspruefung fehlgeschlagen');
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
      const response = await getQualityFindings({ ...params, offset });
      const rows = Array.isArray(response.data) ? response.data : [];
      setItems(prev => [...prev, ...rows]);
      setOffset(prev => prev + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Weitere Pruefungen konnten nicht geladen werden');
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

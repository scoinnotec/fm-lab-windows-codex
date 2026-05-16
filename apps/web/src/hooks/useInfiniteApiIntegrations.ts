import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiIntegrations, getApiIntegrationsCount, getApiIntegrationSummary } from '../api/client';
import type { ApiIntegrationRow, ApiIntegrationSummaryRow } from '../types';

const PAGE_SIZE = 500;

interface UseInfiniteApiIntegrationsOptions {
  query: string;
  selectedFile?: string;
  family?: string;
  type?: string;
  risk?: string;
  secretOnly?: boolean;
  enabled?: boolean;
}

interface UseInfiniteApiIntegrationsResult {
  items: ApiIntegrationRow[];
  summary: ApiIntegrationSummaryRow[];
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

export const useInfiniteApiIntegrations = ({
  query,
  selectedFile,
  family,
  type,
  risk,
  secretOnly = false,
  enabled = true,
}: UseInfiniteApiIntegrationsOptions): UseInfiniteApiIntegrationsResult => {
  const [items, setItems] = useState<ApiIntegrationRow[]>([]);
  const [summary, setSummary] = useState<ApiIntegrationSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const params = useMemo(() => ({
    q: query.trim() || undefined,
    file: selectedFile || undefined,
    family: family || undefined,
    type: type || undefined,
    risk: risk || undefined,
    secret_only: secretOnly || undefined,
    limit: PAGE_SIZE,
  }), [query, selectedFile, family, type, risk, secretOnly]);

  const reset = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setSummary([]);
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
      const [listResponse, countResponse, summaryResponse] = await Promise.all([
        getApiIntegrations({ ...params, offset: 0 }),
        getApiIntegrationsCount(params),
        getApiIntegrationSummary({ ...params, limit: 300, offset: 0 }),
      ]);

      const rows = Array.isArray(listResponse.data) ? listResponse.data : [];
      setItems(rows);
      setOffset(rows.length);
      setHasMore(rows.length === PAGE_SIZE);
      setTotalCount(extractCount(countResponse.data));
      setSummary(Array.isArray(summaryResponse.data) ? summaryResponse.data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'API-Integrationen konnten nicht geladen werden');
      setItems([]);
      setSummary([]);
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
      const response = await getApiIntegrations({ ...params, offset });
      const rows = Array.isArray(response.data) ? response.data : [];
      setItems(prev => [...prev, ...rows]);
      setOffset(prev => prev + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Weitere API-Integrationen konnten nicht geladen werden');
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, loading, loadingMore, hasMore, params, offset]);

  return {
    items,
    summary,
    loading,
    loadingMore,
    hasMore,
    totalCount,
    error,
    loadMore,
  };
};

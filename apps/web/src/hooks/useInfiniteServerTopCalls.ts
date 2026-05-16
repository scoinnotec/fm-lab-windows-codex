import { useCallback, useEffect, useMemo, useState } from 'react';
import { getServerTopCallDashboard, getServerTopCallRows, getServerTopCallSummary, getServerTopCallSummaryCount, getServerTopCallWaitAnalysis } from '../api/client';
import type { ServerTopCallDashboardRow, ServerTopCallRow, ServerTopCallSummaryRow, ServerTopCallWaitAnalysis } from '../types';

const PAGE_SIZE = 300;

interface UseInfiniteServerTopCallsOptions {
  query: string;
  selectedFile?: string;
  objectType?: string;
  matchedOnly?: boolean;
  minElapsedMs?: number;
  enabled?: boolean;
}

interface UseInfiniteServerTopCallsResult {
  summary: ServerTopCallSummaryRow[];
  calls: ServerTopCallRow[];
  dashboard: ServerTopCallDashboardRow[];
  waitAnalysis: ServerTopCallWaitAnalysis | null;
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

export function useInfiniteServerTopCalls({
  query,
  selectedFile,
  objectType,
  matchedOnly = false,
  minElapsedMs,
  enabled = true,
}: UseInfiniteServerTopCallsOptions): UseInfiniteServerTopCallsResult {
  const [summary, setSummary] = useState<ServerTopCallSummaryRow[]>([]);
  const [calls, setCalls] = useState<ServerTopCallRow[]>([]);
  const [dashboard, setDashboard] = useState<ServerTopCallDashboardRow[]>([]);
  const [waitAnalysis, setWaitAnalysis] = useState<ServerTopCallWaitAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);

  const params = useMemo(() => ({
    q: query.trim() || undefined,
    file: selectedFile || undefined,
    object_type: objectType || undefined,
    matched_only: matchedOnly || undefined,
    min_elapsed_ms: minElapsedMs || undefined,
    limit: PAGE_SIZE,
  }), [query, selectedFile, objectType, matchedOnly, minElapsedMs]);

  const reset = useCallback(async () => {
    if (!enabled) {
      setSummary([]);
      setCalls([]);
      setDashboard([]);
      setWaitAnalysis(null);
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
      const [summaryResponse, countResponse, callsResponse, dashboardResponse, waitAnalysisResponse] = await Promise.all([
        getServerTopCallSummary({ ...params, offset: 0 }),
        getServerTopCallSummaryCount(params),
        getServerTopCallRows({ ...params, offset: 0 }),
        getServerTopCallDashboard(),
        getServerTopCallWaitAnalysis(params),
      ]);

      const summaryRows = Array.isArray(summaryResponse.data) ? summaryResponse.data : [];
      const callRows = Array.isArray(callsResponse.data) ? callsResponse.data : [];
      setSummary(summaryRows);
      setCalls(callRows);
      setOffset(summaryRows.length);
      setHasMore(summaryRows.length === PAGE_SIZE);
      setTotalCount(extractCount(countResponse.data));
      setDashboard(Array.isArray(dashboardResponse.data) ? dashboardResponse.data : []);
      setWaitAnalysis(waitAnalysisResponse.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Server-Logs konnten nicht geladen werden');
      setSummary([]);
      setCalls([]);
      setDashboard([]);
      setWaitAnalysis(null);
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
      const response = await getServerTopCallSummary({ ...params, offset });
      const rows = Array.isArray(response.data) ? response.data : [];
      setSummary(prev => [...prev, ...rows]);
      setOffset(prev => prev + rows.length);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Weitere Server-Log-Auswertungen konnten nicht geladen werden');
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, loading, loadingMore, hasMore, params, offset]);

  return {
    summary,
    calls,
    dashboard,
    waitAnalysis,
    loading,
    loadingMore,
    hasMore,
    totalCount,
    error,
    loadMore,
  };
}

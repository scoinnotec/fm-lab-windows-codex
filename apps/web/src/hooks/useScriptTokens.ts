import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchScriptTokens } from '../api/scriptTokensApi';
import type { ScriptTokens } from '../script/types';

interface UseScriptTokensResult {
  data: ScriptTokens | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

const cache = new Map<string, ScriptTokens>();

export const useScriptTokens = (uuid: string | undefined): UseScriptTokensResult => {
  const [data, setData] = useState<ScriptTokens | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    const cached = cache.get(uuid);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const tokens = await fetchScriptTokens(uuid);
      cache.set(uuid, tokens);
      setData(tokens);
    } catch (err) {
      console.error('Script-Token-Fetch fehlgeschlagen:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden des Scripts');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    if (uuid) {
      fetchData();
    } else {
      setData(null);
      setLoading(false);
      setError(null);
    }
  }, [fetchData, uuid]);

  return { data, loading, error, retry: fetchData };
};

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api/client';
import type { FMObject, ReferenceItem, GroupedReferences } from '../types';

interface UseObjectDetailResult {
  object: FMObject | null;
  references: GroupedReferences;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

// Simple in-memory cache (session-scoped)
const cache = new Map<string, { object: FMObject; references: GroupedReferences }>();

/**
 * Hook to fetch object details and references by UUID.
 * Parallel-fetches both endpoints and splits the flat reference array
 * into parent/child groups.
 */
export const useObjectDetail = (uuid: string | undefined): UseObjectDetailResult => {
  const [object, setObject] = useState<FMObject | null>(null);
  const [references, setReferences] = useState<GroupedReferences>({ parent: [], child: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isFetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (!uuid || isFetchingRef.current) return;

    // Check cache first
    const cached = cache.get(uuid);
    if (cached) {
      setObject(cached.object);
      setReferences(cached.references);
      setLoading(false);
      setError(null);
      return;
    }

    isFetchingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // Parallel fetch: object details + references
      const [objectResponse, refsResponse] = await Promise.all([
        api.get({ uuid }),
        api.references({ uuid, direction: 'all' }),
      ]);

      // Extract object data
      const objectData = objectResponse.data as FMObject;

      // Split flat reference array into parent/child groups
      // The API returns a flat array with a 'direction' discriminator field
      const flatRefs = (refsResponse.data ?? []) as unknown as ReferenceItem[];
      const grouped: GroupedReferences = {
        parent: flatRefs.filter(r => r.direction === 'parent'),
        child: flatRefs.filter(r => r.direction === 'child'),
      };

      // Cache the result
      cache.set(uuid, { object: objectData, references: grouped });

      setObject(objectData);
      setReferences(grouped);
    } catch (err) {
      console.error('Detail fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Objekt-Details');
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
    }
  }, [uuid]);

  useEffect(() => {
    setObject(null);
    setReferences({ parent: [], child: [] });
    fetchData();
  }, [fetchData]);

  return { object, references, loading, error, retry: fetchData };
};

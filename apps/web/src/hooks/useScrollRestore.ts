import { useCallback } from 'react';

// Module-level store for scroll positions (survives component remounts)
const scrollPositions = new Map<string, number>();

interface UseScrollRestoreResult {
  /** Save current scroll position of the given element */
  saveScrollPosition: (key: string, element: HTMLElement | null) => void;
  /** Restore a previously saved scroll position */
  restoreScrollPosition: (key: string, element: HTMLElement | null) => void;
}

/**
 * Hook for saving and restoring scroll positions.
 * Uses a module-level Map so positions survive component remounts
 * (e.g. when navigating away and back via React Router).
 */
export const useScrollRestore = (): UseScrollRestoreResult => {
  const saveScrollPosition = useCallback((key: string, element: HTMLElement | null) => {
    if (element) {
      scrollPositions.set(key, element.scrollTop);
    }
  }, []);

  const restoreScrollPosition = useCallback((key: string, element: HTMLElement | null) => {
    if (element) {
      const saved = scrollPositions.get(key);
      if (saved !== undefined) {
        requestAnimationFrame(() => {
          element.scrollTop = saved;
        });
      }
    }
  }, []);

  return { saveScrollPosition, restoreScrollPosition };
};

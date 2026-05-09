import { useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Codec zwischen typisiertem State und URL-Repräsentation.
 * `serialize` liefert `null`, wenn der Wert dem Default entspricht und der
 * Param ganz aus der URL entfernt werden soll (saubere URLs).
 */
export type UrlStateCodec<T> = {
  parse: (raw: string) => T;
  serialize: (value: T) => string | null;
};

export const stringCodec: UrlStateCodec<string> = {
  parse: (raw) => raw,
  serialize: (value) => (value === '' ? null : value),
};

/**
 * Set<string> als Komma-separierte Liste. Robust gegen leere Werte; verlangt,
 * dass die Set-Elemente kein Komma enthalten (in FileMaker-Object-Types der Fall).
 */
export const stringSetCodec: UrlStateCodec<Set<string>> = {
  parse: (raw) => new Set(raw.split(',').map(s => s.trim()).filter(Boolean)),
  serialize: (value) => (value.size === 0 ? null : Array.from(value).join(',')),
};

/**
 * Generischer Hook: synchronisiert ein State-Stück mit einem Query-Param.
 * Die URL ist Single Source of Truth — Updates landen via `replace: true`
 * im History-Eintrag, sodass jeder Tastendruck KEINEN neuen Eintrag erzeugt,
 * der Stack-State beim Zurück-Navigieren aber trotzdem stimmt.
 *
 * @param key URL-Param-Name (z.B. 'q', 'types', 'tab')
 * @param defaultValue Wert, der gilt, wenn der Param fehlt
 * @param codec Optional — Default ist `stringCodec`
 *
 * @example
 *   const [query, setQuery] = useUrlState('q', '');
 *   const [activeTypes, setActiveTypes] = useUrlState('types', new Set<string>(), stringSetCodec);
 */
export function useUrlState<T>(
  key: string,
  defaultValue: T,
  codec?: UrlStateCodec<T>,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const c = (codec ?? (stringCodec as unknown as UrlStateCodec<T>));

  // Default-Referenz stabil halten — sonst wechselt `value` bei jedem Render,
  // wenn defaultValue extern als Literal (z.B. `new Set()`) übergeben wird.
  const defaultRef = useRef(defaultValue);

  const raw = searchParams.get(key);
  const value = useMemo(
    () => (raw === null ? defaultRef.current : c.parse(raw)),
    // c absichtlich nicht in deps — Codec-Identität ist stabil (Module-level).
    // Wechselt sie doch (Test-Setup), greift der Re-Render durch raw-Wechsel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw],
  );

  // Live-Ref auf value, damit der Setter ohne Closure-Stale arbeitet
  // und stabile Referenz behalten kann (kein Re-Bind in Konsumenten).
  const valueRef = useRef(value);
  valueRef.current = value;

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setSearchParams(prev => {
      const newParams = new URLSearchParams(prev);
      const resolved = typeof next === 'function'
        ? (next as (p: T) => T)(valueRef.current)
        : next;
      const serialized = c.serialize(resolved);
      if (serialized === null) newParams.delete(key);
      else newParams.set(key, serialized);
      return newParams;
    }, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSearchParams, key]);

  return [value, setValue];
}

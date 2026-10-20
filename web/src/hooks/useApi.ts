import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, toApiError } from '../api/client';

/** Load data and track loading / error state. Stale responses from older requests are ignored. */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);

  const load = useCallback(
    async (silent = false) => {
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const result = await run();
        if (id === requestId.current) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (id === requestId.current) setError(toApiError(err));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [run],
  );

  useEffect(() => {
    load();
  }, [load]);

  return { data, error, loading, reload: () => load(), refresh: () => load(true), setData };
}

/** Run a mutation with a busy flag that blocks repeated clicks. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(async <R,>(action: () => Promise<R>): Promise<R | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    try {
      return await action();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

export function useDebounced<T>(value: T, delay = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · CivicEye` : 'CivicEye · Authority Dashboard';
  }, [title]);
}

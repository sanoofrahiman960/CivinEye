import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, toApiError } from '../api/client';

interface ApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  /** Re-run with the full-screen loader. */
  reload: () => Promise<void>;
  /** Re-run for pull-to-refresh, keeping current data visible. */
  refresh: () => Promise<void>;
  setData: (data: T) => void;
}

/**
 * Load data for a screen and track loading / error / refresh state.
 * With `refetchOnFocus`, data is reloaded silently whenever the screen comes back into view.
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = [], options: { refetchOnFocus?: boolean } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const firstFocus = useRef(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);

  const execute = useCallback(
    async (mode: 'load' | 'refresh' | 'silent') => {
      if (mode === 'load') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const result = await run();
        if (mounted.current) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mounted.current) setError(toApiError(err));
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [run],
  );

  useEffect(() => {
    mounted.current = true;
    execute('load');
    return () => {
      mounted.current = false;
    };
  }, [execute]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      if (options.refetchOnFocus) execute('silent');
    }, [execute, options.refetchOnFocus]),
  );

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => execute('load'),
    refresh: () => execute('refresh'),
    setData,
  };
}

/** Wrap a mutation with a `busy` flag that blocks repeated taps. */
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

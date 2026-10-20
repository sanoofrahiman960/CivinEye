import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

import { API_BASE } from '../config';
import type { ApiErrorBody, TokenPair } from '../types/api';

/**
 * Token handling for the browser.
 * - The short-lived access token lives only in memory.
 * - The refresh token lives in sessionStorage, so it is scoped to this tab and cleared when the tab
 *   closes. It is rotated on every refresh and blacklisted on logout by the backend.
 */
const REFRESH_KEY = 'civiceye.refresh';
let accessToken: string | null = null;

export const tokens = {
  get access() {
    return accessToken;
  },
  get refresh() {
    try {
      return sessionStorage.getItem(REFRESH_KEY);
    } catch {
      return null;
    }
  },
  save(pair: TokenPair) {
    accessToken = pair.access;
    try {
      sessionStorage.setItem(REFRESH_KEY, pair.refresh);
    } catch {
      // Storage blocked: the session simply won't survive a reload.
    }
  },
  clear() {
    accessToken = null;
    try {
      sessionStorage.removeItem(REFRESH_KEY);
    } catch {
      // ignore
    }
  },
};

/** Normalised error for every failed request. `code` matches the backend's `error.code`. */
export class ApiError extends Error {
  status: number;
  code: string;
  details: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isNetworkError() {
    return this.code === 'network_error' || this.code === 'timeout';
  }

  fieldError(field: string): string | undefined {
    const value = this.details[field];
    if (Array.isArray(value) && value.length) return String(value[0]);
    return typeof value === 'string' ? value : undefined;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<Partial<ApiErrorBody> & { detail?: string }>;
    if (axiosError.code === 'ECONNABORTED') return new ApiError(0, 'timeout', 'The request timed out. Please try again.');
    if (!axiosError.response) {
      return new ApiError(0, 'network_error', "Can't reach the CivicEye server. Check your connection or try again shortly.");
    }
    const { status, data } = axiosError.response;
    if (data && typeof data === 'object' && data.error) {
      return new ApiError(status, data.error.code, data.error.message, data.error.details ?? {});
    }
    return new ApiError(status, 'server_error', (data as { detail?: string })?.detail ?? 'Something went wrong on our side. Please try again.');
  }
  return new ApiError(0, 'unknown', error instanceof Error ? error.message : 'Unexpected error.');
}

export const http = axios.create({ baseURL: API_BASE, timeout: 30000, headers: { Accept: 'application/json' } });

let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

http.interceptors.request.use((config) => {
  if (accessToken && !config.headers.Authorization) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

/** Exchange the refresh token for a new pair. Returns null when the session can't be renewed. */
export async function refreshAccessToken(): Promise<string | null> {
  const refresh = tokens.refresh;
  if (!refresh) return null;
  try {
    const { data } = await axios.post<TokenPair>(`${API_BASE}/auth/token/refresh/`, { refresh }, { timeout: 15000 });
    tokens.save({ access: data.access, refresh: data.refresh ?? refresh });
    return data.access;
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.isNetworkError) throw apiError;
    return null;
  }
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = original?.url?.includes('/auth/login/') || original?.url?.includes('/auth/token/refresh/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall && tokens.refresh) {
      original._retried = true;
      refreshing = refreshing ?? refreshAccessToken().finally(() => (refreshing = null));
      try {
        const access = await refreshing;
        if (access) {
          original.headers.Authorization = `Bearer ${access}`;
          return http(original);
        }
        tokens.clear();
        onSessionExpired();
        return Promise.reject(new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.'));
      } catch (refreshError) {
        return Promise.reject(toApiError(refreshError));
      }
    }
    return Promise.reject(toApiError(error));
  },
);

export async function get<T>(url: string, config?: AxiosRequestConfig) {
  return (await http.get<T>(url, config)).data;
}
export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
  return (await http.post<T>(url, body, config)).data;
}
export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig) {
  return (await http.patch<T>(url, body, config)).data;
}

/** Multipart form; files are appended under `images`, the field the backend expects. */
export function buildFormData(fields: Record<string, string | number | boolean | null | undefined>, files: File[] = []) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
  });
  files.forEach((file) => form.append('images', file));
  return form;
}

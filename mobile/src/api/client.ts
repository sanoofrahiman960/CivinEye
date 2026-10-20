import axios, { AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';

import { API_BASE } from '../constants/config';
import type { ApiErrorBody, TokenPair } from '../types/api';
import { tokenStorage } from './tokenStorage';

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

  get isNetworkError(): boolean {
    return this.code === 'network_error' || this.code === 'timeout';
  }

  /** First message for one form field, if the backend reported field errors. */
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
    if (axiosError.code === 'ECONNABORTED') {
      return new ApiError(0, 'timeout', 'The request timed out. Check your connection and try again.');
    }
    if (!axiosError.response) {
      return new ApiError(0, 'network_error', "Can't reach CivicEye right now. Check your internet connection.");
    }
    const { status, data } = axiosError.response;
    if (data?.error) return new ApiError(status, data.error.code, data.error.message, data.error.details ?? {});
    if (status === 413) return new ApiError(status, 'payload_too_large', 'The photos are too large to upload.');
    // An HTML page instead of JSON means the request reached some other server (wrong URL, port or tunnel).
    const contentType = String(axiosError.response.headers?.['content-type'] ?? '');
    if (contentType.includes('text/html') && __DEV__) {
      return new ApiError(
        status,
        'wrong_server',
        `The server at ${API_BASE} isn't the CivicEye API (HTTP ${status}). Check EXPO_PUBLIC_API_URL in mobile/.env, ` +
          'and that your tunnel forwards to the CivicEye backend on port 8001 (ngrok http 8001).',
      );
    }
    return new ApiError(status, 'server_error', data?.detail ?? 'Something went wrong on our side. Please try again.');
  }
  return new ApiError(0, 'unknown', error instanceof Error ? error.message : 'Unexpected error.');
}

export const http = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  // The ngrok header stops ngrok's free-tier warning page from replacing API responses during development.
  headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
});

let onSessionExpired: () => void = () => {};

/** Called once by the auth store so the client can force a logout when refresh fails. */
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

http.interceptors.request.use((config) => {
  const access = tokenStorage.access;
  if (access && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${access}`;
  }
  return config;
});

// Access tokens are short-lived. On a 401, refresh once (shared by concurrent requests) and retry.
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = tokenStorage.refresh;
  if (!refresh) return null;
  try {
    const { data } = await axios.post<TokenPair>(`${API_BASE}/auth/token/refresh/`, { refresh }, { timeout: 15000 });
    await tokenStorage.save({ access: data.access, refresh: data.refresh ?? refresh });
    return data.access;
  } catch (error) {
    const apiError = toApiError(error);
    // Keep the session on a network failure; only a rejected token ends it.
    if (apiError.isNetworkError) throw apiError;
    return null;
  }
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
    const isAuthCall = original?.url?.includes('/auth/login/') || original?.url?.includes('/auth/token/refresh/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall && tokenStorage.refresh) {
      original._retried = true;
      refreshing = refreshing ?? refreshAccessToken().finally(() => (refreshing = null));
      try {
        const access = await refreshing;
        if (access) {
          original.headers.Authorization = `Bearer ${access}`;
          return http(original);
        }
        await tokenStorage.clear();
        onSessionExpired();
        return Promise.reject(new ApiError(401, 'session_expired', 'Your session has expired. Please sign in again.'));
      } catch (refreshError) {
        return Promise.reject(toApiError(refreshError));
      }
    }
    return Promise.reject(toApiError(error));
  },
);

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await http.get<T>(url, config)).data;
}

export async function post<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await http.post<T>(url, body, config)).data;
}

export async function patch<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return (await http.patch<T>(url, body, config)).data;
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  return (await http.delete<T>(url, config)).data;
}

/** A local photo to upload. `uri` is a file:// URI from the camera, picker or manipulator. */
export interface UploadablePhoto {
  uri: string;
  name?: string;
  type?: string;
}

/** Build multipart form data. Photos are appended under the `images` field the backend expects. */
export function buildFormData(fields: Record<string, string | number | boolean | null | undefined>, photos: UploadablePhoto[] = []) {
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
  });
  photos.forEach((photo, index) => {
    // React Native's FormData accepts { uri, name, type } file descriptors.
    form.append('images', {
      uri: photo.uri,
      name: photo.name ?? `photo-${index + 1}.jpg`,
      type: photo.type ?? 'image/jpeg',
    } as unknown as Blob);
  });
  return form;
}

export async function postMultipart<T>(url: string, form: FormData): Promise<T> {
  const response = await http.post<T>(url, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (data) => data,
    timeout: 120000,
  });
  return response.data;
}

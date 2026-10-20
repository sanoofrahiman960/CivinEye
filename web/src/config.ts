/** Backend base URL (without `/api`). Set VITE_API_URL for staging/production builds. */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? 'http://127.0.0.1:8001';
export const API_BASE = `${API_URL}/api`;

export const APP_NAME = 'CivicEye';

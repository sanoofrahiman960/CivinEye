import Constants from 'expo-constants';
import { Platform } from 'react-native';

const BACKEND_PORT = 8001;

/**
 * Backend base URL (without the trailing `/api`).
 *
 * 1. `EXPO_PUBLIC_API_URL` in `mobile/.env` always wins (use it for physical devices and production).
 * 2. In development, reuse the host the Expo dev server is running on, so a phone on the same Wi-Fi
 *    reaches the Django server on your computer automatically.
 * 3. Fall back to the Android emulator alias (10.0.2.2) or localhost for the iOS simulator.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const hostUri = Constants.expoConfig?.hostUri;
  const devHost = hostUri?.split(':')[0];
  if (devHost && devHost !== 'localhost' && devHost !== '127.0.0.1') {
    return `http://${devHost}:${BACKEND_PORT}`;
  }
  return Platform.OS === 'android' ? `http://10.0.2.2:${BACKEND_PORT}` : `http://localhost:${BACKEND_PORT}`;
}

export const API_URL = resolveApiUrl();
export const API_BASE = `${API_URL}/api`;

export const APP_NAME = 'CivicEye';
export const TAGLINE = 'Report it. Track it. Improve your community.';

/** Longest edge of photos after on-device compression. */
export const MAX_PHOTO_EDGE = 1600;
export const PHOTO_QUALITY = 0.7;

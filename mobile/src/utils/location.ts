import * as Location from 'expo-location';

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}

export type LocationResult =
  | { ok: true; coords: Coordinates }
  | { ok: false; reason: 'permission_denied' | 'services_disabled' | 'unavailable'; message: string };

/** Ask for permission and read a fresh GPS fix, explaining each failure in plain language. */
export async function getCurrentLocation(): Promise<LocationResult> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    return {
      ok: false,
      reason: 'permission_denied',
      message: 'Location permission is off. You can still drop the pin on the map yourself, or enable location in Settings.',
    };
  }
  if (!(await Location.hasServicesEnabledAsync())) {
    return {
      ok: false,
      reason: 'services_disabled',
      message: 'Location services are turned off. Turn on GPS, or place the pin on the map manually.',
    };
  }
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      ok: true,
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      },
    };
  } catch {
    const last = await Location.getLastKnownPositionAsync().catch(() => null);
    if (last) {
      return {
        ok: true,
        coords: { latitude: last.coords.latitude, longitude: last.coords.longitude, accuracy: last.coords.accuracy },
      };
    }
    return { ok: false, reason: 'unavailable', message: "We couldn't get a GPS fix. Move the pin to the right spot on the map." };
  }
}

/** Human-readable address for a point, or an empty string if reverse geocoding is unavailable. */
export async function reverseGeocode({ latitude, longitude }: Coordinates): Promise<string> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return '';
    const parts = [
      place.name && place.name !== place.street ? place.name : null,
      [place.streetNumber, place.street].filter(Boolean).join(' ') || null,
      place.district,
      place.city ?? place.subregion,
      place.postalCode,
    ].filter((part): part is string => Boolean(part));
    return Array.from(new Set(parts)).join(', ');
  } catch {
    return '';
  }
}

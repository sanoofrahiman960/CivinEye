import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Marker, type MapPressEvent, type Region } from 'react-native-maps';

import { colors, radius, spacing, typography } from '../theme';
import { formatCoordinate } from '../utils/format';
import MapView, { type MapViewInstance } from './SafeMapView';
import { getCurrentLocation, reverseGeocode, type Coordinates } from '../utils/location';
import { Banner, Button, TextField } from './ui';

export interface PickedLocation extends Coordinates {
  address: string;
}

interface LocationPickerProps {
  value: PickedLocation | null;
  onChange: (value: PickedLocation) => void;
  error?: string;
}

/** Default view when no GPS fix is available yet (Kochi, Kerala). */
const FALLBACK_REGION: Region = { latitude: 9.9816, longitude: 76.2999, latitudeDelta: 0.05, longitudeDelta: 0.05 };

/**
 * GPS location with an interactive map. The citizen can drag the pin or tap the map to correct it,
 * and edit the reverse-geocoded address before submitting.
 */
export function LocationPicker({ value, onChange, error }: LocationPickerProps) {
  const map = useRef<MapViewInstance>(null);
  const [locating, setLocating] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  async function moveTo(coords: Coordinates, keepAccuracy = false) {
    const next: PickedLocation = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: keepAccuracy ? coords.accuracy : null,
      address: valueRef.current?.address ?? '',
    };
    onChange(next);
    map.current?.animateToRegion({ ...next, latitudeDelta: 0.005, longitudeDelta: 0.005 }, 400);
    setGeocoding(true);
    const address = await reverseGeocode(coords);
    setGeocoding(false);
    if (address) onChange({ ...next, address });
  }

  async function useMyLocation() {
    setLocating(true);
    setMessage(null);
    const result = await getCurrentLocation();
    setLocating(false);
    if (result.ok) {
      await moveTo(result.coords, true);
    } else {
      setMessage(result.message);
      if (!valueRef.current) onChange({ ...FALLBACK_REGION, accuracy: null, address: '' });
    }
  }

  useEffect(() => {
    if (!value) useMyLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMapPress = (event: MapPressEvent) => moveTo(event.nativeEvent.coordinate);

  return (
    <View>
      {message ? <Banner tone="warning" message={message} /> : null}
      <View style={[styles.mapWrap, error ? { borderColor: colors.danger } : null]}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={value ? { ...value, latitudeDelta: 0.005, longitudeDelta: 0.005 } : FALLBACK_REGION}
          onPress={onMapPress}
          showsUserLocation
          accessibilityLabel="Map. Tap to move the issue location pin."
        >
          {value ? (
            <Marker
              coordinate={{ latitude: value.latitude, longitude: value.longitude }}
              draggable
              onDragEnd={(event) => moveTo(event.nativeEvent.coordinate)}
              title="Issue location"
              description="Drag to adjust"
              pinColor={colors.primary}
            />
          ) : null}
        </MapView>
        {locating ? (
          <View style={styles.locating}>
            <ActivityIndicator color={colors.primary} />
            <Text style={typography.caption}>Finding your location…</Text>
          </View>
        ) : null}
      </View>
      <Text style={[typography.small, { marginTop: spacing.xs }]}>Tap the map or drag the pin to the exact spot.</Text>

      <Button
        title="Use my current location"
        icon="locate"
        variant="outline"
        onPress={useMyLocation}
        loading={locating}
        style={{ marginVertical: spacing.md }}
        compact
      />

      {value ? (
        <>
          <View style={styles.coords}>
            <Ionicons name="navigate" size={14} color={colors.textMuted} />
            <Text style={typography.caption}>
              {formatCoordinate(value.latitude, value.longitude)}
              {value.accuracy ? ` · ±${Math.round(value.accuracy)} m` : ''}
            </Text>
            {geocoding ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>
          <TextField
            label="Address / landmark"
            value={value.address}
            onChangeText={(address) => onChange({ ...value, address })}
            placeholder="e.g. Near MG Road bus stop"
            hint="Check the address and add a landmark if it helps the crew find it."
            maxLength={255}
          />
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  mapWrap: {
    height: 260,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  locating: {
    position: 'absolute',
    top: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  coords: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
});

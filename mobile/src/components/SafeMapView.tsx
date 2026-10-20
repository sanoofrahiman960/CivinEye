import Ionicons from '@expo/vector-icons/Ionicons';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type { ComponentProps, Ref } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import RNMapView from 'react-native-maps';

import { colors, spacing, typography } from '../theme';

export type MapViewInstance = RNMapView;
type SafeMapViewProps = ComponentProps<typeof RNMapView> & { ref?: Ref<RNMapView> };

/**
 * Whether a native map can be shown. On Android, react-native-maps uses Google Maps, and a development or
 * store build without a Google Maps API key crashes the whole app the moment a map renders.
 * Expo Go ships its own key, and iOS uses Apple Maps, so only Android builds need GOOGLE_MAPS_ANDROID_API_KEY.
 */
export function mapsAvailable(): boolean {
  if (Platform.OS !== 'android') return true;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return true; // Expo Go
  return Boolean(Constants.expoConfig?.extra?.googleMapsConfigured);
}

/** Drop-in replacement for react-native-maps' MapView that shows a notice instead of crashing without a key. */
export default function SafeMapView({ ref, style, ...props }: SafeMapViewProps) {
  if (mapsAvailable()) return <RNMapView ref={ref} style={style} {...props} />;
  return (
    <View style={[style, styles.placeholder]} accessible accessibilityLabel="Map unavailable">
      <Ionicons name="map-outline" size={32} color={colors.textSubtle} />
      <Text style={styles.title}>Map unavailable in this build</Text>
      <Text style={styles.text}>
        Add GOOGLE_MAPS_ANDROID_API_KEY to mobile/.env and rebuild the app. Location is still captured from GPS.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
    backgroundColor: colors.surfaceMuted,
  },
  title: { ...typography.subheading, textAlign: 'center' },
  text: { ...typography.small, textAlign: 'center' },
});

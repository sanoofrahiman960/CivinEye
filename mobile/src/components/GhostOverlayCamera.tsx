import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing } from '../theme';
import { compressPhoto, type LocalPhoto } from '../utils/image';
import { Button, IconButton } from './ui';

export interface ProofCapture extends LocalPhoto {
  capture_latitude: number | null;
  capture_longitude: number | null;
  capture_accuracy_m: number | null;
  captured_at: string;
}

interface GhostOverlayCameraProps {
  visible: boolean;
  /** The original report photo, shown semi-transparently so the officer can match the angle. */
  referenceImageUrl: string | null;
  onClose: () => void;
  onCapture: (capture: ProofCapture) => void;
}

const OPACITY_STEPS = [0, 0.3, 0.55];

/**
 * Proof-Lock camera: resolution photos are taken in-app (never from the gallery) together with the
 * device's GPS position, which the backend compares with the reported location.
 */
export function GhostOverlayCamera({ visible, referenceImageUrl, onClose, onCapture }: GhostOverlayCameraProps) {
  const camera = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [opacityIndex, setOpacityIndex] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const locationPermission = await Location.requestForegroundPermissionsAsync();
      const positionPromise =
        locationPermission.status === 'granted'
          ? Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(() => null)
          : Promise.resolve(null);
      const picture = await camera.current.takePictureAsync({ quality: 0.85 });
      const position = await positionPromise;
      const photo = await compressPhoto({ uri: picture.uri, width: picture.width, height: picture.height });
      onCapture({
        ...photo,
        capture_latitude: position?.coords.latitude ?? null,
        capture_longitude: position?.coords.longitude ?? null,
        capture_accuracy_m: position?.coords.accuracy ?? null,
        captured_at: new Date().toISOString(),
      });
      if (!position) {
        setError('No GPS position was recorded. The photo will be flagged for supervisor review.');
      }
    } catch {
      setError("Couldn't take the photo. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <IconButton icon="close" label="Close camera" color="#fff" onPress={onClose} />
          <Text style={styles.title}>Resolution photo</Text>
          <View style={{ width: 44 }} />
        </View>

        {!permission ? (
          <ActivityIndicator color="#fff" style={{ flex: 1 }} />
        ) : !permission.granted ? (
          <View style={styles.permission}>
            <Ionicons name="camera" size={48} color="#fff" />
            <Text style={styles.permissionText}>
              Camera access is needed to take the resolution photo at the issue location.
            </Text>
            <Button title="Allow camera" onPress={requestPermission} />
          </View>
        ) : (
          <View style={styles.cameraWrap}>
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
            {referenceImageUrl && OPACITY_STEPS[opacityIndex] > 0 ? (
              <Image
                source={{ uri: referenceImageUrl }}
                style={[StyleSheet.absoluteFill, { opacity: OPACITY_STEPS[opacityIndex] }]}
                contentFit="cover"
                pointerEvents="none"
              />
            ) : null}
            <View style={styles.hint}>
              <Text style={styles.hintText}>Line up with the original photo, then capture.</Text>
            </View>
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.controls}>
          <Pressable
            onPress={() => setOpacityIndex((i) => (i + 1) % OPACITY_STEPS.length)}
            accessibilityRole="button"
            accessibilityLabel={`Original photo overlay ${OPACITY_STEPS[opacityIndex] === 0 ? 'off' : 'on'}. Double tap to change.`}
            style={styles.sideControl}
          >
            <Ionicons name="layers" size={24} color="#fff" />
            <Text style={styles.sideText}>{OPACITY_STEPS[opacityIndex] === 0 ? 'Overlay off' : `Overlay ${Math.round(OPACITY_STEPS[opacityIndex] * 100)}%`}</Text>
          </Pressable>
          <Pressable
            onPress={capture}
            disabled={busy || !permission?.granted}
            accessibilityRole="button"
            accessibilityLabel="Take resolution photo"
            style={[styles.shutter, busy && { opacity: 0.6 }]}
          >
            {busy ? <ActivityIndicator color={colors.primary} /> : <View style={styles.shutterInner} />}
          </Pressable>
          <View style={styles.sideControl} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  cameraWrap: { flex: 1, overflow: 'hidden', borderRadius: radius.lg, marginHorizontal: spacing.sm },
  hint: { position: 'absolute', top: spacing.md, alignSelf: 'center', backgroundColor: colors.overlay, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  hintText: { color: '#fff', fontSize: 13 },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xl },
  permissionText: { color: '#fff', textAlign: 'center', fontSize: 16 },
  error: { color: '#FCA5A5', textAlign: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: spacing.xl },
  sideControl: { width: 90, alignItems: 'center', gap: 4 },
  sideText: { color: '#fff', fontSize: 12 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});

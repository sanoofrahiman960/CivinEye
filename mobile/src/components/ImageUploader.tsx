import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { compressPhoto, type LocalPhoto } from '../utils/image';
import { Button } from './ui';

interface ImageUploaderProps {
  photos: LocalPhoto[];
  onChange: (photos: LocalPhoto[]) => void;
  max?: number;
  label?: string;
  error?: string;
  /** Hide the gallery option (used where evidence must be captured on the spot). */
  cameraOnly?: boolean;
}

function permissionAlert(what: string) {
  Alert.alert(
    `${what} access needed`,
    `CivicEye needs ${what.toLowerCase()} access to attach photos. You can enable it in Settings.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}

/** Take or pick photos, preview them, remove or retake, and compress before they are uploaded. */
export function ImageUploader({ photos, onChange, max = 5, label = 'Photos', error, cameraOnly }: ImageUploaderProps) {
  const [processing, setProcessing] = useState(false);
  const remaining = max - photos.length;

  async function addAssets(assets: ImagePicker.ImagePickerAsset[], replaceIndex?: number) {
    setProcessing(true);
    try {
      const compressed = await Promise.all(
        assets.slice(0, replaceIndex === undefined ? remaining : 1).map((a) => compressPhoto({ uri: a.uri, width: a.width, height: a.height })),
      );
      if (replaceIndex !== undefined) {
        const next = [...photos];
        next[replaceIndex] = compressed[0];
        onChange(next);
      } else {
        onChange([...photos, ...compressed]);
      }
    } catch {
      Alert.alert('Photo problem', "We couldn't process that photo. Please try another one.");
    } finally {
      setProcessing(false);
    }
  }

  async function takePhoto(replaceIndex?: number) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return permissionAlert('Camera');
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (!result.canceled) await addAssets(result.assets, replaceIndex);
  }

  async function pickFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return permissionAlert('Photo library');
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
    });
    if (!result.canceled) await addAssets(result.assets);
  }

  function photoActions(index: number) {
    Alert.alert('Photo', undefined, [
      { text: 'Retake', onPress: () => takePhoto(index) },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(photos.filter((_, i) => i !== index)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label} <Text style={typography.small}>({photos.length}/{max})</Text>
      </Text>
      {photos.length ? (
        <View style={styles.grid}>
          {photos.map((photo, index) => (
            <Pressable
              key={photo.uri}
              onPress={() => photoActions(index)}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${index + 1}. Double tap to retake or remove.`}
            >
              <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="cover" />
              <View style={styles.editBadge}>
                <Ionicons name="create" size={14} color={colors.textOnPrimary} />
              </View>
            </Pressable>
          ))}
          {processing ? (
            <View style={[styles.preview, styles.processing]}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}
        </View>
      ) : processing ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
      ) : (
        <View style={[styles.empty, error ? { borderColor: colors.danger } : null]}>
          <Ionicons name="camera-outline" size={32} color={colors.textSubtle} />
          <Text style={typography.caption}>Add a clear photo of the problem</Text>
        </View>
      )}
      {remaining > 0 ? (
        <View style={styles.actions}>
          <Button title="Take photo" icon="camera" onPress={() => takePhoto()} style={{ flex: 1 }} compact disabled={processing} />
          {!cameraOnly ? (
            <Button title="Gallery" icon="images" variant="outline" onPress={pickFromGallery} style={{ flex: 1 }} compact disabled={processing} />
          ) : null}
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  label: { ...typography.subheading, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  preview: { width: 96, height: 96, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  processing: { alignItems: 'center', justifyContent: 'center' },
  editBadge: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: colors.overlay,
    borderRadius: radius.pill,
    padding: 4,
  },
  empty: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
});

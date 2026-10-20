import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../theme';
import type { IssueImage } from '../types/api';
import { formatDateTime } from '../utils/format';
import { IconButton } from './ui';

const TYPE_LABELS: Record<IssueImage['image_type'], string> = {
  REPORT: 'Reported',
  ADDITIONAL_EVIDENCE: 'Extra evidence',
  RESOLUTION: 'Resolution',
  REOPEN_EVIDENCE: 'Reopen evidence',
  DURABILITY_EVIDENCE: 'Follow-up',
};

/** Horizontal strip of thumbnails; tapping one opens a full-screen viewer. */
export function PhotoGallery({ images, emptyText = 'No photos' }: { images: IssueImage[]; emptyText?: string }) {
  const [open, setOpen] = useState<IssueImage | null>(null);
  if (!images.length) return <Text style={typography.caption}>{emptyText}</Text>;
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {images.map((image) => (
          <Pressable
            key={image.id}
            onPress={() => setOpen(image)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${TYPE_LABELS[image.image_type]} photo. Double tap to view full screen.`}
          >
            <Image source={{ uri: image.thumbnail_url }} style={styles.thumb} contentFit="cover" />
            <Text style={styles.tag}>{TYPE_LABELS[image.image_type]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={!!open} animationType="fade" onRequestClose={() => setOpen(null)} transparent={false}>
        <SafeAreaView style={styles.viewer}>
          <View style={styles.viewerHeader}>
            <Text style={styles.viewerTitle}>{open ? TYPE_LABELS[open.image_type] : ''}</Text>
            <IconButton icon="close" label="Close photo" color="#fff" onPress={() => setOpen(null)} />
          </View>
          {open ? <Image source={{ uri: open.image_url }} style={styles.full} contentFit="contain" /> : null}
          {open ? (
            <Text style={styles.viewerCaption}>
              {open.caption ? `${open.caption} · ` : ''}
              {formatDateTime(open.uploaded_at)}
            </Text>
          ) : null}
        </SafeAreaView>
      </Modal>
    </>
  );
}

export function ProofLockLabel({ image }: { image: IssueImage }) {
  if (image.image_type !== 'RESOLUTION' || image.distance_from_issue_m === null) return null;
  const ok = image.proof_check_status === 'PASSED' || image.proof_check_status === 'OVERRIDDEN';
  return (
    <View style={styles.proof}>
      <Ionicons name={ok ? 'location' : 'warning'} size={14} color={ok ? colors.success : colors.warning} />
      <Text style={[typography.small, { color: ok ? colors.success : colors.warning }]}>
        Photo taken {Math.round(image.distance_from_issue_m)} m from your report
        {image.proof_check_status === 'OVERRIDDEN' ? ' (reviewed by a supervisor)' : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { gap: spacing.sm, paddingVertical: spacing.xs },
  thumb: { width: 110, height: 110, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  tag: { ...typography.small, marginTop: 4, textAlign: 'center' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg },
  viewerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  full: { flex: 1 },
  viewerCaption: { color: '#E2E8F0', textAlign: 'center', padding: spacing.lg },
  proof: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.xs },
});

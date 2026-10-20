import { Image } from 'expo-image';
import { useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import type { IssueImage } from '../types/api';
import { ProofLockLabel } from './PhotoGallery';

/**
 * Drag the divider to compare the original report photo with the resolution photo.
 * Screen reader users get both photos described in text instead of the gesture.
 */
export function BeforeAfterSlider({ before, after }: { before: IssueImage; after: IssueImage }) {
  const [width, setWidth] = useState(0);
  const [position, setPosition] = useState(0.5);

  const responder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => width && setPosition(Math.min(1, Math.max(0, event.nativeEvent.locationX / width))),
    onPanResponderMove: (event) => width && setPosition(Math.min(1, Math.max(0, event.nativeEvent.locationX / width))),
  });

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const split = width * position;

  return (
    <View>
      <View
        style={styles.frame}
        onLayout={onLayout}
        {...responder.panHandlers}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Before and after comparison. Left shows the reported problem, right shows the resolution photo."
      >
        <Image source={{ uri: after.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
        <View style={[styles.beforeClip, { width: split }]}>
          <Image source={{ uri: before.image_url }} style={[styles.beforeImage, { width }]} contentFit="cover" />
        </View>
        <View style={[styles.divider, { left: split - 1.5 }]}>
          <View style={styles.handle} />
        </View>
        <Text style={[styles.tag, { left: spacing.sm }]}>Before</Text>
        <Text style={[styles.tag, { right: spacing.sm }]}>After</Text>
      </View>
      <Text style={[typography.small, { marginTop: spacing.xs }]}>Drag across the photo to compare.</Text>
      <ProofLockLabel image={after} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 240, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  beforeClip: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  beforeImage: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  divider: { position: 'absolute', top: 0, bottom: 0, width: 3, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  handle: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 3, borderColor: colors.primary },
  tag: {
    position: 'absolute',
    top: spacing.sm,
    backgroundColor: colors.overlay,
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
});

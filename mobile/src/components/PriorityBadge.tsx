import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { PRIORITY_STYLES, radius, spacing } from '../theme';
import type { Priority } from '../types/api';

/** Priority shown with colour, icon and text so it never relies on colour alone. */
export function PriorityBadge({ priority, size = 'md' }: { priority: Priority; size?: 'sm' | 'md' }) {
  const style = PRIORITY_STYLES[priority];
  const small = size === 'sm';
  return (
    <View
      style={[styles.badge, { backgroundColor: style.background, borderColor: style.color }, small && styles.small]}
      accessible
      accessibilityLabel={`Priority: ${style.label}`}
    >
      <Ionicons name={style.icon} size={small ? 12 : 14} color={style.color} />
      <Text style={[styles.text, { color: style.text }, small && styles.smallText]}>{style.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  small: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 13, fontWeight: '700' },
  smallText: { fontSize: 11 },
});

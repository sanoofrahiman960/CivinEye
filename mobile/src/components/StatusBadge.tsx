import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing, STATUS_STYLES } from '../theme';
import type { IssueStatus } from '../types/api';

export function StatusBadge({ status, long = false, size = 'md' }: { status: IssueStatus; long?: boolean; size?: 'sm' | 'md' }) {
  const style = STATUS_STYLES[status];
  const small = size === 'sm';
  return (
    <View
      style={[styles.badge, { backgroundColor: style.background }, small && styles.small]}
      accessible
      accessibilityLabel={`Status: ${style.longLabel}`}
    >
      <Ionicons name={style.icon} size={small ? 12 : 14} color={style.color} />
      <Text style={[styles.text, { color: style.text }, small && styles.smallText]} numberOfLines={long ? 2 : 1}>
        {long ? style.longLabel : style.label}
      </Text>
    </View>
  );
}

export function OverdueBadge() {
  return (
    <View style={[styles.badge, styles.overdue]} accessible accessibilityLabel="Overdue">
      <Ionicons name="time" size={12} color="#991B1B" />
      <Text style={[styles.smallText, { color: '#991B1B', fontWeight: '700' }]}>Overdue</Text>
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
    flexShrink: 1,
  },
  small: { paddingHorizontal: 6, paddingVertical: 2 },
  text: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  smallText: { fontSize: 11, fontWeight: '700' },
  overdue: { backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 2 },
});

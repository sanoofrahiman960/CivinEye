import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import type { IssueListItem, OfficerMini } from '../types/api';
import { formatDate, formatRelative } from '../utils/format';
import { PriorityBadge } from './PriorityBadge';
import { OverdueBadge, StatusBadge } from './StatusBadge';
import { Card } from './ui';

interface IssueCardProps {
  issue: IssueListItem & { assigned_officer?: OfficerMini | null; days_open?: number; department?: { name: string } | null };
  onPress: () => void;
  /** Authority lists also show department, officer and days open. */
  showAssignment?: boolean;
}

export function IssueCard({ issue, onPress, showAssignment }: IssueCardProps) {
  const label = `${issue.complaint_id}, ${issue.title}, ${issue.category.name}, status ${issue.status}, priority ${issue.priority}`;
  return (
    <Card onPress={onPress} style={styles.card} accessibilityLabel={label}>
      <View style={styles.row}>
        {issue.thumbnail_url ? (
          <Image source={{ uri: issue.thumbnail_url }} style={styles.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Ionicons name="image-outline" size={26} color={colors.textSubtle} />
          </View>
        )}
        <View style={styles.body}>
          <Text style={styles.complaintId}>{issue.complaint_id}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {issue.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {issue.category.name}
          </Text>
        </View>
      </View>

      {issue.address ? (
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={14} color={colors.textMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {issue.address}
          </Text>
        </View>
      ) : null}

      {showAssignment ? (
        <View style={styles.metaRow}>
          <Ionicons name="business-outline" size={14} color={colors.textMuted} />
          <Text style={styles.meta} numberOfLines={1}>
            {issue.department?.name ?? 'Unassigned'} · {issue.assigned_officer?.full_name ?? 'No officer'}
            {issue.days_open !== undefined ? ` · ${issue.days_open} day${issue.days_open === 1 ? '' : 's'} open` : ''}
          </Text>
        </View>
      ) : null}

      <View style={styles.badges}>
        <StatusBadge status={issue.status} size="sm" />
        <PriorityBadge priority={issue.priority} size="sm" />
        {issue.is_overdue ? <OverdueBadge /> : null}
        {issue.impact_count > 0 ? (
          <View style={styles.impact} accessible accessibilityLabel={`${issue.impact_count} other people affected`}>
            <Ionicons name="people" size={12} color={colors.textMuted} />
            <Text style={styles.impactText}>+{issue.impact_count}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Text style={typography.small}>Reported {formatDate(issue.created_at)}</Text>
        <Text style={typography.small}>Updated {formatRelative(issue.updated_at)}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  complaintId: { fontSize: 12, fontWeight: '700', color: colors.primary, letterSpacing: 0.3 },
  title: { ...typography.subheading, marginTop: 2 },
  meta: { ...typography.caption, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  impact: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted },
  impactText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
});

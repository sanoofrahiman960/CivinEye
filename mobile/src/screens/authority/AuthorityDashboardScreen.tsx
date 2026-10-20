import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { authorityApi } from '../../api/authorityApi';
import { BarChart, KpiCard, TrendChart, type BarDatum } from '../../components/Charts';
import { ErrorState, LoadingState } from '../../components/States';
import { Screen } from '../../components/Screen';
import { Banner, Button, Card, SectionHeader } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import type { AuthorityTabParamList, AuthorityTabScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { colors, PRIORITY_STYLES, radius, spacing, STATUS_STYLES, TOUCH_TARGET, typography, type IconName } from '../../theme';
import type { Dashboard, DurationStats, IssueStatus, Priority } from '../../types/api';
import { formatDateTime, formatHours } from '../../utils/format';

type Period = 'weekly' | 'monthly';
type KpiKey = keyof Dashboard['kpis'];
type IssuesParams = NonNullable<AuthorityTabParamList['Issues']>;

const OPEN_STATUSES: IssueStatus[] = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED'];

/** Each KPI tile and the Issues-tab filters that reproduce the same set of issues. */
const KPI_TILES: { key: KpiKey; label: string; icon: IconName; color: string; filters: IssuesParams }[] = [
  { key: 'total', label: 'Total issues', icon: 'albums-outline', color: colors.authority, filters: {} },
  {
    key: 'awaiting_review',
    label: 'New / awaiting review',
    icon: 'mail-unread-outline',
    color: STATUS_STYLES.SUBMITTED.color,
    filters: { status: ['SUBMITTED', 'REOPENED'] },
  },
  {
    key: 'critical_high',
    label: 'Critical & high (open)',
    icon: 'alert-circle-outline',
    color: PRIORITY_STYLES.CRITICAL.color,
    filters: { priority: ['CRITICAL', 'HIGH'], status: OPEN_STATUSES },
  },
  { key: 'in_progress', label: 'In progress', icon: 'construct-outline', color: STATUS_STYLES.IN_PROGRESS.color, filters: { status: ['IN_PROGRESS'] } },
  { key: 'overdue', label: 'Overdue', icon: 'time-outline', color: colors.danger, filters: { overdue: true } },
  {
    key: 'awaiting_verification',
    label: 'Awaiting citizen verification',
    icon: 'shield-checkmark-outline',
    color: STATUS_STYLES.RESOLVED.color,
    filters: { status: ['RESOLVED'] },
  },
  { key: 'reopened', label: 'Reopened', icon: 'refresh-circle-outline', color: STATUS_STYLES.REOPENED.color, filters: { status: ['REOPENED'] } },
  { key: 'closed', label: 'Closed', icon: 'checkmark-done-circle-outline', color: STATUS_STYLES.CLOSED.color, filters: { status: ['CLOSED'] } },
];

function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function isStatus(key: string): key is IssueStatus {
  return key in STATUS_STYLES;
}

function isPriority(key: string): key is Priority {
  return key in PRIORITY_STYLES;
}

export function AuthorityDashboardScreen({ navigation }: AuthorityTabScreenProps<'Dashboard'>) {
  const user = useAuthStore((s) => s.user);
  const [period, setPeriod] = useState<Period>('weekly');
  const { data, error, loading, refreshing, refresh, reload } = useApi(() => authorityApi.dashboard(period), [period], { refetchOnFocus: true });

  const scope = user?.role === 'ADMIN' ? 'All departments' : user?.department?.name ?? 'No department assigned';
  const firstName = user?.full_name.split(' ')[0] ?? '';

  if (loading && !data) return <LoadingState message="Loading dashboard…" />;
  if (!data) return <ErrorState error={error} onRetry={reload} />;

  // A fresh params object every time, so tapping the same tile again re-applies its filters.
  const openIssues = (filters: IssuesParams) =>
    navigation.navigate('AuthorityTabs', {
      screen: 'Issues',
      params: {
        status: filters.status ? [...filters.status] : undefined,
        priority: filters.priority ? [...filters.priority] : undefined,
        overdue: filters.overdue,
      },
    });

  const categoryData: BarDatum[] = data.by_category.map((point) => ({ label: point.label, value: point.value }));
  const statusData: BarDatum[] = data.by_status.map((point) =>
    isStatus(point.key)
      ? { label: STATUS_STYLES[point.key].label, value: point.value, color: STATUS_STYLES[point.key].color }
      : { label: point.label, value: point.value },
  );
  const priorityData: BarDatum[] = data.by_priority.map((point) =>
    isPriority(point.key)
      ? { label: PRIORITY_STYLES[point.key].label, value: point.value, color: PRIORITY_STYLES[point.key].color }
      : { label: point.label, value: point.value },
  );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={styles.hero}>
        <Text style={styles.greeting}>
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </Text>
        <View style={styles.scopeRow}>
          <Ionicons name="business-outline" size={16} color={colors.authority} />
          <Text style={styles.scope}>{scope}</Text>
        </View>
        <Text style={typography.small}>Updated {formatDateTime(data.generated_at)}</Text>
      </View>

      {error ? <Banner tone="warning" title="Couldn't refresh" message={error.message} action={{ label: 'Try again', onPress: refresh }} /> : null}

      <SectionHeader title="At a glance" />
      <View style={styles.kpiGrid}>
        {KPI_TILES.map((tile) => (
          <KpiCard
            key={tile.key}
            label={tile.label}
            value={data.kpis[tile.key]}
            icon={tile.icon}
            color={tile.color}
            onPress={() => openIssues(tile.filters)}
          />
        ))}
      </View>
      <Text style={[typography.small, styles.hint]}>Tap a tile to see those issues.</Text>

      <SectionHeader title="Response times" />
      <Card style={styles.durationCard}>
        <DurationRow title="Time to resolve" icon="checkmark-circle-outline" stats={data.resolution_time} noun="resolved" />
        <View style={styles.divider} />
        <DurationRow title="Time to acknowledge" icon="eye-outline" stats={data.acknowledgement_time} noun="acknowledged" />
        <Text style={[typography.small, { marginTop: spacing.sm }]}>Measured from submission, for issues reported in the last 90 days.</Text>
      </Card>

      <View style={styles.trendHeader}>
        <Text style={typography.heading} accessibilityRole="header">
          Trend
        </Text>
        <View style={styles.segmented} accessibilityRole="tablist">
          {(['weekly', 'monthly'] as Period[]).map((value) => {
            const active = value === period;
            return (
              <Pressable
                key={value}
                onPress={() => setPeriod(value)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={value === 'weekly' ? 'Weekly trend' : 'Monthly trend'}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{value === 'weekly' ? 'Weekly' : 'Monthly'}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Card>
        <View style={styles.trendTitleRow}>
          <Text style={typography.caption}>
            {data.trend.period === 'monthly' ? 'Last 6 months' : 'Last 8 weeks'} · reported vs resolved
          </Text>
          {loading ? <ActivityIndicator size="small" color={colors.authority} accessibilityLabel="Updating trend" /> : null}
        </View>
        <TrendChart points={data.trend.points} />
      </Card>

      <SectionHeader title="By status" />
      <Card>
        <BarChart data={statusData} emptyText="No issues yet" />
      </Card>

      <SectionHeader title="By priority" />
      <Card>
        <BarChart data={priorityData} emptyText="No issues yet" />
      </Card>

      <SectionHeader title="By category" />
      <Card>
        <BarChart data={categoryData} emptyText="No issues yet" />
      </Card>

      <Button
        title="Reports & export"
        icon="document-text-outline"
        color={colors.authority}
        onPress={() => navigation.navigate('Reports')}
        style={{ marginTop: spacing.xl }}
        accessibilityHint="Opens department reports and CSV export"
      />
    </Screen>
  );
}

function DurationRow({ title, icon, stats, noun }: { title: string; icon: IconName; stats: DurationStats; noun: string }) {
  const empty = stats.sample_size === 0;
  return (
    <View
      accessible
      accessibilityLabel={
        empty
          ? `${title}: no ${noun} issues yet`
          : `${title}: average ${formatHours(stats.average_hours)}, median ${formatHours(stats.median_hours)}, based on ${stats.sample_size} issues`
      }
    >
      <View style={styles.durationTitle}>
        <Ionicons name={icon} size={18} color={colors.authority} />
        <Text style={typography.subheading}>{title}</Text>
      </View>
      {empty ? (
        <Text style={typography.caption}>No {noun} issues yet.</Text>
      ) : (
        <>
          <View style={styles.durationValues}>
            <View style={styles.durationValue}>
              <Text style={styles.durationNumber}>{formatHours(stats.average_hours)}</Text>
              <Text style={typography.small}>Average</Text>
            </View>
            <View style={styles.durationValue}>
              <Text style={styles.durationNumber}>{formatHours(stats.median_hours)}</Text>
              <Text style={typography.small}>Median</Text>
            </View>
          </View>
          <Text style={typography.small}>
            Based on {stats.sample_size} {noun} issue{stats.sample_size === 1 ? '' : 's'}
          </Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    backgroundColor: colors.authorityLight,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  greeting: { ...typography.title, color: colors.authority },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  scope: { ...typography.subheading, color: colors.authority },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  hint: { marginTop: spacing.sm },
  durationCard: { gap: spacing.sm },
  durationTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  durationValues: { flexDirection: 'row', gap: spacing.xl, marginBottom: spacing.xs },
  durationValue: { minWidth: 90 },
  durationNumber: { fontSize: 22, fontWeight: '800', color: colors.text },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  trendTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.authority,
    overflow: 'hidden',
  },
  segment: { minHeight: TOUCH_TARGET, minWidth: 84, paddingHorizontal: spacing.md, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.authority },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.authority },
  segmentTextActive: { color: colors.textOnPrimary },
});

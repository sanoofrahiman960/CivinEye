import Ionicons from '@expo/vector-icons/Ionicons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, View } from 'react-native';

import { authorityApi, type AuthorityIssueQuery } from '../../api/authorityApi';
import { toApiError } from '../../api/client';
import { ErrorState, LoadingState } from '../../components/States';
import { Screen } from '../../components/Screen';
import { Banner, Button, Card, ChipGroup, SectionHeader } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import type { AuthorityStackScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { colors, radius, spacing, TOUCH_TARGET, typography } from '../../theme';
import type { DepartmentReportRow, IssueStatus } from '../../types/api';
import { formatHours } from '../../utils/format';
import { DATE_RANGE_OPTIONS, dateFromForRange, STATUS_FILTER_OPTIONS, type DateRange } from './AuthorityIssuesScreen';

function fileTimestamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 1000) / 10}%`;
}

export function ReportsScreen(_props: AuthorityStackScreenProps<'Reports'>) {
  const user = useAuthStore((s) => s.user);
  const [statuses, setStatuses] = useState<IssueStatus[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>('any');
  const [overdue, setOverdue] = useState(false);
  const { busy: exporting, run } = useAction();

  const query = useMemo<AuthorityIssueQuery>(
    () => ({ status: statuses, date_from: dateFromForRange(dateRange), overdue: overdue || undefined }),
    [statuses, dateRange, overdue],
  );
  const queryKey = JSON.stringify(query);
  const { data, error, loading, refreshing, refresh, reload } = useApi(() => authorityApi.reportSummary(query), [queryKey], { refetchOnFocus: true });

  const filtered = statuses.length > 0 || dateRange !== 'any' || overdue;
  const scope = user?.role === 'ADMIN' ? 'All departments' : user?.department?.name ?? 'Your department';

  function clearFilters() {
    setStatuses([]);
    setDateRange('any');
    setOverdue(false);
  }

  function exportCsv() {
    run(async () => {
      try {
        const csvText = await authorityApi.exportCsv(query);
        const file = new File(Paths.cache, `civiceye-report-${fileTimestamp()}.csv`);
        if (file.exists) file.delete();
        file.create();
        await file.write(csvText);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, {
            mimeType: 'text/csv',
            dialogTitle: 'Export CivicEye report',
            UTI: 'public.comma-separated-values-text',
          });
        } else {
          Alert.alert('Report saved', `Sharing isn't available on this device. The CSV file was saved to:\n${file.uri}`);
        }
      } catch (e) {
        Alert.alert('Export failed', toApiError(e).message);
      }
    });
  }

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={refresh}
      footer={
        <Button
          title={exporting ? 'Preparing CSV…' : 'Export CSV'}
          icon="download-outline"
          color={colors.authority}
          loading={exporting}
          disabled={!data || data.total === 0}
          onPress={exportCsv}
          accessibilityHint="Exports the filtered issues as a spreadsheet file and opens the share sheet"
        />
      }
    >
      <View style={styles.scopeRow}>
        <Ionicons name="business-outline" size={16} color={colors.authority} />
        <Text style={styles.scope}>{scope}</Text>
      </View>

      <Card>
        <Text style={[typography.subheading, styles.filterTitle]}>Status</Text>
        <ChipGroup
          options={STATUS_FILTER_OPTIONS}
          selected={statuses}
          onToggle={(value) => setStatuses((current) => (current.includes(value) ? current.filter((s) => s !== value) : [...current, value]))}
        />
        <Text style={[typography.subheading, styles.filterTitle, { marginTop: spacing.lg }]}>Reported</Text>
        <ChipGroup options={DATE_RANGE_OPTIONS} selected={[dateRange]} onToggle={setDateRange} />
        <View style={styles.switchRow}>
          <Text style={[typography.subheading, { flex: 1 }]}>Overdue only</Text>
          <Switch
            value={overdue}
            onValueChange={setOverdue}
            accessibilityLabel="Include overdue issues only"
            trackColor={{ true: colors.authority, false: colors.borderStrong }}
          />
        </View>
        {filtered ? (
          <Button title="Clear filters" variant="ghost" color={colors.authority} compact onPress={clearFilters} style={{ alignSelf: 'flex-start' }} />
        ) : null}
      </Card>

      {loading && !data ? (
        <LoadingState message="Loading report…" />
      ) : !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <>
          {error ? <Banner tone="warning" title="Couldn't refresh" message={error.message} action={{ label: 'Try again', onPress: refresh }} /> : null}

          <View style={styles.totalCard} accessible accessibilityLabel={`${data.total} issues${filtered ? ' match these filters' : ''}`}>
            <View style={{ flex: 1 }}>
              <Text style={styles.totalValue}>{data.total}</Text>
              <Text style={styles.totalLabel}>{filtered ? 'Issues matching these filters' : 'Issues in total'}</Text>
            </View>
            {loading ? <ActivityIndicator color={colors.authority} accessibilityLabel="Updating report" /> : null}
          </View>

          <SectionHeader title="By department" />
          {data.departments.length ? (
            data.departments.map((row) => <DepartmentCard key={row.department_id ?? 'unassigned'} row={row} />)
          ) : (
            <Card>
              <Text style={typography.caption}>No issues match these filters.</Text>
            </Card>
          )}
          <Text style={[typography.small, { marginTop: spacing.sm }]}>
            Reopen rate is the share of resolved issues that were reopened at least once. The CSV export lists each matching issue (up to 10,000).
          </Text>
        </>
      )}
    </Screen>
  );
}

function DepartmentCard({ row }: { row: DepartmentReportRow }) {
  const metrics: { label: string; value: string; tone?: string }[] = [
    { label: 'Total', value: String(row.total) },
    { label: 'Open', value: String(row.open) },
    { label: 'Resolved', value: String(row.resolved) },
    { label: 'Overdue', value: String(row.overdue), tone: row.overdue > 0 ? colors.danger : undefined },
    { label: 'Reopen rate', value: formatRate(row.reopen_rate) },
    { label: 'Avg. resolution', value: formatHours(row.average_resolution_hours) },
  ];
  return (
    <Card style={styles.departmentCard}>
      <Text style={typography.subheading} accessibilityRole="header">
        {row.department}
      </Text>
      <View style={styles.metrics}>
        {metrics.map((metric) => (
          <View key={metric.label} style={styles.metric} accessible accessibilityLabel={`${metric.label}: ${metric.value}`}>
            <Text style={[styles.metricValue, metric.tone ? { color: metric.tone } : null]}>{metric.value}</Text>
            <Text style={typography.small}>{metric.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  scope: { ...typography.subheading, color: colors.authority },
  filterTitle: { marginBottom: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET + 8, marginTop: spacing.md },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.authorityLight,
  },
  totalValue: { fontSize: 32, fontWeight: '800', color: colors.authority },
  totalLabel: { ...typography.caption, color: colors.authority },
  departmentCard: { marginBottom: spacing.md },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm, rowGap: spacing.md },
  metric: { width: '33.33%', paddingRight: spacing.sm },
  metricValue: { fontSize: 18, fontWeight: '700', color: colors.text },
});

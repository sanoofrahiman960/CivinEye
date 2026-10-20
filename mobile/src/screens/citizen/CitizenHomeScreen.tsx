import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { issueApi } from '../../api/issueApi';
import { IssueCard } from '../../components/IssueCard';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Banner, Button, Card, SectionHeader } from '../../components/ui';
import { useApi } from '../../hooks/useApi';
import type { CitizenTabScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { useOfflineStore } from '../../store/offlineStore';
import { colors, radius, spacing, TOUCH_TARGET, typography, type IconName } from '../../theme';
import type { IssueStatus, IssueSummary } from '../../types/api';
import { formatRelative } from '../../utils/format';

interface CountCard {
  key: keyof IssueSummary['counts'];
  label: string;
  icon: IconName;
  color: string;
  background: string;
  status: IssueStatus[];
}

const COUNT_CARDS: CountCard[] = [
  { key: 'total', label: 'My Issues', icon: 'documents', color: colors.primary, background: colors.primaryLight, status: [] },
  {
    key: 'open',
    label: 'Open',
    icon: 'paper-plane',
    color: '#1E40AF',
    background: '#DBEAFE',
    status: ['SUBMITTED', 'ACKNOWLEDGED', 'REOPENED'],
  },
  { key: 'in_progress', label: 'In progress', icon: 'construct', color: '#92400E', background: '#FEF3C7', status: ['IN_PROGRESS'] },
  {
    key: 'awaiting_verification',
    label: 'Resolved – verify',
    icon: 'shield-checkmark',
    color: '#115E59',
    background: '#CCFBF1',
    status: ['RESOLVED'],
  },
  { key: 'closed', label: 'Closed', icon: 'checkmark-done-circle', color: '#166534', background: '#DCFCE7', status: ['CLOSED'] },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export function CitizenHomeScreen({ navigation }: CitizenTabScreenProps<'Home'>) {
  const user = useAuthStore((s) => s.user);
  const pending = useOfflineStore((s) => s.pending);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const { data, error, loading, refreshing, reload, refresh } = useApi(() => issueApi.summary(), [], { refetchOnFocus: true });

  // Keep the offline queue count current whenever Home comes into view.
  useFocusEffect(
    useCallback(() => {
      useOfflineStore
        .getState()
        .refresh()
        .catch(() => undefined);
    }, []),
  );

  const firstName = user?.full_name.trim().split(/\s+/)[0] ?? '';

  const openMyIssues = (status: IssueStatus[]) => navigation.navigate('CitizenTabs', { screen: 'MyIssues', params: { status } });

  const onRefresh = () => {
    refresh();
    useOfflineStore
      .getState()
      .refresh()
      .catch(() => undefined);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh} edges={[]}>
      <Text style={typography.caption}>{greeting()},</Text>
      <Text style={styles.welcome} accessibilityRole="header">
        {firstName ? `Welcome, ${firstName}` : 'Welcome to CivicEye'}
      </Text>
      <Text style={[typography.caption, { marginBottom: spacing.lg }]}>Spotted a problem in your neighbourhood? Let the right people know.</Text>

      {!isOnline ? (
        <Banner tone="warning" icon="cloud-offline" title="You're offline" message="You can still report issues. They will be sent when you're back online." />
      ) : null}

      {pending.length > 0 ? (
        <Banner
          tone="info"
          icon="cloud-upload"
          title="Pending offline reports"
          message={`${pending.length} report${pending.length === 1 ? ' is' : 's are'} saved on this device waiting to be sent.`}
          action={{ label: 'Review pending reports', onPress: () => navigation.navigate('PendingReports') }}
        />
      ) : null}

      <Pressable
        onPress={() => navigation.navigate('ReportIssue')}
        accessibilityRole="button"
        accessibilityLabel="Report a new issue"
        accessibilityHint="Opens the step-by-step report form"
        style={({ pressed }) => [styles.reportButton, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.reportIcon}>
          <Ionicons name="camera" size={30} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportTitle}>Report a new issue</Text>
          <Text style={styles.reportSubtitle}>Photo, location and a short description — about a minute.</Text>
        </View>
        <Ionicons name="chevron-forward" size={24} color={colors.textOnPrimary} />
      </Pressable>

      {loading && !data ? (
        <LoadingState message="Loading your issues…" />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <>
          <SectionHeader title="Your issues at a glance" />
          <View style={styles.countGrid}>
            {COUNT_CARDS.map((card) => {
              const count = data.counts[card.key];
              return (
                <Pressable
                  key={card.key}
                  onPress={() => openMyIssues(card.status)}
                  accessibilityRole="button"
                  accessibilityLabel={`${card.label}: ${count}`}
                  accessibilityHint="Opens My Issues with this filter"
                  style={({ pressed }) => [styles.countCard, card.key === 'total' && styles.countCardWide, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.countIcon, { backgroundColor: card.background }]}>
                    <Ionicons name={card.icon} size={20} color={card.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.countValue}>{count}</Text>
                    <Text style={styles.countLabel} numberOfLines={2}>
                      {card.label}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {data.pending_durability_checks.length > 0 ? (
            <>
              <SectionHeader title="Is it still fixed?" />
              {data.pending_durability_checks.map((check) => (
                <Card
                  key={check.id}
                  onPress={() => navigation.navigate('IssueDetail', { issueId: check.issue.id })}
                  accessibilityLabel={`Is it still fixed? ${check.issue.complaint_id}, ${check.issue.title}. Opens the issue to answer.`}
                  style={styles.checkCard}
                >
                  <View style={styles.checkIcon}>
                    <Ionicons name="help-buoy" size={22} color={colors.info} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkId}>{check.issue.complaint_id}</Text>
                    <Text style={typography.subheading} numberOfLines={2}>
                      {check.issue.title}
                    </Text>
                    <Text style={typography.caption}>
                      {check.issue.category.name} · asked {formatRelative(check.sent_at ?? check.due_at)}
                    </Text>
                    <Text style={styles.checkPrompt}>Tell us if the fix is holding up</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
                </Card>
              ))}
            </>
          ) : null}

          <SectionHeader
            title="Recently updated"
            action={data.recent.length ? { label: 'See all', onPress: () => openMyIssues([]) } : undefined}
          />
          {data.recent.length ? (
            data.recent.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onPress={() => navigation.navigate('IssueDetail', { issueId: issue.id })} />
            ))
          ) : (
            <Card>
              <EmptyState
                icon="document-text-outline"
                title="No reports yet"
                message="Issues you report will appear here so you can follow their progress."
              />
            </Card>
          )}
        </>
      ) : null}

      <SectionHeader title="Around you" />
      <Card
        onPress={() => navigation.navigate('Map')}
        accessibilityLabel="Issues near you. Opens the map of reported issues."
        style={styles.nearCard}
      >
        <View style={[styles.checkIcon, { backgroundColor: colors.primaryLight }]}>
          <Ionicons name="map" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={typography.subheading}>Issues near you</Text>
          <Text style={typography.caption}>See what others have reported and say if it affects you too.</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
      </Card>

      {data && !loading ? (
        <Button
          title="Report a new issue"
          icon="add-circle"
          variant="outline"
          onPress={() => navigation.navigate('ReportIssue')}
          style={{ marginTop: spacing.xl }}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  welcome: { ...typography.title, marginTop: 2, marginBottom: spacing.xs },
  reportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: TOUCH_TARGET * 2,
  },
  reportIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportTitle: { fontSize: 19, fontWeight: '700', color: colors.textOnPrimary },
  reportSubtitle: { fontSize: 13, color: colors.primaryLight, marginTop: 2 },
  countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  countCard: {
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 72,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  countCardWide: { flexBasis: '100%' },
  countIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  countValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  countLabel: { ...typography.caption, fontWeight: '600' },
  checkCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md, borderLeftWidth: 4, borderLeftColor: colors.info },
  checkIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  checkId: { fontSize: 12, fontWeight: '700', color: colors.primary },
  checkPrompt: { fontSize: 13, fontWeight: '700', color: colors.info, marginTop: spacing.xs },
  nearCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});

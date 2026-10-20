import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { toApiError, type ApiError } from '../../api/client';
import { notificationApi } from '../../api/notificationApi';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Button } from '../../components/ui';
import { useNotificationStore } from '../../store/notificationStore';
import { colors, radius, spacing, typography, type IconName } from '../../theme';
import type { AppNotification, NotificationType } from '../../types/api';
import { formatRelative } from '../../utils/format';

const ICONS: Record<NotificationType, IconName> = {
  ISSUE_SUBMITTED: 'paper-plane',
  NEW_ISSUE: 'add-circle',
  LIFE_SAFETY_ALERT: 'warning',
  ISSUE_ACKNOWLEDGED: 'eye',
  ISSUE_ASSIGNED: 'person-add',
  WORK_STARTED: 'construct',
  VERIFICATION_REQUESTED: 'shield-checkmark',
  ISSUE_REOPENED: 'refresh-circle',
  ISSUE_CLOSED: 'checkmark-done-circle',
  SLA_BREACH: 'time',
  PRIORITY_CHANGED: 'flag',
  NEW_COMMENT: 'chatbubble-ellipses',
  DURABILITY_CHECK: 'help-buoy',
  RECURRENCE_REPORTED: 'repeat',
};

const URGENT: NotificationType[] = ['LIFE_SAFETY_ALERT', 'SLA_BREACH'];

export function NotificationsScreen({ openIssue }: { openIssue: (issueId: number) => void }) {
  const setUnread = useNotificationStore((s) => s.setUnread);
  const refreshUnread = useNotificationStore((s) => s.refreshUnread);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [next, setNext] = useState<number | null>(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async (page: number, mode: 'initial' | 'refresh' | 'more') => {
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'more') setLoadingMore(true);
    try {
      const data = await notificationApi.list(page);
      setItems((current) => (page === 1 ? data.results : [...current, ...data.results]));
      setNext(data.next ? page + 1 : null);
      setError(null);
      if (page === 1) refreshUnread();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [refreshUnread]);

  useFocusEffect(
    useCallback(() => {
      load(1, 'initial');
    }, [load]),
  );

  async function open(item: AppNotification) {
    if (!item.is_read) {
      setItems((current) => current.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
      notificationApi.markRead(item.id).then(refreshUnread).catch(() => undefined);
    }
    if (item.issue) openIssue(item.issue);
  }

  async function markAll() {
    try {
      await notificationApi.markAllRead();
      setItems((current) => current.map((n) => ({ ...n, is_read: true })));
      setUnread(0);
    } catch (err) {
      Alert.alert('Could not update', toApiError(err).message);
    }
  }

  if (loading) return <LoadingState message="Loading notifications…" />;
  if (error && !items.length) return <ErrorState error={error} onRetry={() => load(1, 'initial')} />;

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.list}
      style={{ backgroundColor: colors.background }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(1, 'refresh')} tintColor={colors.primary} />}
      onEndReachedThreshold={0.4}
      onEndReached={() => next && !loadingMore && load(next, 'more')}
      ListHeaderComponent={
        items.some((n) => !n.is_read) ? (
          <Button title="Mark all as read" variant="ghost" icon="checkmark-done" onPress={markAll} compact style={{ alignSelf: 'flex-end' }} />
        ) : undefined
      }
      ListEmptyComponent={<EmptyState icon="notifications-outline" title="No notifications yet" message="Updates about your issues will appear here." />}
      ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.lg }} /> : undefined}
      renderItem={({ item }) => {
        const urgent = URGENT.includes(item.notification_type);
        return (
          <Pressable
            onPress={() => open(item)}
            accessibilityRole="button"
            accessibilityLabel={`${item.is_read ? '' : 'Unread. '}${item.title}. ${item.message}. ${formatRelative(item.created_at)}`}
            style={({ pressed }) => [styles.item, !item.is_read && styles.unread, pressed && { opacity: 0.85 }]}
          >
            <View style={[styles.icon, urgent && { backgroundColor: colors.dangerLight }]}>
              <Ionicons name={ICONS[item.notification_type] ?? 'notifications'} size={20} color={urgent ? colors.danger : colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[typography.subheading, !item.is_read && { fontWeight: '800' }]}>{item.title}</Text>
              <Text style={typography.caption}>{item.message}</Text>
              <Text style={[typography.small, { marginTop: 4 }]}>
                {item.complaint_id ? `${item.complaint_id} · ` : ''}
                {formatRelative(item.created_at)}
              </Text>
            </View>
            {!item.is_read ? <View style={styles.dot} accessibilityElementsHidden /> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: spacing.lg, flexGrow: 1 },
  item: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  unread: { borderLeftWidth: 4, borderLeftColor: colors.primary },
  icon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
});

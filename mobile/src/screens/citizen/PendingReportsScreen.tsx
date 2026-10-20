import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toApiError } from '../../api/client';
import { EmptyState } from '../../components/States';
import { Banner, Button, Card } from '../../components/ui';
import type { CitizenStackScreenProps } from '../../navigation/types';
import type { QueuedReport } from '../../offline/queue';
import { useOfflineStore } from '../../store/offlineStore';
import { useReferenceStore } from '../../store/referenceStore';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDateTime, formatRelative } from '../../utils/format';

export function PendingReportsScreen({ navigation }: CitizenStackScreenProps<'PendingReports'>) {
  const pending = useOfflineStore((s) => s.pending);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const flushing = useOfflineStore((s) => s.flushing);
  const categories = useReferenceStore((s) => s.categories);
  const offlineQueueEnabled = useReferenceStore((s) => s.isEnabled('offline_queue'));
  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reloadQueue = useCallback(async () => {
    setRefreshing(true);
    try {
      await useOfflineStore.getState().refresh();
    } catch (error) {
      Alert.alert("Couldn't read saved reports", toApiError(error).message);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    useOfflineStore
      .getState()
      .refresh()
      .catch(() => undefined);
  }, []);

  const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? 'Unknown category';

  async function sendNow() {
    try {
      const result = await useOfflineStore.getState().flush();
      if (!result) return; // A send is already in progress.
      const sent = result.sent.length;
      if (sent === 0 && result.remaining > 0) {
        Alert.alert('Not sent yet', `${result.remaining} report${result.remaining === 1 ? ' is' : 's are'} still waiting. Check your connection and try again.`);
        return;
      }
      const message =
        `${sent} report${sent === 1 ? ' was' : 's were'} sent.` +
        (result.remaining ? ` ${result.remaining} still waiting${result.failed ? ' — see the messages below' : ''}.` : '');
      const first = result.sent[0];
      Alert.alert(
        'Reports sent',
        message,
        sent === 1 && first
          ? [
              { text: 'OK', style: 'cancel' },
              { text: `View ${first.complaint_id}`, onPress: () => navigation.navigate('IssueDetail', { issueId: first.id }) },
            ]
          : [{ text: 'OK' }],
      );
    } catch (error) {
      Alert.alert("Couldn't send reports", toApiError(error).message);
    }
  }

  function confirmDelete(item: QueuedReport) {
    Alert.alert('Delete this report?', `"${item.input.title}" and its photos will be removed from this device. This cannot be undone.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(item.input.client_submission_id);
          try {
            await useOfflineStore.getState().remove(item.input.client_submission_id);
          } catch (error) {
            Alert.alert("Couldn't delete", toApiError(error).message);
          } finally {
            setDeletingId(null);
          }
        },
      },
    ]);
  }

  function renderItem({ item }: { item: QueuedReport }) {
    const thumb = item.photoUris[0];
    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" accessibilityLabel="First photo of this report" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]}>
              <Ionicons name="image-outline" size={24} color={colors.textSubtle} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={typography.subheading} numberOfLines={2}>
              {item.input.title}
            </Text>
            <Text style={typography.caption} numberOfLines={1}>
              {categoryName(item.input.category)}
            </Text>
            <Text style={typography.small}>
              Saved {formatRelative(item.queuedAt)} · {formatDateTime(item.queuedAt)}
            </Text>
            <Text style={typography.small}>
              {item.photoUris.length} photo{item.photoUris.length === 1 ? '' : 's'}
              {item.attempts ? ` · ${item.attempts} attempt${item.attempts === 1 ? '' : 's'}` : ''}
            </Text>
          </View>
        </View>
        {item.input.address ? (
          <View style={styles.address}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text style={[typography.caption, { flex: 1 }]} numberOfLines={1}>
              {item.input.address}
            </Text>
          </View>
        ) : null}
        {item.lastError ? (
          <View style={{ marginTop: spacing.sm }}>
            <Banner
              tone="danger"
              title="The server could not accept this report"
              message={`${item.lastError} Delete it and submit a new report if it can't be sent.`}
            />
          </View>
        ) : null}
        <Button
          title="Delete"
          icon="trash-outline"
          variant="ghost"
          color={colors.danger}
          onPress={() => confirmDelete(item)}
          loading={deletingId === item.input.client_submission_id}
          disabled={flushing}
          compact
          style={styles.deleteButton}
          accessibilityHint={`Deletes the saved report ${item.input.title}`}
        />
      </Card>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <FlatList
        data={pending}
        keyExtractor={(item) => item.input.client_submission_id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reloadQueue} tintColor={colors.primary} />}
        ListHeaderComponent={
          <>
            <View
              style={[styles.connectivity, { backgroundColor: isOnline ? colors.successLight : colors.warningLight }]}
              accessible
              accessibilityLabel={isOnline ? 'Connection status: online' : 'Connection status: offline'}
              accessibilityLiveRegion="polite"
            >
              <Ionicons name={isOnline ? 'wifi' : 'cloud-offline'} size={20} color={isOnline ? colors.success : colors.warning} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.connectivityTitle, { color: isOnline ? colors.success : colors.warning }]}>
                  {isOnline ? 'Online' : 'Offline'}
                </Text>
                <Text style={typography.caption}>
                  {isOnline
                    ? 'Saved reports are sent automatically. You can also send them now.'
                    : "Reports will be sent automatically when you're back online."}
                </Text>
              </View>
            </View>
            {!offlineQueueEnabled && pending.length ? (
              <Banner tone="warning" message="Offline reporting is currently turned off, but reports already saved can still be sent." />
            ) : null}
            {pending.length ? (
              <Text style={[typography.caption, { marginBottom: spacing.md }]}>
                {pending.length} report{pending.length === 1 ? '' : 's'} saved on this device.
              </Text>
            ) : null}
          </>
        }
        ListEmptyComponent={
          <EmptyState
            icon="cloud-done-outline"
            title="Nothing waiting to be sent"
            message="Reports you make while offline are saved here and sent automatically when you reconnect."
          />
        }
      />
      {pending.length ? (
        <View style={styles.footer}>
          <Button
            title={flushing ? 'Sending…' : `Send now (${pending.length})`}
            icon="cloud-upload"
            onPress={sendNow}
            loading={flushing}
            disabled={!isOnline}
            accessibilityHint={isOnline ? 'Sends all saved reports' : 'Unavailable while offline'}
          />
          {!isOnline ? <Text style={[typography.small, styles.footerNote]}>Connect to the internet to send your reports.</Text> : null}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  connectivity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  connectivityTitle: { fontWeight: '700', fontSize: 15 },
  card: { marginBottom: spacing.md, padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  thumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  address: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  deleteButton: { alignSelf: 'flex-end', marginTop: spacing.xs },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  footerNote: { textAlign: 'center', marginTop: spacing.xs },
});

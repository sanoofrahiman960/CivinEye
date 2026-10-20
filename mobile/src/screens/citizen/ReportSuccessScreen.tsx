import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import MapView from '../../components/SafeMapView';

import { Screen } from '../../components/Screen';
import { StatusBadge } from '../../components/StatusBadge';
import { Banner, Button, Card } from '../../components/ui';
import type { CitizenStackScreenProps } from '../../navigation/types';
import { useOfflineStore } from '../../store/offlineStore';
import { colors, radius, spacing, typography } from '../../theme';
import { formatCoordinate } from '../../utils/format';

export function ReportSuccessScreen({ navigation, route }: CitizenStackScreenProps<'ReportSuccess'>) {
  const { complaintId, issueId, status, address, latitude, longitude, queued } = route.params;
  const isOnline = useOfflineStore((s) => s.isOnline);

  const goHome = () => navigation.navigate('CitizenTabs', { screen: 'Home' });

  const footer = queued ? (
    <View style={styles.actions}>
      <Button title="View pending reports" icon="cloud-upload" onPress={() => navigation.replace('PendingReports')} />
      <Button title="Back to home" icon="home" variant="outline" onPress={goHome} />
    </View>
  ) : (
    <View style={styles.actions}>
      {issueId !== null ? (
        <Button title="Track this issue" icon="navigate" onPress={() => navigation.replace('IssueDetail', { issueId })} />
      ) : null}
      <Button title="Back to home" icon="home" variant="outline" onPress={goHome} />
    </View>
  );

  return (
    <Screen footer={footer}>
      <View style={styles.hero}>
        <View style={[styles.heroCircle, queued && { backgroundColor: colors.warningLight }]}>
          <Ionicons
            name={queued ? 'cloud-upload' : 'checkmark-circle'}
            size={64}
            color={queued ? colors.warning : colors.success}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {queued ? 'Report saved on your phone' : 'Report submitted'}
        </Text>
        <Text style={styles.subtitle}>
          {queued
            ? "You're offline right now. We'll send your report automatically as soon as you're back online — you don't need to do anything."
            : 'Thank you for helping improve your community. The responsible department has been notified.'}
        </Text>
      </View>

      {queued ? (
        <Banner
          tone={isOnline ? 'info' : 'warning'}
          icon={isOnline ? 'wifi' : 'cloud-offline'}
          title={isOnline ? 'Back online' : 'Waiting for a connection'}
          message={
            isOnline
              ? 'Your connection is back. Queued reports are being sent; you can also send them now from Pending reports.'
              : 'Keep the app installed. Your complaint ID will appear in My Issues once the report has been sent.'
          }
        />
      ) : (
        <Card style={styles.idCard}>
          <Text style={typography.caption}>Your complaint ID</Text>
          <Text style={styles.complaintId} selectable accessibilityLabel={`Complaint ID ${complaintId ?? 'not available'}`}>
            {complaintId ?? '—'}
          </Text>
          <Text style={typography.small}>Keep this ID to follow up on your complaint. You can long-press to copy it.</Text>
          {status ? (
            <View style={styles.statusRow}>
              <Text style={typography.caption}>Current status</Text>
              <StatusBadge status={status} long />
            </View>
          ) : null}
        </Card>
      )}

      <Card style={styles.locationCard}>
        <View style={styles.locationHeader}>
          <Ionicons name="location" size={18} color={colors.primary} />
          <Text style={typography.subheading}>Reported location</Text>
        </View>
        <Text style={typography.body}>{address || 'No address given'}</Text>
        <Text style={typography.caption}>{formatCoordinate(latitude, longitude)}</Text>
        <View style={styles.mapWrap}>
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={{ latitude, longitude, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            liteMode
            accessibilityLabel={`Map showing the reported location${address ? `, ${address}` : ''}`}
          >
            <Marker coordinate={{ latitude, longitude }} pinColor={colors.primary} title="Reported location" />
          </MapView>
        </View>
      </Card>

      {!queued ? (
        <View style={styles.next}>
          <Text style={typography.subheading}>What happens next?</Text>
          <NextStep icon="eye" text="An official reviews your report and confirms the priority." />
          <NextStep icon="construct" text="The department schedules the work. You'll get a notification at each step." />
          <NextStep icon="shield-checkmark" text="When it's fixed, you'll be asked to confirm — or reopen it if it isn't." />
        </View>
      ) : null}
    </Screen>
  );
}

function NextStep({ icon, text }: { icon: 'eye' | 'construct' | 'shield-checkmark'; text: string }) {
  return (
    <View style={styles.nextRow}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={[typography.caption, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xl },
  heroCircle: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.successLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { ...typography.title, textAlign: 'center' },
  subtitle: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20, paddingHorizontal: spacing.md },
  idCard: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  complaintId: { fontSize: 30, fontWeight: '800', color: colors.primary, letterSpacing: 1, marginVertical: spacing.xs },
  statusRow: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  locationCard: { gap: spacing.xs, marginBottom: spacing.md },
  locationHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  mapWrap: { height: 160, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm, backgroundColor: colors.surfaceMuted },
  next: { gap: spacing.sm, marginTop: spacing.sm },
  nextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  actions: { gap: spacing.sm },
});

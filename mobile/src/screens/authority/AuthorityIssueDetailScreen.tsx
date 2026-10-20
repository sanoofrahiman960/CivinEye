import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Marker } from 'react-native-maps';

import MapView from '../../components/SafeMapView';

import { authorityApi } from '../../api/authorityApi';
import { toApiError, type ApiError } from '../../api/client';
import { PhotoGallery } from '../../components/PhotoGallery';
import { PriorityBadge } from '../../components/PriorityBadge';
import { ReasonModal } from '../../components/ReasonModal';
import { ErrorState, LoadingState } from '../../components/States';
import { OverdueBadge, StatusBadge } from '../../components/StatusBadge';
import { LifecycleProgress, StatusTimeline, type TimelineEntry } from '../../components/StatusTimeline';
import { Screen } from '../../components/Screen';
import { Banner, Button, Card, ChipGroup, KeyValue, SectionHeader, TextField, type ChipOption } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import type { AuthorityStackScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { useReferenceStore } from '../../store/referenceStore';
import { colors, PRIORITY_ORDER, PRIORITY_STYLES, radius, spacing, TOUCH_TARGET, typography, type IconName } from '../../theme';
import type {
  AuthorityAction,
  AuthorityIssueDetail,
  AuthorityIssueImage,
  CaptureSource,
  CommentVisibility,
  DepartmentMini,
  Priority,
  ProofCheckStatus,
  Role,
  User,
} from '../../types/api';
import { formatCoordinate, formatDateTime, formatDistance, formatDue, formatRelative } from '../../utils/format';

// --- Labels ----------------------------------------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  CITIZEN: 'Citizen',
  OFFICER: 'Officer',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrator',
};

export const PROOF_STATUS: Record<ProofCheckStatus, { label: string; icon: IconName; color: string; background: string }> = {
  PASSED: { label: 'Location check passed', icon: 'checkmark-circle', color: colors.success, background: colors.successLight },
  FLAGGED: { label: 'Flagged for review', icon: 'warning', color: colors.warning, background: colors.warningLight },
  OVERRIDDEN: { label: 'Accepted by supervisor', icon: 'shield-checkmark', color: colors.info, background: colors.infoLight },
  NOT_APPLICABLE: { label: 'Not checked', icon: 'remove-circle-outline', color: colors.textMuted, background: colors.surfaceMuted },
};

export const CAPTURE_SOURCE_LABELS: Record<CaptureSource, string> = {
  CAMERA: 'In-app camera',
  GALLERY: 'Photo gallery',
  UNKNOWN: 'Unknown',
};

const ACTION_META: Record<AuthorityAction, { label: string; icon: IconName }> = {
  acknowledge: { label: 'Acknowledge', icon: 'eye-outline' },
  start_work: { label: 'Start work', icon: 'construct-outline' },
  resolve: { label: 'Resolve', icon: 'checkmark-circle-outline' },
  reopen: { label: 'Reopen', icon: 'refresh' },
  change_priority: { label: 'Priority', icon: 'flag-outline' },
  assign: { label: 'Assign', icon: 'people-outline' },
  comment: { label: 'Comment', icon: 'chatbubble-ellipses-outline' },
  close: { label: 'Close', icon: 'lock-closed-outline' },
};

const WORKFLOW_ACTIONS: AuthorityAction[] = ['acknowledge', 'start_work', 'resolve', 'reopen'];
const SECONDARY_ACTIONS: AuthorityAction[] = ['change_priority', 'assign', 'comment', 'close'];

/** Errors meaning the screen shows an outdated state: reload after telling the user. */
const STALE_STATE_CODES = ['invalid_transition', 'issue_closed', 'not_flagged'];

type ActiveModal =
  | { kind: 'acknowledge' }
  | { kind: 'start_work' }
  | { kind: 'reopen' }
  | { kind: 'close' }
  | { kind: 'priority' }
  | { kind: 'assign' }
  | { kind: 'comment' }
  | { kind: 'override'; image: AuthorityIssueImage };

function byDate<T>(key: (item: T) => string, direction: 'asc' | 'desc') {
  return (a: T, b: T) => {
    const diff = new Date(key(a)).getTime() - new Date(key(b)).getTime();
    return direction === 'asc' ? diff : -diff;
  };
}

async function openUrl(url: string, failure: string) {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert('Unable to open', failure);
  }
}

// --- Screen ----------------------------------------------------------------------------------

export function AuthorityIssueDetailScreen({ route, navigation }: AuthorityStackScreenProps<'AuthorityIssueDetail'>) {
  const { issueId } = route.params;
  const user = useAuthStore((s) => s.user);
  const loadReference = useReferenceStore((s) => s.load);
  const { data: issue, error, loading, refreshing, refresh, reload, setData } = useApi(() => authorityApi.detail(issueId), [issueId], {
    refetchOnFocus: true,
  });
  const { busy, run } = useAction();
  const [modal, setModal] = useState<ActiveModal | null>(null);

  useEffect(() => {
    loadReference().catch(() => undefined);
  }, [loadReference]);

  const complaintId = issue?.complaint_id;
  useLayoutEffect(() => {
    if (complaintId) navigation.setOptions({ title: complaintId });
  }, [navigation, complaintId]);

  if (loading && !issue) return <LoadingState message="Loading issue…" />;
  if (!issue) return <ErrorState error={error} onRetry={reload} />;

  const canOverride = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const actions = issue.available_actions;

  function handleError(title: string, err: ApiError) {
    if (err.status === 404) {
      Alert.alert(title, 'This issue is no longer available to you.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
      return;
    }
    if (err.code === 'no_change') {
      Alert.alert('No change', err.message);
      return;
    }
    Alert.alert(title, err.message);
    if (STALE_STATE_CODES.includes(err.code)) {
      setModal(null);
      refresh();
    }
  }

  /** Run a mutation that returns the updated issue, replacing the screen data with it. */
  function perform(title: string, action: () => Promise<AuthorityIssueDetail>, onDone?: (updated: AuthorityIssueDetail) => void) {
    return run(async () => {
      try {
        const updated = await action();
        setData(updated);
        setModal(null);
        onDone?.(updated);
      } catch (e) {
        handleError(title, toApiError(e));
      }
    });
  }

  function onAction(action: AuthorityAction) {
    switch (action) {
      case 'resolve':
        navigation.navigate('ResolveIssue', { issueId });
        return;
      case 'change_priority':
        setModal({ kind: 'priority' });
        return;
      default:
        setModal({ kind: action });
    }
  }

  function afterAssign(updated: AuthorityIssueDetail) {
    if (!user || user.role === 'ADMIN') return;
    if (updated.department && updated.department.id !== user.department?.id) {
      Alert.alert(
        `Transferred to ${updated.department.name}`,
        `${updated.complaint_id} is now handled by ${updated.department.name} and will no longer appear in your list.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    }
  }

  const workflow = WORKFLOW_ACTIONS.filter((a) => actions.includes(a));
  const secondary = SECONDARY_ACTIONS.filter((a) => actions.includes(a));

  const footer =
    workflow.length || secondary.length ? (
      <View style={styles.actionBar}>
        {workflow.length ? (
          <View style={styles.workflowRow}>
            {workflow.map((action, index) => (
              <Button
                key={action}
                title={ACTION_META[action].label}
                icon={ACTION_META[action].icon}
                color={colors.authority}
                variant={index === 0 ? 'primary' : 'outline'}
                onPress={() => onAction(action)}
                disabled={busy}
                style={{ flex: 1 }}
              />
            ))}
          </View>
        ) : null}
        {secondary.length ? (
          <View style={styles.secondaryRow}>
            {secondary.map((action) => {
              const destructive = action === 'close';
              const tint = destructive ? colors.danger : colors.authority;
              return (
                <Pressable
                  key={action}
                  onPress={() => onAction(action)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={destructive ? 'Close issue' : ACTION_META[action].label === 'Priority' ? 'Change priority' : ACTION_META[action].label}
                  accessibilityState={{ disabled: busy }}
                  style={({ pressed }) => [styles.secondaryAction, (pressed || busy) && { opacity: 0.6 }]}
                >
                  <Ionicons name={ACTION_META[action].icon} size={20} color={tint} />
                  <Text style={[styles.secondaryLabel, { color: tint }]}>{ACTION_META[action].label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>
    ) : undefined;

  const resolutionImages = issue.images.filter((image) => image.image_type === 'RESOLUTION').sort(byDate((i) => i.uploaded_at, 'desc'));
  const timeline: TimelineEntry[] = [...issue.history].sort(byDate((h) => h.created_at, 'asc')).map((entry) => ({
    id: entry.id,
    new_status: entry.new_status,
    created_at: entry.created_at,
    reason: entry.reason,
    closure_type: entry.closure_type,
    actor_label: entry.changed_by ? `${entry.changed_by.full_name} (${ROLE_LABELS[entry.changed_by.role]})` : entry.actor_label,
  }));
  const priorityChanges = [...issue.priority_changes].sort(byDate((p) => p.created_at, 'desc'));
  const assignments = [...issue.assignments].sort(byDate((a) => a.assigned_at, 'desc'));
  const comments = [...issue.comments].sort(byDate((c) => c.created_at, 'asc'));
  const resolvedOrClosed = issue.status === 'RESOLVED' || issue.status === 'CLOSED';
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${issue.latitude},${issue.longitude}`;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} footer={footer}>
      {error ? <Banner tone="warning" title="Couldn't refresh" message={error.message} action={{ label: 'Try again', onPress: refresh }} /> : null}

      {/* Summary ------------------------------------------------------------------------------ */}
      <Card>
        <Text style={styles.complaintId} accessibilityLabel={`Complaint ${issue.complaint_id}`}>
          {issue.complaint_id}
        </Text>
        <Text style={typography.title} accessibilityRole="header">
          {issue.title}
        </Text>
        <View style={styles.badges}>
          <StatusBadge status={issue.status} long />
          <PriorityBadge priority={issue.priority} />
          {issue.is_overdue ? <OverdueBadge /> : null}
        </View>
        {issue.recommended_priority !== issue.priority ? (
          <InfoLine icon={PRIORITY_STYLES[issue.recommended_priority].icon} text={`Rules recommend: ${PRIORITY_STYLES[issue.recommended_priority].label}`} />
        ) : null}
        {issue.reported_urgency ? <InfoLine icon="person-outline" text={`Citizen felt: ${PRIORITY_STYLES[issue.reported_urgency].label}`} /> : null}
        {issue.impact_count > 0 ? (
          <InfoLine icon="people-outline" text={`${issue.impact_count} other citizen${issue.impact_count === 1 ? '' : 's'} affected`} />
        ) : null}
        {issue.reopen_count > 0 ? <InfoLine icon="refresh-circle-outline" text={`Reopened ${issue.reopen_count} time${issue.reopen_count === 1 ? '' : 's'}`} /> : null}
        <View style={{ marginTop: spacing.md }}>
          <LifecycleProgress status={issue.status} />
        </View>
      </Card>

      {issue.is_recurrence ? (
        <View style={styles.spaced}>
          <Banner
            tone="warning"
            icon="repeat"
            title="Recurring problem"
            message={
              issue.parent_complaint_id
                ? `This problem came back after ${issue.parent_complaint_id} was fixed.`
                : 'This problem came back after an earlier complaint was fixed.'
            }
          />
        </View>
      ) : null}
      {issue.client_reported_at ? (
        <Banner
          tone="info"
          icon="cloud-offline-outline"
          message={`Captured offline at ${formatDateTime(issue.client_reported_at)} and sent once the reporter was back online.`}
        />
      ) : null}

      {/* Photos ------------------------------------------------------------------------------ */}
      <SectionHeader title="Photos" />
      <Card>
        <PhotoGallery images={issue.images} />
      </Card>

      {resolutionImages.length ? (
        <>
          <SectionHeader title="Resolution photo checks" />
          {resolutionImages.map((image) => (
            <ProofCheckCard
              key={image.id}
              image={image}
              currentCycle={image.resolution_cycle === issue.resolution_cycle}
              onOverride={canOverride && image.proof_check_status === 'FLAGGED' ? () => setModal({ kind: 'override', image }) : undefined}
            />
          ))}
        </>
      ) : null}

      {/* Details ------------------------------------------------------------------------------ */}
      <SectionHeader title="Details" />
      <Card>
        <KeyValue label="Category" icon="pricetag-outline" value={issue.category.name} />
        {issue.subcategory ? <KeyValue label="Subcategory" icon="pricetags-outline" value={issue.subcategory.name} /> : null}
        <KeyValue label="Department" icon="business-outline" value={issue.department?.name ?? 'Not assigned'} />
        <KeyValue label="Officer" icon="person-outline" value={issue.assigned_officer?.full_name ?? 'No officer assigned'} />
        {issue.service_area_name ? <KeyValue label="Service area" icon="map-outline" value={issue.service_area_name} /> : null}
        <Text style={[typography.subheading, styles.blockTitle]}>Description</Text>
        <Text style={typography.body}>{issue.description || 'No description provided.'}</Text>
        {issue.additional_details ? (
          <>
            <Text style={[typography.subheading, styles.blockTitle]}>Additional details</Text>
            <Text style={typography.body}>{issue.additional_details}</Text>
          </>
        ) : null}
        {issue.resolution_description ? (
          <>
            <Text style={[typography.subheading, styles.blockTitle]}>Resolution notes</Text>
            <Text style={typography.body}>{issue.resolution_description}</Text>
          </>
        ) : null}
      </Card>

      {/* Location ------------------------------------------------------------------------------ */}
      <SectionHeader title="Location" />
      <Card>
        <KeyValue label="Address" icon="location-outline" value={issue.address || 'No address recorded'} />
        <KeyValue label="Coordinates" icon="navigate-circle-outline" value={formatCoordinate(issue.latitude, issue.longitude)} />
        <KeyValue
          label="GPS accuracy"
          icon="locate-outline"
          value={issue.location_accuracy_m !== null ? `±${Math.round(issue.location_accuracy_m)} m` : 'Not recorded'}
        />
        <View style={styles.mapWrap} accessible accessibilityRole="image" accessibilityLabel={`Map showing the issue location at ${issue.address || formatCoordinate(issue.latitude, issue.longitude)}`}>
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={{ latitude: issue.latitude, longitude: issue.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            liteMode={Platform.OS === 'android'}
          >
            <Marker coordinate={{ latitude: issue.latitude, longitude: issue.longitude }} title={issue.complaint_id} />
          </MapView>
        </View>
        <Button
          title="Navigate"
          icon="navigate"
          variant="outline"
          color={colors.authority}
          onPress={() => openUrl(mapsUrl, 'No maps app is available to open directions.')}
          accessibilityHint="Opens turn-by-turn directions to the issue location"
          style={{ marginTop: spacing.md }}
        />
      </Card>

      {/* SLA ------------------------------------------------------------------------------ */}
      <SectionHeader title="Service level" />
      <Card>
        <KeyValue
          label="Acknowledgement"
          icon="eye-outline"
          value={issue.acknowledged_at ? `Acknowledged ${formatDateTime(issue.acknowledged_at)}` : formatDue(issue.ack_due_at)}
        />
        <KeyValue
          label="Resolution"
          icon="hourglass-outline"
          value={resolvedOrClosed && issue.resolved_at ? `Resolved ${formatDateTime(issue.resolved_at)}` : formatDue(issue.due_at)}
        />
        <KeyValue label="Open for" icon="calendar-outline" value={`${issue.days_open} day${issue.days_open === 1 ? '' : 's'}`} />
        {issue.is_overdue ? (
          <View style={styles.spacedSmall}>
            <OverdueBadge />
          </View>
        ) : null}
        <View style={styles.divider} />
        <KeyValue label="Reported" value={formatDateTime(issue.created_at)} />
        {issue.started_at ? <KeyValue label="Work started" value={formatDateTime(issue.started_at)} /> : null}
        {issue.resolved_at ? <KeyValue label="Resolved" value={formatDateTime(issue.resolved_at)} /> : null}
        {issue.reopened_at ? <KeyValue label="Last reopened" value={formatDateTime(issue.reopened_at)} /> : null}
        {issue.closed_at ? <KeyValue label="Closed" value={formatDateTime(issue.closed_at)} /> : null}
      </Card>

      {/* Reporter ------------------------------------------------------------------------------ */}
      <SectionHeader title="Reporter" />
      <Card>
        <View style={styles.restricted}>
          <Ionicons name="lock-closed" size={14} color={colors.authority} />
          <Text style={styles.restrictedText}>Personal details — authority staff only</Text>
        </View>
        <KeyValue label="Name" icon="person-outline" value={issue.reporter.full_name} />
        <KeyValue
          label="Phone"
          icon="call-outline"
          value={
            issue.reporter.phone_number ? (
              <LinkText
                text={issue.reporter.phone_number}
                label={`Call ${issue.reporter.full_name} at ${issue.reporter.phone_number}`}
                onPress={() => openUrl(`tel:${issue.reporter.phone_number.replace(/\s+/g, '')}`, 'Calling is not available on this device.')}
              />
            ) : (
              'Not provided'
            )
          }
        />
        <KeyValue
          label="Email"
          icon="mail-outline"
          value={
            issue.reporter.email ? (
              <LinkText
                text={issue.reporter.email}
                label={`Email ${issue.reporter.full_name} at ${issue.reporter.email}`}
                onPress={() => openUrl(`mailto:${issue.reporter.email}`, 'No email app is available on this device.')}
              />
            ) : (
              'Not provided'
            )
          }
        />
      </Card>

      {issue.satisfaction_rating !== null ? (
        <>
          <SectionHeader title="Citizen feedback" />
          <Card>
            <View style={styles.stars} accessible accessibilityLabel={`Satisfaction rating ${issue.satisfaction_rating} out of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Ionicons key={n} name={n <= (issue.satisfaction_rating ?? 0) ? 'star' : 'star-outline'} size={22} color={colors.warning} />
              ))}
              <Text style={[typography.subheading, { marginLeft: spacing.sm }]}>{issue.satisfaction_rating} / 5</Text>
            </View>
            {issue.satisfaction_comment ? <Text style={[typography.body, { marginTop: spacing.sm }]}>“{issue.satisfaction_comment}”</Text> : null}
          </Card>
        </>
      ) : null}

      {/* History ------------------------------------------------------------------------------ */}
      <SectionHeader title="Status history" />
      <Card>{timeline.length ? <StatusTimeline entries={timeline} /> : <Text style={typography.caption}>No status changes yet.</Text>}</Card>

      <SectionHeader title="Priority changes" />
      <Card>
        {priorityChanges.length ? (
          priorityChanges.map((change, index) => (
            <View key={change.id} style={[styles.listItem, index > 0 && styles.listItemBorder]}>
              <View style={styles.priorityChange}>
                <PriorityBadge priority={change.previous_priority} size="sm" />
                <Ionicons name="arrow-forward" size={14} color={colors.textMuted} accessibilityLabel="changed to" />
                <PriorityBadge priority={change.new_priority} size="sm" />
              </View>
              {change.reason ? <Text style={[typography.body, styles.itemText]}>{change.reason}</Text> : null}
              <Text style={typography.small}>
                {change.changed_by_name || 'System'} · {formatDateTime(change.created_at)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={typography.caption}>The priority has not been changed.</Text>
        )}
      </Card>

      <SectionHeader title="Assignment history" />
      <Card>
        {assignments.length ? (
          assignments.map((assignment, index) => (
            <View key={assignment.id} style={[styles.listItem, index > 0 && styles.listItemBorder]}>
              <View style={styles.assignmentHeader}>
                <Text style={[typography.subheading, { flex: 1 }]}>{assignment.department.name}</Text>
                {assignment.is_current ? (
                  <View style={styles.currentTag} accessible accessibilityLabel="Current assignment">
                    <Ionicons name="checkmark-circle" size={12} color={colors.authority} />
                    <Text style={styles.currentTagText}>Current</Text>
                  </View>
                ) : null}
              </View>
              <Text style={typography.caption}>{assignment.assigned_officer ? `Officer: ${assignment.assigned_officer.full_name}` : 'No specific officer'}</Text>
              {assignment.notes ? <Text style={[typography.body, styles.itemText]}>{assignment.notes}</Text> : null}
              <Text style={typography.small}>
                By {assignment.assigned_by_name || 'System'} · {formatDateTime(assignment.assigned_at)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={typography.caption}>No assignments recorded.</Text>
        )}
      </Card>

      <SectionHeader title="Comments" action={actions.includes('comment') ? { label: 'Add', onPress: () => setModal({ kind: 'comment' }) } : undefined} />
      <Card>
        {comments.length ? (
          comments.map((comment, index) => {
            const internal = comment.visibility === 'INTERNAL';
            return (
              <View key={comment.id} style={[styles.listItem, index > 0 && styles.listItemBorder]}>
                <View style={styles.commentHeader}>
                  <Text style={[typography.subheading, { flexShrink: 1 }]} numberOfLines={1}>
                    {comment.is_mine ? 'You' : comment.author_name}
                  </Text>
                  <Text style={typography.small}>{ROLE_LABELS[comment.author_role]}</Text>
                </View>
                <View
                  style={[styles.visibilityTag, internal ? styles.internalTag : styles.publicTag]}
                  accessible
                  accessibilityLabel={internal ? 'Internal comment, not visible to the citizen' : 'Visible to citizen'}
                >
                  <Ionicons name={internal ? 'lock-closed' : 'eye-outline'} size={12} color={internal ? colors.warning : colors.success} />
                  <Text style={[styles.visibilityText, { color: internal ? colors.warning : colors.success }]}>
                    {internal ? 'Internal' : 'Visible to citizen'}
                  </Text>
                </View>
                <Text style={[typography.body, styles.itemText]}>{comment.comment}</Text>
                <Text style={typography.small}>{formatRelative(comment.created_at)}</Text>
              </View>
            );
          })
        ) : (
          <Text style={typography.caption}>No comments yet.</Text>
        )}
      </Card>

      {/* Modals ------------------------------------------------------------------------------ */}
      <ReasonModal
        visible={modal?.kind === 'acknowledge'}
        title="Acknowledge issue"
        message="Confirms that your department has reviewed this complaint. The citizen will be notified."
        label="Message"
        placeholder="e.g. Inspection team scheduled for tomorrow"
        confirmLabel="Acknowledge"
        required={false}
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(text) => perform("Couldn't acknowledge", () => authorityApi.acknowledge(issueId, text))}
      />
      <ReasonModal
        visible={modal?.kind === 'start_work'}
        title="Start work"
        message="Marks the issue as In Progress and notifies the citizen that work has started."
        label="Message"
        placeholder="e.g. Crew dispatched to the site"
        confirmLabel="Start work"
        required={false}
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(text) => perform("Couldn't start work", () => authorityApi.startWork(issueId, text))}
      />
      <ReasonModal
        visible={modal?.kind === 'reopen'}
        title="Reopen issue"
        message="The issue goes back to the department for further work. Explain what still needs to be done."
        placeholder="What follow-up work is needed?"
        confirmLabel="Reopen"
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(text) => perform("Couldn't reopen", () => authorityApi.reopen(issueId, text))}
      />
      <ReasonModal
        visible={modal?.kind === 'close'}
        title="Close issue?"
        message="This closes the issue without citizen verification and records it as closed by an administrator. This cannot be undone except by reopening."
        placeholder="Why is this issue being closed?"
        confirmLabel="Close issue"
        destructive
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(text) => perform("Couldn't close", () => authorityApi.close(issueId, text))}
      />
      <ReasonModal
        visible={modal?.kind === 'override'}
        title="Accept flagged photo?"
        message={
          modal?.kind === 'override'
            ? `Proof-Lock flagged this photo${modal.image.proof_check_notes ? `: ${modal.image.proof_check_notes}` : '.'} Only accept it if you are satisfied the work was done at this location. Your name and reason are recorded.`
            : undefined
        }
        placeholder="Why is this photo acceptable?"
        confirmLabel="Accept photo"
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(reason) => {
          if (modal?.kind !== 'override') return;
          const imageId = modal.image.id;
          run(async () => {
            try {
              await authorityApi.overrideProofCheck(imageId, reason);
              setModal(null);
              await refresh();
              Alert.alert(
                'Photo accepted',
                issue.status === 'IN_PROGRESS'
                  ? 'The resolution can now be submitted again from the Resolve screen without taking a new photo.'
                  : 'The photo has been marked as reviewed.',
              );
            } catch (e) {
              handleError("Couldn't override", toApiError(e));
            }
          });
        }}
      />
      <PriorityModal
        visible={modal?.kind === 'priority'}
        current={issue.priority}
        recommended={issue.recommended_priority}
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(priority, reason) => perform("Couldn't change priority", () => authorityApi.changePriority(issueId, priority, reason))}
      />
      <AssignModal
        visible={modal?.kind === 'assign'}
        issue={issue}
        user={user}
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(departmentId, officerId, notes) =>
          perform("Couldn't assign", () => authorityApi.assign(issueId, departmentId, officerId, notes), afterAssign)
        }
      />
      <CommentModal
        visible={modal?.kind === 'comment'}
        busy={busy}
        onCancel={() => setModal(null)}
        onConfirm={(text, visibility) =>
          run(async () => {
            try {
              const comment = await authorityApi.comment(issueId, text, visibility);
              setData({ ...issue, comments: [...issue.comments, comment] });
              setModal(null);
              await refresh();
            } catch (e) {
              handleError("Couldn't add comment", toApiError(e));
            }
          })
        }
      />
    </Screen>
  );
}

// --- Pieces ----------------------------------------------------------------------------------

function InfoLine({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.infoLine}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={typography.caption}>{text}</Text>
    </View>
  );
}

function LinkText({ text, label, onPress }: { text: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" accessibilityLabel={label} hitSlop={12} style={styles.link}>
      <Text style={styles.linkText}>{text}</Text>
    </Pressable>
  );
}

function ProofCheckCard({ image, currentCycle, onOverride }: { image: AuthorityIssueImage; currentCycle: boolean; onOverride?: () => void }) {
  const status = PROOF_STATUS[image.proof_check_status];
  return (
    <Card style={styles.proofCard}>
      <View style={styles.proofHeader}>
        <Image source={{ uri: image.thumbnail_url }} style={styles.proofThumb} contentFit="cover" accessibilityLabel="Resolution photo" />
        <View style={{ flex: 1, gap: spacing.xs }}>
          <View style={[styles.proofStatus, { backgroundColor: status.background }]} accessible accessibilityLabel={`Proof check: ${status.label}`}>
            <Ionicons name={status.icon} size={14} color={status.color} />
            <Text style={[styles.proofStatusText, { color: status.color }]}>{status.label}</Text>
          </View>
          <Text style={typography.small}>
            Resolution attempt {image.resolution_cycle}
            {currentCycle ? ' (current)' : ''}
          </Text>
          <Text style={typography.small}>
            {image.uploaded_by_name || 'Unknown'} · {formatDateTime(image.uploaded_at)}
          </Text>
        </View>
      </View>
      <KeyValue label="Distance from report" value={image.distance_from_issue_m !== null ? formatDistance(image.distance_from_issue_m) : 'Unknown (no GPS)'} />
      <KeyValue label="Captured with" value={CAPTURE_SOURCE_LABELS[image.capture_source]} />
      <KeyValue label="GPS accuracy" value={image.capture_accuracy_m !== null ? `±${Math.round(image.capture_accuracy_m)} m` : 'Not recorded'} />
      {image.captured_at ? <KeyValue label="Captured at" value={formatDateTime(image.captured_at)} /> : null}
      {image.proof_check_notes ? (
        <View style={[styles.notes, { backgroundColor: status.background }]}>
          <Text style={typography.caption}>{image.proof_check_notes}</Text>
        </View>
      ) : null}
      {image.proof_check_status === 'OVERRIDDEN' ? (
        <View style={styles.notes}>
          <Text style={typography.subheading}>Supervisor override</Text>
          {image.override_reason ? <Text style={[typography.body, { marginTop: 2 }]}>{image.override_reason}</Text> : null}
          <Text style={typography.small}>
            {image.overridden_by_name ?? 'Supervisor'}
            {image.overridden_at ? ` · ${formatDateTime(image.overridden_at)}` : ''}
          </Text>
        </View>
      ) : null}
      {onOverride ? (
        <Button
          title="Review & override"
          icon="shield-checkmark-outline"
          variant="outline"
          color={colors.authority}
          compact
          onPress={onOverride}
          accessibilityHint="Accept this flagged resolution photo with a recorded reason"
          style={{ marginTop: spacing.md }}
        />
      ) : null}
    </Card>
  );
}

/** Bottom-sheet style dialog shared by the priority, assignment and comment forms. */
function FormModal({
  visible,
  title,
  message,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
  children,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={typography.heading} accessibilityRole="header">
              {title}
            </Text>
            {message ? <Text style={[typography.caption, styles.sheetMessage]}>{message}</Text> : null}
            {children}
            <View style={styles.sheetActions}>
              <Button title="Cancel" variant="outline" color={colors.authority} onPress={onCancel} disabled={busy} style={{ flex: 1 }} />
              <Button title={confirmLabel} color={colors.authority} onPress={onConfirm} loading={busy} style={{ flex: 1 }} />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PriorityModal({
  visible,
  current,
  recommended,
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  current: Priority;
  recommended: Priority;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (priority: Priority, reason: string) => void;
}) {
  const [priority, setPriority] = useState<Priority>(current);
  const [reason, setReason] = useState('');
  const [priorityError, setPriorityError] = useState<string | undefined>();
  const [reasonError, setReasonError] = useState<string | undefined>();

  useEffect(() => {
    if (visible) {
      setPriority(recommended !== current ? recommended : current);
      setReason('');
      setPriorityError(undefined);
      setReasonError(undefined);
    }
  }, [visible, current, recommended]);

  const options: ChipOption<Priority>[] = PRIORITY_ORDER.map((value) => ({
    value,
    label: `${PRIORITY_STYLES[value].label}${value === current ? ' (current)' : value === recommended ? ' (recommended)' : ''}`,
    icon: PRIORITY_STYLES[value].icon,
    color: PRIORITY_STYLES[value].color,
  }));

  function submit() {
    let valid = true;
    if (priority === current) {
      setPriorityError('Choose a different priority from the current one.');
      valid = false;
    }
    if (reason.trim().length < 3) {
      setReasonError('Please give a short reason (at least 3 characters).');
      valid = false;
    }
    if (valid) onConfirm(priority, reason.trim());
  }

  return (
    <FormModal
      visible={visible}
      title="Change priority"
      message={`Current priority: ${PRIORITY_STYLES[current].label}. Rules recommend: ${PRIORITY_STYLES[recommended].label}. The change and your reason are recorded.`}
      confirmLabel="Change priority"
      busy={busy}
      onCancel={onCancel}
      onConfirm={submit}
    >
      <Text style={[typography.subheading, styles.fieldTitle]}>New priority</Text>
      <ChipGroup
        options={options}
        selected={[priority]}
        onToggle={(value) => {
          setPriority(value);
          setPriorityError(undefined);
        }}
      />
      {priorityError ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {priorityError}
        </Text>
      ) : null}
      <View style={{ height: spacing.lg }} />
      <TextField
        label="Reason"
        value={reason}
        onChangeText={(value) => {
          setReason(value);
          setReasonError(undefined);
        }}
        placeholder="Why is the priority changing?"
        multiline
        maxLength={2000}
        error={reasonError}
      />
    </FormModal>
  );
}

const NO_OFFICER = 0;

function AssignModal({
  visible,
  issue,
  user,
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  issue: AuthorityIssueDetail;
  user: User | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (departmentId: number, officerId: number | null, notes: string) => void;
}) {
  const allDepartments = useReferenceStore((s) => s.departments);
  const canTransfer = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

  // Officers may only reassign within their own department; the backend rejects transfers (403).
  let departmentOptions: DepartmentMini[] = canTransfer
    ? allDepartments.map((d) => ({ id: d.id, name: d.name }))
    : allDepartments.filter((d) => d.id === user?.department?.id).map((d) => ({ id: d.id, name: d.name }));
  if (!departmentOptions.length) {
    const fallback = canTransfer ? issue.department : user?.department ?? issue.department;
    departmentOptions = fallback ? [fallback] : [];
  }

  const defaultDepartment = canTransfer ? issue.department?.id ?? user?.department?.id ?? null : user?.department?.id ?? issue.department?.id ?? null;

  const [departmentId, setDepartmentId] = useState<number | null>(defaultDepartment);
  const [officerId, setOfficerId] = useState<number>(NO_OFFICER);
  const [notes, setNotes] = useState('');
  const [officers, setOfficers] = useState<User[]>([]);
  const [officersLoading, setOfficersLoading] = useState(false);
  const [officersError, setOfficersError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState<string | undefined>();

  useEffect(() => {
    if (!visible) return;
    setDepartmentId(defaultDepartment);
    setOfficerId(issue.department?.id === defaultDepartment ? issue.assigned_officer?.id ?? NO_OFFICER : NO_OFFICER);
    setNotes('');
    setFormError(undefined);
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || departmentId === null) {
      setOfficers([]);
      return;
    }
    let cancelled = false;
    setOfficersLoading(true);
    setOfficersError(null);
    authorityApi
      // Only officers whose service areas cover this issue's location can be assigned.
      .officers(departmentId, issue.id)
      .then((list) => {
        if (!cancelled) setOfficers(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setOfficers([]);
          setOfficersError(toApiError(e));
        }
      })
      .finally(() => {
        if (!cancelled) setOfficersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, departmentId, attempt]);

  function chooseDepartment(id: number) {
    if (id === departmentId) return;
    setDepartmentId(id);
    setOfficerId(id === issue.department?.id ? issue.assigned_officer?.id ?? NO_OFFICER : NO_OFFICER);
    setFormError(undefined);
  }

  function submit() {
    if (departmentId === null) {
      setFormError('Choose a department.');
      return;
    }
    onConfirm(departmentId, officerId === NO_OFFICER ? null : officerId, notes.trim());
  }

  const transferring = departmentId !== null && departmentId !== issue.department?.id;
  const officerRows: { id: number; name: string; detail?: string }[] = [
    { id: NO_OFFICER, name: 'No specific officer', detail: 'The whole department sees the issue' },
    ...officers.map((officer) => ({
      id: officer.id,
      name: officer.id === user?.id ? `${officer.full_name} (you)` : officer.full_name,
      detail: ROLE_LABELS[officer.role],
    })),
  ];

  return (
    <FormModal
      visible={visible}
      title="Assign issue"
      message={
        canTransfer
          ? 'Choose the responsible department and, optionally, an officer.'
          : 'Assign an officer in your department. Only supervisors can move an issue to another department.'
      }
      confirmLabel={transferring ? 'Transfer' : 'Assign'}
      busy={busy}
      onCancel={onCancel}
      onConfirm={submit}
    >
      <Text style={[typography.subheading, styles.fieldTitle]}>Department</Text>
      <ChipGroup
        options={departmentOptions.map((d) => ({ value: d.id, label: d.id === issue.department?.id ? `${d.name} (current)` : d.name }))}
        selected={departmentId !== null ? [departmentId] : []}
        onToggle={chooseDepartment}
      />
      {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
      {transferring ? (
        <View style={{ marginTop: spacing.md }}>
          <Banner tone="warning" message="This transfers the issue to another department. You may lose access to it afterwards." />
        </View>
      ) : null}

      <Text style={[typography.subheading, styles.fieldTitle, { marginTop: spacing.lg }]}>Officer</Text>
      {officersLoading ? (
        <View style={styles.officersLoading} accessibilityLabel="Loading officers">
          <ActivityIndicator color={colors.authority} />
          <Text style={typography.caption}>Loading officers…</Text>
        </View>
      ) : officersError ? (
        <Banner tone="danger" message={officersError.message} action={{ label: 'Try again', onPress: () => setAttempt((n) => n + 1) }} />
      ) : (
        <View style={styles.officerList}>
          {officerRows.map((row) => {
            const selected = row.id === officerId;
            return (
              <Pressable
                key={row.id}
                onPress={() => setOfficerId(row.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={row.detail ? `${row.name}, ${row.detail}` : row.name}
                style={({ pressed }) => [styles.officerRow, selected && styles.officerRowSelected, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.authority : colors.borderStrong} />
                <View style={{ flex: 1 }}>
                  <Text style={typography.body}>{row.name}</Text>
                  {row.detail ? <Text style={typography.small}>{row.detail}</Text> : null}
                </View>
              </Pressable>
            );
          })}
          {!officers.length ? <Text style={[typography.small, { marginTop: spacing.xs }]}>No active officers in this department.</Text> : null}
        </View>
      )}

      <View style={{ height: spacing.lg }} />
      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} placeholder="Instructions for the assignee" multiline maxLength={2000} />
    </FormModal>
  );
}

function CommentModal({
  visible,
  busy,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string, visibility: CommentVisibility) => void;
}) {
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>('CITIZEN_VISIBLE');
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (visible) {
      setText('');
      setVisibility('CITIZEN_VISIBLE');
      setError(undefined);
    }
  }, [visible]);

  const options: ChipOption<CommentVisibility>[] = [
    { value: 'CITIZEN_VISIBLE', label: 'Visible to citizen', icon: 'eye-outline', color: colors.success },
    { value: 'INTERNAL', label: 'Internal only', icon: 'lock-closed', color: colors.warning },
  ];

  function submit() {
    if (!text.trim()) {
      setError('Write a comment first.');
      return;
    }
    onConfirm(text.trim(), visibility);
  }

  return (
    <FormModal visible={visible} title="Add comment" confirmLabel="Post comment" busy={busy} onCancel={onCancel} onConfirm={submit}>
      <View style={{ height: spacing.md }} />
      <TextField
        label="Comment"
        value={text}
        onChangeText={(value) => {
          setText(value);
          setError(undefined);
        }}
        placeholder="Write an update or a note"
        multiline
        maxLength={2000}
        error={error}
      />
      <Text style={[typography.subheading, styles.fieldTitle]}>Who can see this?</Text>
      <ChipGroup options={options} selected={[visibility]} onToggle={setVisibility} />
      <Text style={[typography.small, { marginTop: spacing.sm }]}>
        {visibility === 'INTERNAL'
          ? 'Only authority staff will see this comment.'
          : 'The citizen who reported the issue will see this comment and be notified.'}
      </Text>
    </FormModal>
  );
}

const styles = StyleSheet.create({
  complaintId: { fontSize: 13, fontWeight: '700', color: colors.authority, letterSpacing: 0.3, marginBottom: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.sm },
  infoLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  spaced: { marginTop: spacing.md },
  spacedSmall: { marginTop: spacing.xs },
  blockTitle: { marginTop: spacing.md, marginBottom: spacing.xs },
  mapWrap: { height: 170, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.md, backgroundColor: colors.surfaceMuted },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  restricted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.authorityLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  restrictedText: { fontSize: 12, fontWeight: '700', color: colors.authority },
  link: { minHeight: 24, justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '600', color: colors.authority, textDecorationLine: 'underline' },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  listItem: { paddingVertical: spacing.md, gap: spacing.xs },
  listItemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  itemText: { fontSize: 14 },
  priorityChange: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  assignmentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  currentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.authorityLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  currentTagText: { fontSize: 11, fontWeight: '700', color: colors.authority },
  commentHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  visibilityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  internalTag: { backgroundColor: colors.warningLight },
  publicTag: { backgroundColor: colors.successLight },
  visibilityText: { fontSize: 11, fontWeight: '700' },
  proofCard: { marginBottom: spacing.md },
  proofHeader: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  proofThumb: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  proofStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  proofStatusText: { fontSize: 12, fontWeight: '700' },
  notes: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, gap: 2 },
  actionBar: { gap: spacing.sm },
  workflowRow: { flexDirection: 'row', gap: spacing.sm },
  secondaryRow: { flexDirection: 'row', justifyContent: 'space-around' },
  secondaryAction: { flex: 1, minHeight: TOUCH_TARGET + 8, alignItems: 'center', justifyContent: 'center', gap: 2 },
  secondaryLabel: { fontSize: 12, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, maxHeight: '90%' },
  sheetMessage: { marginTop: spacing.xs, marginBottom: spacing.md },
  sheetActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  fieldTitle: { marginBottom: spacing.sm },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  officersLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  officerList: { gap: spacing.xs },
  officerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET + 4,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  officerRowSelected: { borderColor: colors.authority, backgroundColor: colors.authorityLight },
});

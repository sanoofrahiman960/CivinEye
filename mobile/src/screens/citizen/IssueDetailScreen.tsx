import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';

import MapView from '../../components/SafeMapView';

import { toApiError } from '../../api/client';
import { issueApi } from '../../api/issueApi';
import { BeforeAfterSlider } from '../../components/BeforeAfterSlider';
import { ImageUploader } from '../../components/ImageUploader';
import { PhotoGallery } from '../../components/PhotoGallery';
import { PriorityBadge } from '../../components/PriorityBadge';
import { ReasonModal } from '../../components/ReasonModal';
import { Screen } from '../../components/Screen';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { OverdueBadge, StatusBadge } from '../../components/StatusBadge';
import { LifecycleProgress, StatusTimeline, type TimelineEntry } from '../../components/StatusTimeline';
import { Banner, Button, Card, KeyValue, SectionHeader, TextField } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import type { CitizenStackScreenProps } from '../../navigation/types';
import { useReferenceStore } from '../../store/referenceStore';
import { colors, radius, spacing, TOUCH_TARGET, typography, type IconName } from '../../theme';
import type { CitizenIssueView, Comment, DurabilityAnswerResult, IssueDetail, IssueImage, PublicIssue, Role } from '../../types/api';
import { formatCoordinate, formatDate, formatDateTime, formatDue, formatRelative } from '../../utils/format';
import type { LocalPhoto } from '../../utils/image';
import { getCurrentLocation } from '../../utils/location';

const ROLE_LABELS: Record<Role, string> = {
  CITIZEN: 'Citizen',
  OFFICER: 'Officer',
  SUPERVISOR: 'Supervisor',
  ADMIN: 'Administrator',
};

const RATING_LABELS = ['Very poor', 'Poor', 'Okay', 'Good', 'Excellent'];

function byTime(a: { created_at: string }, b: { created_at: string }) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function latestOfType(images: IssueImage[], type: IssueImage['image_type']): IssueImage | undefined {
  return images
    .filter((i) => i.image_type === type)
    .sort((a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime())[0];
}

function openInMaps(latitude: number, longitude: number) {
  const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  Linking.openURL(url).catch(() => Alert.alert('Could not open maps', `The location is ${formatCoordinate(latitude, longitude)}.`));
}

function closureExplanation(issue: CitizenIssueView): { icon: IconName; title: string; text: string } | null {
  if (issue.status !== 'CLOSED' || !issue.closure_type) return null;
  const owner = issue.is_owner;
  switch (issue.closure_type) {
    case 'CITIZEN_CONFIRMED':
      return {
        icon: 'checkmark-done-circle',
        title: owner ? 'You confirmed the fix' : 'Fix confirmed by the reporter',
        text: owner ? 'Thank you for confirming this issue was resolved.' : 'The person who reported this confirmed it was fixed.',
      };
    case 'AUTO_TIMEOUT':
      return {
        icon: 'time',
        title: owner ? 'Closed automatically — not confirmed by you' : 'Closed automatically',
        text: owner
          ? 'The department marked this as fixed, but it was not confirmed within the verification period, so it closed automatically.'
          : 'The department marked this as fixed and it was not confirmed by the reporter within the verification period.',
      };
    case 'ADMIN_CLOSED':
      return {
        icon: 'lock-closed',
        title: 'Closed by an administrator',
        text: 'An administrator closed this complaint. Check the timeline for the reason.',
      };
    default:
      return null;
  }
}

export function IssueDetailScreen({ navigation, route }: CitizenStackScreenProps<'IssueDetail'>) {
  const { issueId } = route.params;
  const { data: issue, error, loading, refreshing, reload, refresh, setData } = useApi(() => issueApi.detail(issueId), [issueId], {
    refetchOnFocus: true,
  });
  const config = useReferenceStore((s) => s.config);
  const isEnabled = useReferenceStore((s) => s.isEnabled);
  const maxPhotos = config?.policies.max_images_per_upload ?? 5;
  const reopenWindowDays = config?.policies.citizen_reopen_window_days;
  const affectsMeTooEnabled = isEnabled('affects_me_too');

  // Confirm resolution
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [ratingComment, setRatingComment] = useState('');
  // Reopen
  const [reopenVisible, setReopenVisible] = useState(false);
  const [reopenPhotos, setReopenPhotos] = useState<LocalPhoto[]>([]);
  // Additional evidence
  const [evidenceVisible, setEvidenceVisible] = useState(false);
  const [evidencePhotos, setEvidencePhotos] = useState<LocalPhoto[]>([]);
  const [evidenceCaption, setEvidenceCaption] = useState('');
  const [evidenceError, setEvidenceError] = useState<string | undefined>();
  // Durability
  const [returnedVisible, setReturnedVisible] = useState(false);
  const [returnedNote, setReturnedNote] = useState('');
  const [returnedPhotos, setReturnedPhotos] = useState<LocalPhoto[]>([]);
  const [returnedErrors, setReturnedErrors] = useState<{ note?: string; photos?: string }>({});
  const [durabilityResult, setDurabilityResult] = useState<DurabilityAnswerResult | null>(null);
  // Comments
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | undefined>();

  const confirmAction = useAction();
  const reopenAction = useAction();
  const evidenceAction = useAction();
  const durabilityAction = useAction();
  const commentAction = useAction();
  const supportAction = useAction();

  useEffect(() => {
    if (issue?.complaint_id) navigation.setOptions({ title: issue.complaint_id });
  }, [navigation, issue?.complaint_id]);

  const timeline: TimelineEntry[] = useMemo(() => {
    if (!issue) return [];
    return [...issue.history].sort(byTime);
  }, [issue]);

  if (loading && !issue) {
    return (
      <Screen scroll={false}>
        <LoadingState message="Loading issue…" />
      </Screen>
    );
  }

  if (!issue) {
    if (error?.status === 404) {
      return (
        <Screen scroll={false}>
          <EmptyState
            icon="search-outline"
            title="Issue not found"
            message="This complaint doesn't exist or is no longer available."
            action={{ label: 'Go back', onPress: () => navigation.goBack() }}
          />
        </Screen>
      );
    }
    return (
      <Screen scroll={false}>
        <ErrorState error={error} onRetry={reload} />
      </Screen>
    );
  }

  const current = issue;
  const owner: IssueDetail | null = current.is_owner ? current : null;
  const publicView: PublicIssue | null = current.is_owner ? null : current;
  const reportImage = current.images.find((i) => i.image_type === 'REPORT');
  const resolutionImage = latestOfType(current.images, 'RESOLUTION');
  const showBeforeAfter = (current.status === 'RESOLVED' || current.status === 'CLOSED') && reportImage && resolutionImage;
  const closure = closureExplanation(current);
  const showReopenClosed = owner?.can_reopen && owner.status === 'CLOSED';

  // --- Actions ------------------------------------------------------------------------------

  function openConfirm() {
    setRating(null);
    setRatingComment('');
    setConfirmVisible(true);
  }

  function submitConfirm() {
    Alert.alert('Close this complaint?', "You're confirming the problem has been fixed. The complaint will be closed.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: "Yes, it's fixed",
        onPress: () =>
          confirmAction.run(async () => {
            try {
              const updated = await issueApi.confirmResolution(current.id, rating, ratingComment.trim());
              setData(updated);
              setConfirmVisible(false);
              Alert.alert('Thank you!', 'Your confirmation closes this complaint. Thanks for helping improve your community.');
            } catch (err) {
              Alert.alert("Couldn't confirm", toApiError(err).message);
            }
          }),
      },
    ]);
  }

  function openReopen() {
    setReopenPhotos([]);
    setReopenVisible(true);
  }

  function submitReopen(reason: string) {
    Alert.alert('Reopen this complaint?', 'The department will be told the problem is not fixed and will look at it again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reopen',
        style: 'destructive',
        onPress: () =>
          reopenAction.run(async () => {
            try {
              const updated = await issueApi.reopen(
                current.id,
                reason,
                reopenPhotos.map((p) => ({ uri: p.uri })),
              );
              setData(updated);
              setReopenVisible(false);
              Alert.alert('Complaint reopened', 'The department has been notified that the problem is not fixed.');
            } catch (err) {
              Alert.alert("Couldn't reopen", toApiError(err).message);
            }
          }),
      },
    ]);
  }

  function openEvidence() {
    setEvidencePhotos([]);
    setEvidenceCaption('');
    setEvidenceError(undefined);
    setEvidenceVisible(true);
  }

  function submitEvidence() {
    if (!evidencePhotos.length) {
      setEvidenceError('Add at least one photo.');
      return;
    }
    evidenceAction.run(async () => {
      try {
        await issueApi.addEvidence(
          current.id,
          evidencePhotos.map((p) => ({ uri: p.uri })),
          evidenceCaption.trim(),
        );
        setEvidenceVisible(false);
        Alert.alert('Evidence added', 'Your photos have been added and the department has been notified.');
        refresh();
      } catch (err) {
        const apiError = toApiError(err);
        const fieldMessage = apiError.fieldError('images');
        if (fieldMessage) setEvidenceError(fieldMessage);
        else Alert.alert("Couldn't add evidence", apiError.message);
      }
    });
  }

  function answerStillFixed() {
    Alert.alert('Still fixed?', "Confirm that the problem hasn't come back.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Still fixed',
        onPress: () =>
          durabilityAction.run(async () => {
            try {
              const result = await issueApi.answerDurability(current.id, 'STILL_FIXED');
              setDurabilityResult(result);
              Alert.alert('Thanks for letting us know', 'Good to hear the fix is holding up.');
              refresh();
            } catch (err) {
              const apiError = toApiError(err);
              Alert.alert("Couldn't send your answer", apiError.message);
              if (apiError.code === 'check_closed') refresh();
            }
          }),
      },
    ]);
  }

  function openProblemReturned() {
    setReturnedNote('');
    setReturnedPhotos([]);
    setReturnedErrors({});
    setReturnedVisible(true);
  }

  function submitProblemReturned() {
    const errors: { note?: string; photos?: string } = {};
    if (returnedNote.trim().length < 3) errors.note = 'Tell us briefly what is wrong again.';
    if (!returnedPhotos.length) errors.photos = 'Add at least one photo showing the problem.';
    if (errors.note || errors.photos) {
      setReturnedErrors(errors);
      return;
    }
    durabilityAction.run(async () => {
      try {
        const result = await issueApi.answerDurability(
          current.id,
          'PROBLEM_RETURNED',
          returnedNote.trim(),
          returnedPhotos.map((p) => ({ uri: p.uri })),
        );
        setDurabilityResult(result);
        setReturnedVisible(false);
        refresh();
      } catch (err) {
        const apiError = toApiError(err);
        const photoError = apiError.fieldError('images');
        if (photoError) {
          setReturnedErrors({ photos: photoError });
          return;
        }
        Alert.alert("Couldn't send your answer", apiError.message);
        if (apiError.code === 'check_closed') {
          setReturnedVisible(false);
          refresh();
        }
      }
    });
  }

  function sendComment() {
    const text = comment.trim();
    if (!text) {
      setCommentError('Write a message first.');
      return;
    }
    commentAction.run(async () => {
      try {
        const created: Comment = await issueApi.addComment(current.id, text);
        setComment('');
        setCommentError(undefined);
        if (current.is_owner) setData({ ...current, comments: [...current.comments, created] });
        refresh();
      } catch (err) {
        const apiError = toApiError(err);
        const fieldMessage = apiError.fieldError('comment');
        if (fieldMessage) setCommentError(fieldMessage);
        else Alert.alert("Couldn't send your comment", apiError.message);
      }
    });
  }

  function handleSupportError(err: unknown) {
    const apiError = toApiError(err);
    switch (apiError.code) {
      case 'too_far':
        Alert.alert('Too far away', `${apiError.message} We check your current position so that only people nearby can add support.`);
        break;
      case 'own_issue':
        Alert.alert('This is your report', 'You reported this issue, so you are already counted.');
        break;
      case 'already_supported':
        Alert.alert('Already counted', 'You have already said this issue affects you.');
        refresh();
        break;
      case 'not_supported':
        Alert.alert('Nothing to remove', 'You had not added your support to this issue.');
        refresh();
        break;
      case 'issue_closed':
        Alert.alert('Issue closed', apiError.message);
        refresh();
        break;
      case 'feature_disabled':
        Alert.alert('Not available', '"This affects me too" is turned off at the moment.');
        break;
      default:
        Alert.alert("Couldn't update your support", apiError.message);
    }
  }

  function addSupport() {
    supportAction.run(async () => {
      const position = await getCurrentLocation();
      if (!position.ok) {
        Alert.alert('Location needed', `${position.message}\n\nWe need your current location to confirm you are near this issue.`);
        return;
      }
      try {
        const updated = await issueApi.support(current.id, position.coords.latitude, position.coords.longitude);
        setData(updated);
        Alert.alert('Thanks — you have been counted', 'Officials can see how many people are affected when they set priorities.');
      } catch (err) {
        handleSupportError(err);
      }
    });
  }

  function removeSupport() {
    Alert.alert('Remove your support?', 'You will no longer be counted as affected by this issue.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          supportAction.run(async () => {
            try {
              setData(await issueApi.removeSupport(current.id));
            } catch (err) {
              handleSupportError(err);
            }
          }),
      },
    ]);
  }

  // --- Sections ----------------------------------------------------------------------------------

  const verificationPanel = owner?.can_confirm ? (
    <Card style={[styles.panel, { borderLeftColor: colors.primary }]}>
      <View style={styles.panelHeader}>
        <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
        <Text style={typography.heading} accessibilityRole="header">
          Is it fixed?
        </Text>
      </View>
      <Text style={[typography.caption, { marginBottom: spacing.md }]}>
        The department says this problem has been resolved. Please check and let us know.
        {config?.policies.auto_close_on_verification_timeout && config.policies.verification_timeout_days
          ? ` If you don't respond within ${config.policies.verification_timeout_days} days, it will close automatically.`
          : ''}
      </Text>
      <Button title="Yes, it's fixed" icon="checkmark-circle" onPress={openConfirm} />
      {owner.can_reopen ? (
        <Button title="No, reopen" icon="refresh-circle" variant="outline" color={colors.danger} onPress={openReopen} style={{ marginTop: spacing.sm }} />
      ) : null}
    </Card>
  ) : null;

  const reopenClosedPanel = showReopenClosed ? (
    <Card style={[styles.panel, { borderLeftColor: colors.warning }]}>
      <View style={styles.panelHeader}>
        <Ionicons name="refresh-circle" size={24} color={colors.warning} />
        <Text style={typography.subheading}>Not fixed after all?</Text>
      </View>
      <Text style={[typography.caption, { marginBottom: spacing.md }]}>
        {reopenWindowDays
          ? `You can reopen this complaint within ${reopenWindowDays} days of it being closed.`
          : 'You can still reopen this complaint for a short time after it was closed.'}
      </Text>
      <Button title="Reopen complaint" icon="refresh" variant="outline" color={colors.danger} onPress={openReopen} />
    </Card>
  ) : null;

  const durabilityPanel = current.durability_check_pending ? (
    <Card style={[styles.panel, { borderLeftColor: colors.info }]}>
      <View style={styles.panelHeader}>
        <Ionicons name="help-buoy" size={24} color={colors.info} />
        <Text style={typography.heading} accessibilityRole="header">
          Is it still fixed?
        </Text>
      </View>
      <Text style={[typography.caption, { marginBottom: spacing.md }]}>
        This was fixed a while ago. Let us know if the repair is holding up — it helps the city improve the quality of its work.
      </Text>
      <View style={styles.row}>
        <Button
          title="Still fixed"
          icon="thumbs-up"
          onPress={answerStillFixed}
          loading={durabilityAction.busy && !returnedVisible}
          style={{ flex: 1 }}
        />
        <Button
          title="Problem returned"
          icon="alert-circle"
          variant="outline"
          color={colors.danger}
          onPress={openProblemReturned}
          disabled={durabilityAction.busy}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  ) : null;

  const durabilityResultPanel = durabilityResult ? (
    durabilityResult.response === 'PROBLEM_RETURNED' ? (
      <Card style={[styles.panel, { borderLeftColor: colors.warning }]}>
        <View style={styles.panelHeader}>
          <Ionicons name="document-text" size={24} color={colors.warning} />
          <Text style={typography.subheading}>Follow-up complaint created</Text>
        </View>
        {durabilityResult.follow_up_issue ? (
          <>
            <Text style={typography.caption}>We've logged that the problem came back. Track it with this complaint ID:</Text>
            <Text style={styles.followUpId} selectable>
              {durabilityResult.follow_up_issue.complaint_id}
            </Text>
            <Button
              title="Open follow-up complaint"
              icon="arrow-forward"
              onPress={() => {
                const followUp = durabilityResult.follow_up_issue;
                if (followUp) navigation.push('IssueDetail', { issueId: followUp.id });
              }}
            />
          </>
        ) : (
          <Text style={typography.caption}>Thanks — your answer has been recorded and the department has been told.</Text>
        )}
      </Card>
    ) : (
      <Banner tone="success" title="Thanks for confirming" message="You told us the fix is still holding up." />
    )
  ) : null;

  const supportPanel =
    publicView && affectsMeTooEnabled && (publicView.can_support || publicView.supported_by_me) ? (
      <Card style={styles.sectionCard}>
        <View style={styles.panelHeader}>
          <Ionicons name="people" size={22} color={colors.primary} />
          <Text style={typography.subheading}>Does this affect you?</Text>
        </View>
        <Text style={[typography.caption, { marginBottom: spacing.md }]}>
          {publicView.supported_by_me
            ? "You've said this issue affects you. Officials use this to understand how many people are affected."
            : 'Say it affects you too instead of filing a duplicate report. We check your current location to make sure you are nearby.'}
        </Text>
        {publicView.supported_by_me ? (
          <Button title="Remove my support" icon="person-remove" variant="outline" onPress={removeSupport} loading={supportAction.busy} />
        ) : (
          <Button title="This affects me too" icon="person-add" onPress={addSupport} loading={supportAction.busy} />
        )}
      </Card>
    ) : null;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <PhotoGallery images={current.images} emptyText="No photos attached" />

      <View style={styles.headerBlock}>
        <Text style={styles.complaintId} selectable accessibilityLabel={`Complaint ID ${current.complaint_id}`}>
          {current.complaint_id}
        </Text>
        <Text style={typography.title} accessibilityRole="header">
          {current.title}
        </Text>
        <View style={styles.badges}>
          <StatusBadge status={current.status} long />
          <PriorityBadge priority={current.priority} />
          {current.is_overdue ? <OverdueBadge /> : null}
        </View>
        <LifecycleProgress status={current.status} />
        {current.impact_count > 0 ? (
          <View style={styles.impact} accessible accessibilityLabel={`${current.impact_count} other people said this affects them`}>
            <Ionicons name="people" size={16} color={colors.textMuted} />
            <Text style={typography.caption}>
              {current.impact_count} other {current.impact_count === 1 ? 'person' : 'people'} said this affects them too
            </Text>
          </View>
        ) : null}
      </View>

      {publicView ? (
        <Banner
          tone="info"
          icon="lock-closed"
          title="Reporter details are private"
          message="You're viewing a public summary. The location shown is approximate to protect the reporter's privacy."
        />
      ) : null}

      {verificationPanel}
      {reopenClosedPanel}
      {durabilityResultPanel}
      {durabilityPanel}
      {supportPanel}

      {closure ? (
        <Card style={[styles.panel, { borderLeftColor: colors.success }]}>
          <View style={styles.panelHeader}>
            <Ionicons name={closure.icon} size={22} color={colors.success} />
            <Text style={typography.subheading}>{closure.title}</Text>
          </View>
          <Text style={typography.caption}>{closure.text}</Text>
          {current.closed_at ? <Text style={[typography.small, { marginTop: spacing.xs }]}>Closed {formatDateTime(current.closed_at)}</Text> : null}
          {owner?.satisfaction_rating ? (
            <View style={[styles.row, { marginTop: spacing.sm, alignItems: 'center' }]}>
              <Text style={typography.caption}>Your rating:</Text>
              <Stars value={owner.satisfaction_rating} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {current.status === 'RESOLVED' && publicView ? (
        <Banner tone="info" icon="shield-checkmark" message="The department says this is fixed. Waiting for the reporter to confirm." />
      ) : null}

      {showBeforeAfter && reportImage && resolutionImage ? (
        <>
          <SectionHeader title="Before and after" />
          <BeforeAfterSlider before={reportImage} after={resolutionImage} />
          {owner?.resolution_description ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text style={typography.subheading}>What was done</Text>
              <Text style={[typography.body, { marginTop: spacing.xs }]}>{owner.resolution_description}</Text>
            </Card>
          ) : null}
        </>
      ) : owner?.resolution_description && (current.status === 'RESOLVED' || current.status === 'CLOSED') ? (
        <>
          <SectionHeader title="Resolution" />
          <Card>
            <Text style={typography.body}>{owner.resolution_description}</Text>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Details" />
      <Card>
        <KeyValue label="Category" value={current.category.name} icon="pricetag-outline" />
        {owner?.subcategory ? <KeyValue label="Type" value={owner.subcategory.name} icon="list-outline" /> : null}
        {owner ? <KeyValue label="Department" value={owner.department?.name ?? 'Not yet assigned'} icon="business-outline" /> : null}
        {owner ? <KeyValue label="Assigned officer" value={owner.assigned_officer_name ?? 'Not yet assigned'} icon="person-outline" /> : null}
        <KeyValue label="Reported" value={formatDateTime(current.created_at)} icon="calendar-outline" />
        {owner?.due_at && owner.status !== 'CLOSED' ? (
          <KeyValue
            label="Target date"
            value={
              <Text style={[styles.kvValue, owner.is_overdue && { color: colors.danger }]}>
                {formatDate(owner.due_at)} · {formatDue(owner.due_at)}
              </Text>
            }
            icon="flag-outline"
          />
        ) : null}
        {current.resolved_at ? <KeyValue label="Resolved" value={formatDateTime(current.resolved_at)} icon="construct-outline" /> : null}
        {owner?.reported_urgency ? (
          <KeyValue label="Your urgency" value={<PriorityBadge priority={owner.reported_urgency} size="sm" />} icon="speedometer-outline" />
        ) : null}
        {owner && owner.reopen_count > 0 ? <KeyValue label="Reopened" value={`${owner.reopen_count} time${owner.reopen_count === 1 ? '' : 's'}`} icon="refresh-outline" /> : null}
        {owner?.is_recurrence && owner.parent_complaint_id ? (
          <KeyValue label="Follow-up of" value={owner.parent_complaint_id} icon="git-branch-outline" />
        ) : null}
        <Text style={[typography.subheading, { marginTop: spacing.md }]}>Description</Text>
        <Text style={[typography.body, { marginTop: spacing.xs }]}>{current.description}</Text>
        {owner?.additional_details ? (
          <>
            <Text style={[typography.subheading, { marginTop: spacing.md }]}>Additional details</Text>
            <Text style={[typography.body, { marginTop: spacing.xs }]}>{owner.additional_details}</Text>
          </>
        ) : null}
      </Card>

      <SectionHeader title="Location" />
      <Card>
        {current.address ? <Text style={typography.body}>{current.address}</Text> : null}
        <Text style={typography.caption}>
          {formatCoordinate(current.latitude, current.longitude)}
          {publicView ? ' (approximate)' : ''}
        </Text>
        <View style={styles.mapWrap}>
          <MapView
            style={StyleSheet.absoluteFill}
            initialRegion={{ latitude: current.latitude, longitude: current.longitude, latitudeDelta: 0.005, longitudeDelta: 0.005 }}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            toolbarEnabled={false}
            liteMode
            accessibilityLabel={`Map of the issue location${current.address ? `, ${current.address}` : ''}`}
          >
            <Marker coordinate={{ latitude: current.latitude, longitude: current.longitude }} pinColor={colors.primary} />
          </MapView>
        </View>
        <Button
          title="Open in Maps"
          icon="open-outline"
          variant="outline"
          compact
          onPress={() => openInMaps(current.latitude, current.longitude)}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      {owner ? (
        <>
          {owner.can_add_evidence ? (
            <Button title="Add evidence" icon="camera" variant="secondary" onPress={openEvidence} style={{ marginTop: spacing.xl }} />
          ) : null}

          <SectionHeader title={`Messages${owner.comments.length ? ` (${owner.comments.length})` : ''}`} />
          <Card>
            {owner.comments.length ? (
              [...owner.comments].sort(byTime).map((c) => (
                <View key={c.id} style={[styles.comment, c.is_mine && styles.commentMine]}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentAuthor}>{c.is_mine ? 'You' : c.author_name}</Text>
                    {!c.is_mine ? <Text style={styles.roleTag}>{ROLE_LABELS[c.author_role]}</Text> : null}
                    <Text style={[typography.small, { marginLeft: 'auto' }]}>{formatRelative(c.created_at)}</Text>
                  </View>
                  <Text style={typography.body}>{c.comment}</Text>
                </View>
              ))
            ) : (
              <Text style={[typography.caption, { marginBottom: spacing.md }]}>
                No messages yet. Ask a question or share an update with the department.
              </Text>
            )}
            <TextField
              label="Add a message"
              value={comment}
              onChangeText={(value) => {
                setComment(value);
                setCommentError(undefined);
              }}
              placeholder="Write to the department handling this complaint"
              multiline
              maxLength={2000}
              error={commentError}
            />
            <Button title="Send message" icon="send" onPress={sendComment} loading={commentAction.busy} compact />
          </Card>
        </>
      ) : null}

      <SectionHeader title="Timeline" />
      <Card>
        {timeline.length ? <StatusTimeline entries={timeline} /> : <Text style={typography.caption}>No updates yet.</Text>}
        {publicView ? <Text style={typography.small}>Only status changes are shown publicly.</Text> : null}
      </Card>

      {/* Confirm resolution */}
      <SheetModal visible={confirmVisible} title="Great — it's fixed!" onClose={() => !confirmAction.busy && setConfirmVisible(false)}>
        <Text style={[typography.caption, { marginBottom: spacing.md }]}>
          Optionally rate how the department handled your complaint. Confirming closes the complaint.
        </Text>
        <Text style={styles.fieldLabel}>Your rating (optional)</Text>
        <View style={styles.starRow} accessibilityRole="radiogroup" accessibilityLabel="Rating from 1 to 5 stars">
          {[1, 2, 3, 4, 5].map((value) => {
            const active = rating !== null && value <= rating;
            return (
              <Pressable
                key={value}
                onPress={() => setRating((cur) => (cur === value ? null : value))}
                accessibilityRole="radio"
                accessibilityState={{ checked: rating === value, selected: rating === value }}
                accessibilityLabel={`${value} star${value === 1 ? '' : 's'}, ${RATING_LABELS[value - 1]}`}
                style={styles.starButton}
              >
                <Ionicons name={active ? 'star' : 'star-outline'} size={32} color={active ? '#CA8A04' : colors.textSubtle} />
              </Pressable>
            );
          })}
        </View>
        <Text style={[typography.small, { marginBottom: spacing.md }]}>{rating ? RATING_LABELS[rating - 1] : 'No rating selected'}</Text>
        <TextField
          label="Comment (optional)"
          value={ratingComment}
          onChangeText={setRatingComment}
          placeholder="Anything you'd like to add?"
          multiline
          maxLength={2000}
        />
        <View style={styles.row}>
          <Button title="Cancel" variant="outline" onPress={() => setConfirmVisible(false)} disabled={confirmAction.busy} style={{ flex: 1 }} />
          <Button title="Confirm fixed" icon="checkmark" onPress={submitConfirm} loading={confirmAction.busy} style={{ flex: 1 }} />
        </View>
      </SheetModal>

      {/* Reopen */}
      <ReasonModal
        visible={reopenVisible}
        title="Reopen this complaint"
        message="Tell the department what is still wrong. Adding a new photo helps."
        label="What is still wrong?"
        placeholder="e.g. The pothole was only partly filled"
        confirmLabel="Reopen"
        destructive
        busy={reopenAction.busy}
        onCancel={() => !reopenAction.busy && setReopenVisible(false)}
        onConfirm={submitReopen}
      >
        <ImageUploader photos={reopenPhotos} onChange={setReopenPhotos} max={maxPhotos} label="New photos (optional)" />
      </ReasonModal>

      {/* Additional evidence */}
      <SheetModal visible={evidenceVisible} title="Add evidence" onClose={() => !evidenceAction.busy && setEvidenceVisible(false)}>
        <Text style={[typography.caption, { marginBottom: spacing.md }]}>Add more photos to help the department understand the problem.</Text>
        <ImageUploader
          photos={evidencePhotos}
          onChange={(next) => {
            setEvidencePhotos(next);
            setEvidenceError(undefined);
          }}
          max={maxPhotos}
          error={evidenceError}
        />
        <TextField
          label="Caption (optional)"
          value={evidenceCaption}
          onChangeText={setEvidenceCaption}
          placeholder="What do these photos show?"
          maxLength={255}
        />
        <View style={styles.row}>
          <Button title="Cancel" variant="outline" onPress={() => setEvidenceVisible(false)} disabled={evidenceAction.busy} style={{ flex: 1 }} />
          <Button title="Upload" icon="cloud-upload" onPress={submitEvidence} loading={evidenceAction.busy} style={{ flex: 1 }} />
        </View>
      </SheetModal>

      {/* Durability: problem returned */}
      <SheetModal visible={returnedVisible} title="The problem came back" onClose={() => !durabilityAction.busy && setReturnedVisible(false)}>
        <Text style={[typography.caption, { marginBottom: spacing.md }]}>
          We'll open a linked follow-up complaint so the department can fix it properly. A note and a photo are required.
        </Text>
        <TextField
          label="What's wrong again?"
          value={returnedNote}
          onChangeText={(value) => {
            setReturnedNote(value);
            setReturnedErrors((e) => ({ ...e, note: undefined }));
          }}
          placeholder="e.g. The streetlight stopped working again last week"
          multiline
          maxLength={500}
          error={returnedErrors.note}
        />
        <ImageUploader
          photos={returnedPhotos}
          onChange={(next) => {
            setReturnedPhotos(next);
            setReturnedErrors((e) => ({ ...e, photos: undefined }));
          }}
          max={maxPhotos}
          label="Photos (required)"
          error={returnedErrors.photos}
        />
        <View style={styles.row}>
          <Button title="Cancel" variant="outline" onPress={() => setReturnedVisible(false)} disabled={durabilityAction.busy} style={{ flex: 1 }} />
          <Button title="Send" icon="send" variant="danger" onPress={submitProblemReturned} loading={durabilityAction.busy} style={{ flex: 1 }} />
        </View>
      </SheetModal>
    </Screen>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <View style={styles.starsInline} accessible accessibilityLabel={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Ionicons key={n} name={n <= value ? 'star' : 'star-outline'} size={16} color={n <= value ? '#CA8A04' : colors.textSubtle} />
      ))}
      <Text style={typography.small}> {RATING_LABELS[value - 1]}</Text>
    </View>
  );
}

function SheetModal({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={[typography.heading, { marginBottom: spacing.xs }]} accessibilityRole="header">
              {title}
            </Text>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  headerBlock: { marginTop: spacing.lg, marginBottom: spacing.md, gap: spacing.xs },
  complaintId: { fontSize: 14, fontWeight: '800', color: colors.primary, letterSpacing: 0.5 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs, marginBottom: spacing.sm },
  impact: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  panel: { borderLeftWidth: 4, marginBottom: spacing.md },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  sectionCard: { marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  followUpId: { fontSize: 24, fontWeight: '800', color: colors.primary, marginVertical: spacing.sm },
  kvValue: { fontSize: 14, color: colors.text, fontWeight: '500' },
  mapWrap: { height: 170, borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm, backgroundColor: colors.surfaceMuted },
  comment: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
  },
  commentMine: { backgroundColor: colors.primaryLight },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  commentAuthor: { fontSize: 14, fontWeight: '700', color: colors.text },
  roleTag: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.authority,
    backgroundColor: colors.authorityLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  fieldLabel: { ...typography.subheading, marginBottom: spacing.xs },
  starRow: { flexDirection: 'row', gap: spacing.xs },
  starButton: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  starsInline: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, maxHeight: '90%' },
});

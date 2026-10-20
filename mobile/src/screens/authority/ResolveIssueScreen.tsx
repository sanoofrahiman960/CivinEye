import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { authorityApi, type ResolutionCapture } from '../../api/authorityApi';
import { toApiError, type ApiError } from '../../api/client';
import { GhostOverlayCamera, type ProofCapture } from '../../components/GhostOverlayCamera';
import { ReasonModal } from '../../components/ReasonModal';
import { ErrorState, LoadingState } from '../../components/States';
import { StatusBadge } from '../../components/StatusBadge';
import { Screen } from '../../components/Screen';
import { Banner, Button, Card, IconButton, KeyValue, SectionHeader, TextField } from '../../components/ui';
import { useAction, useApi } from '../../hooks/useApi';
import type { AuthorityStackScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { useReferenceStore } from '../../store/referenceStore';
import { colors, radius, spacing, typography } from '../../theme';
import type { AuthorityIssueImage } from '../../types/api';
import { formatCoordinate, formatDateTime, formatDistance } from '../../utils/format';
import { PROOF_STATUS } from './AuthorityIssueDetailScreen';

const MAX_PHOTOS = 3;

/** Great-circle distance in metres, used only as an on-screen hint before the server's own check. */
function distanceMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function captureMetadata(first: ProofCapture | undefined): ResolutionCapture {
  if (!first) return { capture_source: 'CAMERA' };
  return {
    capture_source: 'CAMERA',
    capture_latitude: first.capture_latitude,
    capture_longitude: first.capture_longitude,
    capture_accuracy_m: first.capture_accuracy_m,
    captured_at: first.captured_at,
  };
}

export function ResolveIssueScreen({ route, navigation }: AuthorityStackScreenProps<'ResolveIssue'>) {
  const { issueId } = route.params;
  const user = useAuthStore((s) => s.user);
  const proofLockEnabled = useReferenceStore((s) => s.isEnabled('proof_lock'));
  const maxDistance = useReferenceStore((s) => s.featureConfig('proof_lock', 'max_distance_m', 50));
  const maxAccuracy = useReferenceStore((s) => s.featureConfig('proof_lock', 'max_accuracy_m', 30));
  const loadReference = useReferenceStore((s) => s.load);
  const { data: issue, error, loading, refresh, reload } = useApi(() => authorityApi.detail(issueId), [issueId]);
  const { busy, run } = useAction();

  const [captures, setCaptures] = useState<ProofCapture[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [descriptionError, setDescriptionError] = useState<string | undefined>();
  const [photoError, setPhotoError] = useState<string | undefined>();
  /** Photos flagged by the last submission (from the 409 response). */
  const [justFlagged, setJustFlagged] = useState<AuthorityIssueImage[] | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  useEffect(() => {
    loadReference().catch(() => undefined);
  }, [loadReference]);

  const complaintId = issue?.complaint_id;
  useLayoutEffect(() => {
    if (complaintId) navigation.setOptions({ title: `Resolve ${complaintId}` });
  }, [navigation, complaintId]);

  if (loading && !issue) return <LoadingState message="Loading issue…" />;
  if (!issue) return <ErrorState error={error} onRetry={reload} />;

  const isSupervisor = user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';
  const reportImage = issue.images.find((image) => image.image_type === 'REPORT') ?? null;
  const cycleImages = issue.images.filter((image) => image.image_type === 'RESOLUTION' && image.resolution_cycle === issue.resolution_cycle);
  const cycleAccepted = cycleImages.filter((image) => image.proof_check_status === 'PASSED' || image.proof_check_status === 'OVERRIDDEN');
  const cycleFlagged = cycleImages.filter((image) => image.proof_check_status === 'FLAGGED');
  // Prefer the server's current view of this resolution attempt; fall back to the 409 payload.
  const flaggedImages = cycleFlagged.length ? cycleFlagged : justFlagged ?? [];
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${issue.latitude},${issue.longitude}`;

  if (issue.status !== 'IN_PROGRESS') {
    return (
      <Screen>
        <Banner
          tone="warning"
          title="This issue can't be resolved right now"
          message="Only issues that are In Progress can be marked as resolved. Start work on the issue first."
        />
        <Card>
          <Text style={styles.complaintId}>{issue.complaint_id}</Text>
          <Text style={typography.heading}>{issue.title}</Text>
          <View style={{ marginTop: spacing.sm }}>
            <StatusBadge status={issue.status} long />
          </View>
        </Card>
        <Button title="Back to issue" icon="arrow-back" color={colors.authority} onPress={() => navigation.goBack()} style={{ marginTop: spacing.lg }} />
      </Screen>
    );
  }

  function openCamera(index: number | null = null) {
    setRetakeIndex(index);
    setCameraOpen(true);
  }

  function onCapture(capture: ProofCapture) {
    setCaptures((current) => {
      if (retakeIndex !== null && retakeIndex < current.length) {
        return current.map((item, i) => (i === retakeIndex ? capture : item));
      }
      return current.length >= MAX_PHOTOS ? current : [...current, capture];
    });
    setRetakeIndex(null);
    setCameraOpen(false);
    setPhotoError(undefined);
  }

  function removeCapture(index: number) {
    setCaptures((current) => current.filter((_, i) => i !== index));
  }

  function validateDescription(): boolean {
    if (description.trim().length < 3) {
      setDescriptionError('Describe the work that was done.');
      return false;
    }
    return true;
  }

  function succeed() {
    Alert.alert('Marked as resolved', 'The citizen has been asked to verify the fix.');
    navigation.goBack();
  }

  function handleResolveError(err: ApiError) {
    switch (err.code) {
      case 'proof_check_flagged': {
        const images = Array.isArray(err.details.images) ? (err.details.images as AuthorityIssueImage[]) : [];
        setJustFlagged(images);
        setCaptures([]);
        refresh();
        Alert.alert(
          'Photo needs review',
          isSupervisor
            ? `${err.message}\n\nSee the details below to retake the photo or override the check.`
            : `${err.message}\n\nYour photos have been saved. See the details below.`,
        );
        return;
      }
      case 'resolution_evidence_required':
        setPhotoError(err.message);
        Alert.alert('Photo required', `${err.message} Take a photo of the completed work at the issue location.`);
        return;
      case 'camera_required':
        setPhotoError(err.message);
        Alert.alert('Use the in-app camera', err.message);
        return;
      case 'invalid_transition':
        Alert.alert('Issue is not in progress', `${err.message} It may have been updated by someone else.`, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      default: {
        const fieldMessage = err.fieldError('resolution_description');
        if (fieldMessage) setDescriptionError(fieldMessage);
        Alert.alert("Couldn't submit the resolution", err.message);
      }
    }
  }

  function submitResolution(photos: ProofCapture[]) {
    return run(async () => {
      try {
        await authorityApi.resolve(
          issueId,
          description.trim(),
          photos.map((photo) => ({ uri: photo.uri })),
          captureMetadata(photos[0]),
        );
        succeed();
      } catch (e) {
        handleResolveError(toApiError(e));
      }
    });
  }

  function onSubmit() {
    if (!validateDescription()) return;
    if (!captures.length && !cycleAccepted.length) {
      if (cycleFlagged.length) {
        setPhotoError(
          isSupervisor
            ? 'The earlier photo was flagged. Retake it at the location, or override the check below.'
            : 'The earlier photo is waiting for supervisor review. Retake it at the location, or ask a supervisor to accept it.',
        );
        return;
      }
      Alert.alert('No photo attached', 'A photo of the completed work is normally required. Submit without a photo?', [
        { text: 'Take photo', onPress: () => openCamera() },
        { text: 'Submit anyway', onPress: () => submitResolution([]) },
      ]);
      return;
    }
    const photoText = captures.length
      ? `${captures.length} photo${captures.length === 1 ? '' : 's'} will be checked against the reported location.`
      : 'The previously accepted photo will be used.';
    Alert.alert('Mark as resolved?', `${photoText} The citizen will then be asked to verify the fix.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Submit', onPress: () => submitResolution(captures) },
    ]);
  }

  function startOverride() {
    if (!validateDescription()) {
      Alert.alert('Describe the work first', 'Add the resolution description, then override the flagged photo.');
      return;
    }
    setOverrideOpen(true);
  }

  function overrideAndResolve(reason: string) {
    const targets = flaggedImages;
    run(async () => {
      try {
        for (const image of targets) {
          try {
            await authorityApi.overrideProofCheck(image.id, reason);
          } catch (e) {
            const err = toApiError(e);
            // Already reviewed by someone else: nothing left to override for this photo.
            if (err.code !== 'not_flagged') throw err;
          }
        }
        setOverrideOpen(false);
        setJustFlagged(null);
        // No new photos: the backend reuses the overridden photos of the current resolution attempt.
        await authorityApi.resolve(issueId, description.trim(), [], { capture_source: 'CAMERA' });
        succeed();
      } catch (e) {
        setOverrideOpen(false);
        refresh();
        handleResolveError(toApiError(e));
      }
    });
  }

  return (
    <Screen
      footer={
        <Button
          title="Submit resolution"
          icon="checkmark-done"
          color={colors.authority}
          loading={busy}
          onPress={onSubmit}
          accessibilityHint="Marks the issue as resolved and asks the citizen to verify"
        />
      }
    >
      {error ? <Banner tone="warning" title="Couldn't refresh" message={error.message} action={{ label: 'Try again', onPress: refresh }} /> : null}

      <Card>
        <Text style={styles.complaintId}>{issue.complaint_id}</Text>
        <Text style={typography.heading}>{issue.title}</Text>
        <Text style={[typography.caption, { marginTop: spacing.xs }]}>{issue.category.name}</Text>
      </Card>

      <View style={styles.spaced}>
        <Banner
          tone="info"
          icon="shield-checkmark-outline"
          title={proofLockEnabled ? 'Proof-Lock photo check' : 'Location is recorded'}
          message={
            proofLockEnabled
              ? `Take the photo with this camera at the issue location. Its GPS position is compared with the reported location (within ${Math.round(maxDistance)} m, accuracy better than ${Math.round(maxAccuracy)} m) and checked for reused images. Photos that fail are kept for a supervisor to review. After you submit, the citizen will be asked to verify the fix.`
              : 'Take the photo with this camera at the issue location; its GPS position is recorded with the photo. After you submit, the citizen will be asked to verify the fix.'
          }
        />
      </View>

      {/* Original report ----------------------------------------------------------------------- */}
      <SectionHeader title="Original report" />
      <Card>
        {reportImage ? (
          <Image source={{ uri: reportImage.image_url }} style={styles.reportPhoto} contentFit="cover" accessibilityLabel="Photo of the problem as reported" />
        ) : (
          <Text style={typography.caption}>The reporter did not attach a photo.</Text>
        )}
        <View style={{ marginTop: spacing.md }}>
          <KeyValue label="Address" icon="location-outline" value={issue.address || 'No address recorded'} />
          <KeyValue label="Coordinates" icon="navigate-circle-outline" value={formatCoordinate(issue.latitude, issue.longitude)} />
        </View>
        <Button
          title="Navigate"
          icon="navigate"
          variant="outline"
          color={colors.authority}
          compact
          onPress={() => Linking.openURL(mapsUrl).catch(() => Alert.alert('Unable to open', 'No maps app is available to open directions.'))}
          accessibilityHint="Opens directions to the issue location"
          style={{ marginTop: spacing.sm }}
        />
      </Card>

      {/* Flagged photos ------------------------------------------------------------------------ */}
      {flaggedImages.length ? (
        <View style={styles.flaggedPanel} accessibilityLiveRegion="polite">
          <View style={styles.flaggedHeader}>
            <Ionicons name="warning" size={22} color={colors.warning} />
            <Text style={[typography.subheading, { flex: 1, color: colors.warning }]}>
              {justFlagged ? 'Photo did not pass the Proof-Lock check' : 'Earlier photo is awaiting review'}
            </Text>
          </View>
          {flaggedImages.map((image) => (
            <View key={image.id} style={styles.flaggedItem}>
              <Image source={{ uri: image.thumbnail_url }} style={styles.flaggedThumb} contentFit="cover" accessibilityLabel="Flagged resolution photo" />
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.statusRow}>
                  <Ionicons name={PROOF_STATUS[image.proof_check_status].icon} size={14} color={PROOF_STATUS[image.proof_check_status].color} />
                  <Text style={[styles.statusText, { color: PROOF_STATUS[image.proof_check_status].color }]}>
                    {PROOF_STATUS[image.proof_check_status].label}
                  </Text>
                </View>
                <Text style={typography.caption}>{image.proof_check_notes || 'The photo did not pass the location/originality check.'}</Text>
                <Text style={typography.small}>
                  Distance from report: {image.distance_from_issue_m !== null ? formatDistance(image.distance_from_issue_m) : 'unknown (no GPS)'}
                </Text>
              </View>
            </View>
          ))}
          {isSupervisor ? (
            <Text style={[typography.caption, styles.panelText]}>
              Retake the photo at the reported location, or — if you are satisfied the work was done here — override the check. Your name and reason are recorded.
            </Text>
          ) : (
            <Text style={[typography.caption, styles.panelText]}>
              Your photos have been saved. Retake the photo at the reported location, or ask a supervisor to review it: they can accept the flagged photo from the
              issue's detail screen, after which you can submit again without a new photo.
            </Text>
          )}
          <View style={styles.panelActions}>
            <Button
              title="Retake photo at the location"
              icon="camera-reverse-outline"
              color={colors.authority}
              onPress={() => {
                setCaptures([]);
                openCamera();
              }}
              disabled={busy}
            />
            {isSupervisor ? (
              <Button
                title="Override (supervisor)"
                icon="shield-checkmark-outline"
                variant="outline"
                color={colors.authority}
                onPress={startOverride}
                disabled={busy}
              />
            ) : null}
          </View>
        </View>
      ) : null}

      {cycleAccepted.length && !captures.length ? (
        <View style={styles.spaced}>
          <Banner
            tone="success"
            title="Photo already accepted"
            message={`${cycleAccepted.length === 1 ? 'A photo' : `${cycleAccepted.length} photos`} for this resolution ${cycleAccepted.length === 1 ? 'was' : 'were'} accepted by a supervisor. You can submit without taking a new one.`}
          />
        </View>
      ) : null}

      {/* Step 1: photos ------------------------------------------------------------------------ */}
      <SectionHeader title="1. Resolution photo" />
      <Card>
        <Text style={typography.caption}>Photograph the completed work from the same angle as the original report. Up to {MAX_PHOTOS} photos.</Text>
        {captures.map((capture, index) => {
          const hasGps = capture.capture_latitude !== null && capture.capture_longitude !== null;
          const distance = hasGps ? distanceMetres(issue.latitude, issue.longitude, capture.capture_latitude as number, capture.capture_longitude as number) : null;
          const tooFar = proofLockEnabled && distance !== null && distance > maxDistance;
          const poorAccuracy = proofLockEnabled && capture.capture_accuracy_m !== null && capture.capture_accuracy_m > maxAccuracy;
          return (
            <View key={`${capture.uri}-${index}`} style={styles.captureRow}>
              <Image source={{ uri: capture.uri }} style={styles.captureThumb} contentFit="cover" accessibilityLabel={`Resolution photo ${index + 1}`} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={typography.subheading}>Photo {index + 1}</Text>
                <Text style={typography.small}>{formatDateTime(capture.captured_at)}</Text>
                {hasGps ? (
                  <>
                    <Text style={typography.small}>
                      GPS accuracy: {capture.capture_accuracy_m !== null ? `±${Math.round(capture.capture_accuracy_m)} m` : 'unknown'}
                    </Text>
                    {distance !== null ? <Text style={typography.small}>About {formatDistance(distance)} from the reported location</Text> : null}
                    {tooFar || poorAccuracy ? (
                      <View style={styles.statusRow}>
                        <Ionicons name="warning" size={14} color={colors.warning} />
                        <Text style={[styles.statusText, { color: colors.warning }]}>
                          {tooFar ? `Further than ${Math.round(maxDistance)} m — likely to be flagged` : 'Weak GPS signal — likely to be flagged'}
                        </Text>
                      </View>
                    ) : null}
                  </>
                ) : (
                  <View style={styles.statusRow}>
                    <Ionicons name="warning" size={14} color={colors.warning} />
                    <Text style={[styles.statusText, { color: colors.warning, flexShrink: 1 }]}>No GPS position recorded — this photo will be flagged for review</Text>
                  </View>
                )}
              </View>
              <View>
                <IconButton icon="camera-reverse-outline" label={`Retake photo ${index + 1}`} color={colors.authority} onPress={() => openCamera(index)} />
                <IconButton icon="trash-outline" label={`Remove photo ${index + 1}`} color={colors.danger} onPress={() => removeCapture(index)} />
              </View>
            </View>
          );
        })}
        {photoError ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">
            {photoError}
          </Text>
        ) : null}
        <Button
          title={captures.length ? `Add another photo (${captures.length}/${MAX_PHOTOS})` : 'Take resolution photo'}
          icon="camera"
          variant={captures.length ? 'outline' : 'primary'}
          color={colors.authority}
          onPress={() => openCamera()}
          disabled={captures.length >= MAX_PHOTOS || busy}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      {/* Step 2: description ------------------------------------------------------------------- */}
      <SectionHeader title="2. What was done?" />
      <TextField
        label="Resolution description"
        value={description}
        onChangeText={(value) => {
          setDescription(value);
          setDescriptionError(undefined);
        }}
        placeholder="e.g. Pothole filled with cold-mix asphalt and compacted."
        multiline
        maxLength={5000}
        error={descriptionError}
        hint="Shown to the citizen when they are asked to verify the fix."
      />

      <GhostOverlayCamera
        visible={cameraOpen}
        referenceImageUrl={reportImage?.image_url ?? null}
        onClose={() => {
          setCameraOpen(false);
          setRetakeIndex(null);
        }}
        onCapture={onCapture}
      />

      <ReasonModal
        visible={overrideOpen}
        title="Override Proof-Lock check?"
        message={`This accepts ${flaggedImages.length === 1 ? 'the flagged photo' : `${flaggedImages.length} flagged photos`} and marks the issue as resolved. Only continue if you are satisfied the work was done at this location.`}
        placeholder="Why should this photo be accepted?"
        confirmLabel="Override & resolve"
        busy={busy}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={overrideAndResolve}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  complaintId: { fontSize: 13, fontWeight: '700', color: colors.authority, letterSpacing: 0.3, marginBottom: spacing.xs },
  spaced: { marginTop: spacing.md },
  reportPhoto: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  flaggedPanel: {
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.warning,
    backgroundColor: colors.warningLight,
    gap: spacing.md,
  },
  flaggedHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flaggedItem: { flexDirection: 'row', gap: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.sm },
  flaggedThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  panelText: { color: colors.text },
  panelActions: { gap: spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  captureRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  captureThumb: { width: 76, height: 76, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.md },
});

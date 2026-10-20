import Ionicons from '@expo/vector-icons/Ionicons';
import * as Crypto from 'expo-crypto';
import { Image } from 'expo-image';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toApiError, type ApiError } from '../../api/client';
import { issueApi, type NewIssueInput } from '../../api/issueApi';
import { referenceApi } from '../../api/referenceApi';
import { ImageUploader } from '../../components/ImageUploader';
import { KeyboardAwareScroll, type KeyboardAwareScrollRef } from '../../components/KeyboardAwareScroll';
import { LocationPicker, type PickedLocation } from '../../components/LocationPicker';
import { PriorityBadge } from '../../components/PriorityBadge';
import { Screen } from '../../components/Screen';
import { StatusBadge } from '../../components/StatusBadge';
import { Banner, Button, Card, ChipGroup, KeyValue, SectionHeader, TextField, type ChipOption } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import type { CitizenStackScreenProps } from '../../navigation/types';
import { offlineQueue } from '../../offline/queue';
import { useOfflineStore } from '../../store/offlineStore';
import { useReferenceStore } from '../../store/referenceStore';
import { colors, PRIORITY_STYLES, radius, spacing, TOUCH_TARGET, typography, type IconName } from '../../theme';
import type { Category, EmergencyContact, NearbyIssue, Priority } from '../../types/api';
import { formatCoordinate, formatDistance } from '../../utils/format';
import type { LocalPhoto } from '../../utils/image';

const STEPS = ['Photos', 'Location', 'Details', 'Review'] as const;
type Step = 0 | 1 | 2 | 3;

type Field =
  | 'images'
  | 'location'
  | 'category'
  | 'subcategory'
  | 'title'
  | 'description'
  | 'additional_details'
  | 'reported_urgency';
type FieldErrors = Partial<Record<Field, string>>;

/** Which step each backend / form field lives on, so errors can send the user to the right place. */
const FIELD_STEP: Record<Field, Step> = {
  images: 0,
  location: 1,
  category: 2,
  subcategory: 2,
  title: 2,
  description: 2,
  additional_details: 2,
  reported_urgency: 2,
};

const BACKEND_FIELDS: { key: string; field: Field }[] = [
  { key: 'images', field: 'images' },
  { key: 'latitude', field: 'location' },
  { key: 'longitude', field: 'location' },
  { key: 'address', field: 'location' },
  { key: 'location_accuracy_m', field: 'location' },
  { key: 'category', field: 'category' },
  { key: 'subcategory', field: 'subcategory' },
  { key: 'title', field: 'title' },
  { key: 'description', field: 'description' },
  { key: 'additional_details', field: 'additional_details' },
  { key: 'reported_urgency', field: 'reported_urgency' },
];

const URGENCY_LEVELS: Exclude<Priority, 'UNCLASSIFIED'>[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const URGENCY_OPTIONS: ChipOption<Priority>[] = URGENCY_LEVELS.map((p) => ({
  value: p,
  label: PRIORITY_STYLES[p].label,
  icon: PRIORITY_STYLES[p].icon,
  color: PRIORITY_STYLES[p].color,
}));

const TITLE_MIN = 5;
const TITLE_MAX = 150;
const DESCRIPTION_MIN = 10;
const DESCRIPTION_MAX = 5000;
const ADDITIONAL_MAX = 2000;

function categoryIcon(icon: string): IconName {
  return (icon && icon in Ionicons.glyphMap ? icon : 'help-circle-outline') as IconName;
}

function callNumber(contact: EmergencyContact) {
  Linking.openURL(`tel:${contact.phone_number}`).catch(() =>
    Alert.alert(contact.name, `We couldn't open the dialer. Please call ${contact.phone_number} directly.`),
  );
}

export function ReportIssueScreen({ navigation }: CitizenStackScreenProps<'ReportIssue'>) {
  const categories = useReferenceStore((s) => s.categories);
  const config = useReferenceStore((s) => s.config);
  const referenceLoaded = useReferenceStore((s) => s.loaded);
  const isEnabled = useReferenceStore((s) => s.isEnabled);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const maxPhotos = config?.policies.max_images_per_upload ?? 5;
  const duplicateDetection = isEnabled('duplicate_detection');
  const affectsMeToo = isEnabled('affects_me_too');
  const lifeSafetyEnabled = isEnabled('life_safety');
  const offlineQueueEnabled = isEnabled('offline_queue');

  // One idempotency key and capture time per draft; both stay stable across retries.
  const [clientSubmissionId] = useState(() => Crypto.randomUUID());
  const [draftStartedAt] = useState(() => new Date().toISOString());

  const [step, setStep] = useState<Step>(0);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [location, setLocation] = useState<PickedLocation | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [additionalDetails, setAdditionalDetails] = useState('');
  const [urgency, setUrgency] = useState<Priority | ''>('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const [referenceError, setReferenceError] = useState<ApiError | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);

  const [nearby, setNearby] = useState<NearbyIssue[]>([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [supportingId, setSupportingId] = useState<number | null>(null);

  const [lifeSafetyVisible, setLifeSafetyVisible] = useState(false);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);

  const submit = useAction();
  const support = useAction();
  const scrollRef = useRef<KeyboardAwareScrollRef>(null);
  const submittedRef = useRef(false);
  const dirtyRef = useRef(false);

  const category: Category | undefined = useMemo(() => categories.find((c) => c.id === categoryId), [categories, categoryId]);
  const subcategory = category?.subcategories.find((s) => s.id === subcategoryId);
  const isLifeThreatening = Boolean(category?.is_life_threatening && lifeSafetyEnabled);

  useEffect(() => {
    dirtyRef.current =
      photos.length > 0 || categoryId !== null || title.trim() !== '' || description.trim() !== '' || additionalDetails.trim() !== '';
  }, [photos, categoryId, title, description, additionalDetails]);

  // --- Reference data ----------------------------------------------------------------

  const loadReference = useCallback(async () => {
    setReferenceLoading(true);
    setReferenceError(null);
    try {
      await useReferenceStore.getState().load();
    } catch (error) {
      setReferenceError(toApiError(error));
    } finally {
      setReferenceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!referenceLoaded) loadReference();
  }, [referenceLoaded, loadReference]);

  // --- Leave confirmation ----------------------------------------------------------------

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (submittedRef.current || !dirtyRef.current) return;
        event.preventDefault();
        Alert.alert('Discard this report?', 'Your photos and details have not been sent and will be lost.', [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(event.data.action) },
        ]);
      }),
    [navigation],
  );

  // --- Duplicate detection ---------------------------------------------------------------

  const latitude = location?.latitude;
  const longitude = location?.longitude;

  useEffect(() => {
    if (!duplicateDetection || latitude === undefined || longitude === undefined || categoryId === null || !isOnline) {
      setNearby([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setNearbyLoading(true);
      try {
        const results = await issueApi.nearby(latitude, longitude, categoryId);
        if (!cancelled) setNearby(results);
      } catch {
        // Suggestions are a convenience only; the report can always continue without them.
        if (!cancelled) setNearby([]);
      } finally {
        if (!cancelled) setNearbyLoading(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [duplicateDetection, latitude, longitude, categoryId, isOnline]);

  // --- Life safety ----------------------------------------------------------------------

  const loadEmergencyContacts = useCallback(async (forCategory: number, lat?: number, lng?: number) => {
    setContactsLoading(true);
    setContactsError(null);
    try {
      setContacts(await referenceApi.emergencyContacts({ lat, lng, category: forCategory }));
    } catch (error) {
      setContactsError(toApiError(error).message);
    } finally {
      setContactsLoading(false);
    }
  }, []);

  function showLifeSafety(forCategory: Category) {
    setLifeSafetyVisible(true);
    loadEmergencyContacts(forCategory.id, location?.latitude, location?.longitude);
  }

  function selectCategory(next: Category) {
    const changed = next.id !== categoryId;
    setCategoryId(next.id);
    if (changed) setSubcategoryId(null);
    setErrors((e) => ({ ...e, category: undefined, subcategory: undefined }));
    if (changed && next.is_life_threatening && lifeSafetyEnabled) showLifeSafety(next);
  }

  // --- Validation & navigation between steps ------------------------------------------------

  function validateStep(target: Step): FieldErrors {
    const result: FieldErrors = {};
    if (target === 0 && photos.length === 0) result.images = 'Add at least one photo of the problem.';
    if (target === 1) {
      if (!location) result.location = 'Choose where the problem is.';
      else if (location.address.length > 255) result.location = 'Keep the address under 255 characters.';
    }
    if (target === 2) {
      if (!categoryId) result.category = 'Choose a category.';
      const t = title.trim();
      if (t.length < TITLE_MIN) result.title = `Give the issue a short title (at least ${TITLE_MIN} characters).`;
      else if (t.length > TITLE_MAX) result.title = `Keep the title under ${TITLE_MAX} characters.`;
      const d = description.trim();
      if (d.length < DESCRIPTION_MIN) result.description = `Describe the problem in at least ${DESCRIPTION_MIN} characters.`;
      else if (d.length > DESCRIPTION_MAX) result.description = `Keep the description under ${DESCRIPTION_MAX} characters.`;
      if (additionalDetails.trim().length > ADDITIONAL_MAX) result.additional_details = `Keep this under ${ADDITIONAL_MAX} characters.`;
    }
    return result;
  }

  function goTo(next: Step) {
    setStep(next);
    requestAnimationFrame(() => scrollRef.current?.scrollToPosition(0, 0, false));
  }

  function next() {
    const stepErrors = validateStep(step);
    if (Object.values(stepErrors).some(Boolean)) {
      setErrors((e) => ({ ...e, ...stepErrors }));
      return;
    }
    if (step < 3) goTo((step + 1) as Step);
  }

  function back() {
    if (step > 0) goTo((step - 1) as Step);
    else navigation.goBack();
  }

  function jumpTo(target: Step) {
    if (target < step) {
      goTo(target);
      return;
    }
    // Moving forward via the indicator still validates every step in between.
    for (let s = step; s < target; s += 1) {
      const stepErrors = validateStep(s as Step);
      if (Object.values(stepErrors).some(Boolean)) {
        setErrors((e) => ({ ...e, ...stepErrors }));
        goTo(s as Step);
        return;
      }
    }
    goTo(target);
  }

  // --- "This affects me too" from a suggestion --------------------------------------------------

  function supportExisting(issue: NearbyIssue) {
    if (!location) return;
    support.run(async () => {
      setSupportingId(issue.id);
      try {
        await issueApi.support(issue.id, location.latitude, location.longitude);
        setNearby((items) => items.map((i) => (i.id === issue.id ? { ...i, supported_by_me: true, impact_count: i.impact_count + 1 } : i)));
        Alert.alert(
          'Thanks — you have been counted',
          `We added you to ${issue.complaint_id}. More people affected helps officials prioritise it. Your own draft is kept in case you still want to send it.`,
          [{ text: 'View issue', onPress: () => navigation.push('IssueDetail', { issueId: issue.id }) }],
        );
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.code === 'already_supported') {
          setNearby((items) => items.map((i) => (i.id === issue.id ? { ...i, supported_by_me: true } : i)));
          Alert.alert('Already counted', 'You have already said this issue affects you.');
        } else if (apiError.code === 'feature_disabled') {
          Alert.alert('Not available', '"This affects me too" is turned off right now. You can still send your own report.');
        } else {
          Alert.alert("Couldn't add your support", apiError.message);
        }
      } finally {
        setSupportingId(null);
      }
    });
  }

  // --- Submit ----------------------------------------------------------------------------------

  function buildInput(): NewIssueInput | null {
    if (!location || !categoryId) return null;
    return {
      title: title.trim(),
      description: description.trim(),
      category: categoryId,
      subcategory: subcategoryId,
      latitude: Number(location.latitude.toFixed(6)),
      longitude: Number(location.longitude.toFixed(6)),
      location_accuracy_m: location.accuracy ?? null,
      address: location.address.trim(),
      additional_details: additionalDetails.trim(),
      reported_urgency: urgency,
      client_submission_id: clientSubmissionId,
      client_reported_at: draftStartedAt,
    };
  }

  async function saveOffline(input: NewIssueInput) {
    await offlineQueue.enqueue(
      input,
      photos.map((p) => p.uri),
    );
    await useOfflineStore.getState().refresh();
    submittedRef.current = true;
    navigation.replace('ReportSuccess', {
      complaintId: null,
      issueId: null,
      status: null,
      address: input.address ?? '',
      latitude: input.latitude,
      longitude: input.longitude,
      queued: true,
    });
  }

  function applyServerErrors(apiError: ApiError) {
    const fieldErrors: FieldErrors = {};
    BACKEND_FIELDS.forEach(({ key, field }) => {
      const message = apiError.fieldError(key);
      if (message && !fieldErrors[field]) fieldErrors[field] = message;
    });
    if (apiError.code === 'payload_too_large') fieldErrors.images = apiError.message;
    const fields = (Object.keys(fieldErrors) as Field[]).filter((f) => fieldErrors[f]);
    setErrors(fieldErrors);
    if (fields.length) {
      const firstStep = Math.min(...fields.map((f) => FIELD_STEP[f])) as Step;
      goTo(firstStep);
    }
    Alert.alert('Please check your report', apiError.message);
  }

  function onSubmit() {
    for (const s of [0, 1, 2] as Step[]) {
      const stepErrors = validateStep(s);
      if (Object.values(stepErrors).some(Boolean)) {
        setErrors(stepErrors);
        goTo(s);
        return;
      }
    }
    const input = buildInput();
    if (!input) return;

    submit.run(async () => {
      try {
        if (!isOnline && offlineQueueEnabled) {
          await saveOffline(input);
          return;
        }
        const issue = await issueApi.create(
          input,
          photos.map((p) => ({ uri: p.uri })),
        );
        submittedRef.current = true;
        navigation.replace('ReportSuccess', {
          complaintId: issue.complaint_id,
          issueId: issue.id,
          status: issue.status,
          address: issue.address,
          latitude: issue.latitude,
          longitude: issue.longitude,
          queued: false,
        });
      } catch (error) {
        const apiError = toApiError(error);
        if (apiError.isNetworkError && offlineQueueEnabled) {
          try {
            await saveOffline(input);
          } catch (queueError) {
            Alert.alert("Couldn't save your report", toApiError(queueError).message);
          }
          return;
        }
        if (apiError.code === 'validation_error' || apiError.code === 'payload_too_large') {
          applyServerErrors(apiError);
          return;
        }
        Alert.alert("Couldn't send your report", apiError.message);
      }
    });
  }

  // --- Rendering ----------------------------------------------------------------------------------

  const lifeSafetyBanner = isLifeThreatening ? (
    <Pressable
      onPress={() => category && showLifeSafety(category)}
      accessibilityRole="button"
      accessibilityLabel="Danger to life? Show emergency numbers"
      style={styles.lifeBanner}
    >
      <Ionicons name="warning" size={22} color={colors.textOnPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.lifeBannerTitle}>Is anyone in danger?</Text>
        <Text style={styles.lifeBannerText}>CivicEye is not an emergency service. Tap to see emergency numbers.</Text>
      </View>
      <Ionicons name="call" size={22} color={colors.textOnPrimary} />
    </Pressable>
  ) : null;

  const nearbySection =
    duplicateDetection && categoryId !== null && (nearbyLoading || nearby.length > 0) ? (
      <View style={{ marginTop: spacing.md }}>
        <SectionHeader title="Similar issues nearby" />
        {nearbyLoading ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={typography.caption}>Checking for similar reports…</Text>
          </View>
        ) : (
          <>
            <Text style={[typography.caption, { marginBottom: spacing.md }]}>
              Someone may have reported this already. If it's the same problem, say it affects you too — or continue with your own report.
            </Text>
            {nearby.map((issue) => (
              <Card key={issue.id} style={styles.nearbyCard}>
                <View style={styles.nearbyRow}>
                  {issue.thumbnail_url ? (
                    <Image source={{ uri: issue.thumbnail_url }} style={styles.nearbyThumb} contentFit="cover" />
                  ) : (
                    <View style={[styles.nearbyThumb, styles.thumbPlaceholder]}>
                      <Ionicons name="image-outline" size={22} color={colors.textSubtle} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.complaintId}>{issue.complaint_id}</Text>
                    <Text style={typography.subheading} numberOfLines={2}>
                      {issue.title}
                    </Text>
                    <Text style={typography.caption}>
                      {formatDistance(issue.distance_m)} away · {issue.impact_count} other{issue.impact_count === 1 ? '' : 's'} affected
                    </Text>
                  </View>
                </View>
                <View style={styles.badgeRow}>
                  <StatusBadge status={issue.status} size="sm" />
                  <PriorityBadge priority={issue.priority} size="sm" />
                </View>
                <View style={styles.nearbyActions}>
                  {affectsMeToo ? (
                    issue.supported_by_me ? (
                      <View style={styles.supportedTag} accessible accessibilityLabel="You said this affects you">
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text style={styles.supportedText}>You're counted</Text>
                      </View>
                    ) : (
                      <Button
                        title="This affects me too"
                        icon="people"
                        onPress={() => supportExisting(issue)}
                        loading={supportingId === issue.id}
                        disabled={support.busy && supportingId !== issue.id}
                        compact
                        style={{ flex: 1 }}
                      />
                    )
                  ) : null}
                  <Button
                    title="View"
                    icon="eye"
                    variant="outline"
                    onPress={() => navigation.push('IssueDetail', { issueId: issue.id })}
                    compact
                    style={{ flex: affectsMeToo ? 0 : 1, minWidth: 96 }}
                  />
                </View>
              </Card>
            ))}
          </>
        )}
      </View>
    ) : null;

  function renderPhotos() {
    return (
      <>
        <Text style={styles.stepTitle} accessibilityRole="header">
          Add photos
        </Text>
        <Text style={styles.stepHelp}>Clear photos help the crew find and fix the problem faster. At least one is required.</Text>
        <ImageUploader
          photos={photos}
          onChange={(next) => {
            setPhotos(next);
            if (next.length) setErrors((e) => ({ ...e, images: undefined }));
          }}
          max={maxPhotos}
          error={errors.images}
        />
      </>
    );
  }

  function renderLocation() {
    return (
      <>
        <Text style={styles.stepTitle} accessibilityRole="header">
          Where is it?
        </Text>
        <Text style={styles.stepHelp}>We use your GPS position. Move the pin if the problem is somewhere else.</Text>
        <LocationPicker
          value={location}
          onChange={(value) => {
            setLocation(value);
            setErrors((e) => ({ ...e, location: undefined }));
          }}
          error={errors.location}
        />
      </>
    );
  }

  function renderDetails() {
    if (!referenceLoaded && (referenceLoading || !referenceError)) {
      return (
        <View style={styles.inlineLoading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={typography.caption}>Loading categories…</Text>
        </View>
      );
    }
    if (!referenceLoaded && referenceError) {
      return <Banner tone="danger" title="Couldn't load categories" message={referenceError.message} action={{ label: 'Try again', onPress: loadReference }} />;
    }
    return (
      <>
        <Text style={styles.stepTitle} accessibilityRole="header">
          What's the problem?
        </Text>
        <Text style={styles.fieldLabel}>Category</Text>
        <View style={styles.categoryGrid} accessibilityRole="radiogroup">
          {categories.map((c) => {
            const active = c.id === categoryId;
            return (
              <Pressable
                key={c.id}
                onPress={() => selectCategory(c)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, checked: active }}
                accessibilityLabel={`${c.name}${c.is_life_threatening ? ', may be dangerous' : ''}`}
                accessibilityHint={c.description || undefined}
                style={[styles.categoryTile, active && styles.categoryTileActive]}
              >
                <Ionicons name={categoryIcon(c.icon)} size={26} color={active ? colors.textOnPrimary : colors.primary} />
                <Text style={[styles.categoryName, active && { color: colors.textOnPrimary }]} numberOfLines={2}>
                  {c.name}
                </Text>
                {c.is_life_threatening ? (
                  <Ionicons name="warning" size={14} color={active ? colors.textOnPrimary : colors.danger} style={styles.categoryWarn} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {errors.category ? <Text style={styles.error}>{errors.category}</Text> : null}

        {lifeSafetyBanner}

        {category && category.subcategories.length ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.fieldLabel}>
              More specifically <Text style={typography.small}>(optional)</Text>
            </Text>
            <ChipGroup
              options={category.subcategories.map((s) => ({ value: s.id, label: s.name }))}
              selected={subcategoryId === null ? [] : [subcategoryId]}
              onToggle={(id) => {
                setSubcategoryId((current) => (current === id ? null : id));
                setErrors((e) => ({ ...e, subcategory: undefined }));
              }}
            />
            {errors.subcategory ? <Text style={styles.error}>{errors.subcategory}</Text> : null}
          </View>
        ) : null}

        {nearbySection}

        <View style={{ marginTop: spacing.xl }}>
          <TextField
            label="Title"
            value={title}
            onChangeText={(value) => {
              setTitle(value);
              setErrors((e) => ({ ...e, title: undefined }));
            }}
            placeholder="e.g. Deep pothole near the bus stop"
            maxLength={TITLE_MAX}
            error={errors.title}
            hint={`${title.trim().length}/${TITLE_MAX} · at least ${TITLE_MIN} characters`}
            returnKeyType="next"
          />
          <TextField
            label="Description"
            value={description}
            onChangeText={(value) => {
              setDescription(value);
              setErrors((e) => ({ ...e, description: undefined }));
            }}
            placeholder="What is wrong, how big is it, and since when?"
            multiline
            maxLength={DESCRIPTION_MAX}
            error={errors.description}
            hint={`At least ${DESCRIPTION_MIN} characters`}
          />
          <TextField
            label="Additional details (optional)"
            value={additionalDetails}
            onChangeText={(value) => {
              setAdditionalDetails(value);
              setErrors((e) => ({ ...e, additional_details: undefined }));
            }}
            placeholder="Landmarks, best time to visit, anything else that helps"
            multiline
            maxLength={ADDITIONAL_MAX}
            error={errors.additional_details}
          />
        </View>

        <Text style={styles.fieldLabel}>
          How urgent does this feel? <Text style={typography.small}>(optional)</Text>
        </Text>
        <ChipGroup
          options={URGENCY_OPTIONS}
          selected={urgency ? [urgency] : []}
          onToggle={(value) => setUrgency((current) => (current === value ? '' : value))}
        />
        <Text style={[typography.small, { marginTop: spacing.sm }]}>
          This is only a signal to help officials. They review every report and set the final priority.
        </Text>
        {errors.reported_urgency ? <Text style={styles.error}>{errors.reported_urgency}</Text> : null}
      </>
    );
  }

  function renderReview() {
    return (
      <>
        <Text style={styles.stepTitle} accessibilityRole="header">
          Review and submit
        </Text>
        <Text style={styles.stepHelp}>Check everything is right before sending.</Text>

        {!isOnline ? (
          <Banner
            tone="warning"
            icon="cloud-offline"
            title="You're offline"
            message={
              offlineQueueEnabled
                ? 'Your report will be saved on this device and sent automatically when you are back online.'
                : 'You need an internet connection to send this report.'
            }
          />
        ) : null}

        {lifeSafetyBanner}

        <ReviewSection title="Photos" onEdit={() => goTo(0)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
            {photos.map((photo, index) => (
              <Image
                key={photo.uri}
                source={{ uri: photo.uri }}
                style={styles.reviewThumb}
                contentFit="cover"
                accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}
              />
            ))}
          </ScrollView>
        </ReviewSection>

        <ReviewSection title="Location" onEdit={() => goTo(1)}>
          {location ? (
            <>
              <Text style={typography.body}>{location.address || 'No address entered'}</Text>
              <Text style={typography.caption}>
                {formatCoordinate(location.latitude, location.longitude)}
                {location.accuracy ? ` · ±${Math.round(location.accuracy)} m` : ''}
              </Text>
            </>
          ) : (
            <Text style={styles.error}>No location chosen</Text>
          )}
        </ReviewSection>

        <ReviewSection title="Details" onEdit={() => goTo(2)}>
          <KeyValue label="Category" value={category?.name ?? '—'} icon={category ? categoryIcon(category.icon) : undefined} />
          {subcategory ? <KeyValue label="Type" value={subcategory.name} /> : null}
          <KeyValue label="Title" value={title.trim()} />
          <KeyValue label="Description" value={description.trim()} />
          {additionalDetails.trim() ? <KeyValue label="Additional details" value={additionalDetails.trim()} /> : null}
          <KeyValue label="Your urgency" value={urgency ? <PriorityBadge priority={urgency} size="sm" /> : 'Not given'} />
        </ReviewSection>

        {nearbySection}

        <Text style={[typography.small, { marginTop: spacing.lg }]}>
          Your name and contact details are only visible to the officials handling this report. Other citizens see the issue without your
          details and with an approximate location.
        </Text>
      </>
    );
  }

  const footer = (
    <View style={styles.footerRow}>
      <Button
        title={step === 0 ? 'Cancel' : 'Back'}
        variant="outline"
        icon={step === 0 ? 'close' : 'arrow-back'}
        onPress={back}
        disabled={submit.busy}
        style={{ flex: 1 }}
      />
      {step < 3 ? (
        <Button title="Next" icon="arrow-forward" onPress={next} style={{ flex: 1.4 }} />
      ) : (
        <Button
          title={!isOnline && offlineQueueEnabled ? 'Save & send later' : 'Submit report'}
          icon="send"
          onPress={onSubmit}
          loading={submit.busy}
          style={{ flex: 1.4 }}
          accessibilityHint="Sends your report to the city"
        />
      )}
    </View>
  );

  return (
    <Screen scroll={false} footer={footer}>
      <StepIndicator step={step} onSelect={jumpTo} disabled={submit.busy} />
      <KeyboardAwareScroll ref={scrollRef} contentContainerStyle={styles.content}>
        {step === 0 ? renderPhotos() : step === 1 ? renderLocation() : step === 2 ? renderDetails() : renderReview()}
      </KeyboardAwareScroll>

      <Modal visible={lifeSafetyVisible} animationType="slide" onRequestClose={() => setLifeSafetyVisible(false)}>
        <SafeAreaView style={styles.lifeModal}>
          <ScrollView contentContainerStyle={styles.lifeContent}>
            <View style={styles.lifeIcon}>
              <Ionicons name="warning" size={44} color={colors.textOnPrimary} />
            </View>
            <Text style={styles.lifeTitle} accessibilityRole="header">
              Is anyone in danger?
            </Text>
            <Text style={styles.lifeText}>CivicEye is not an emergency service. Call now if anyone is in danger.</Text>

            <View style={styles.contactList}>
              {contactsLoading ? (
                <ActivityIndicator color={colors.textOnPrimary} size="large" accessibilityLabel="Loading emergency numbers" />
              ) : contactsError ? (
                <View style={[styles.contactCard, styles.contactCardColumn]}>
                  <Text style={styles.contactName}>Couldn't load local numbers</Text>
                  <Text style={typography.caption}>{contactsError}</Text>
                  <Button
                    title="Call 112 (emergency)"
                    icon="call"
                    variant="danger"
                    onPress={() => callNumber({ id: 0, name: 'Emergency', phone_number: '112' })}
                    style={{ marginTop: spacing.sm }}
                  />
                  <Button
                    title="Try again"
                    variant="ghost"
                    icon="refresh"
                    onPress={() => category && loadEmergencyContacts(category.id, location?.latitude, location?.longitude)}
                    compact
                  />
                </View>
              ) : contacts.length ? (
                contacts.map((contact) => (
                  <View key={contact.id} style={styles.contactCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.contactName}>{contact.name}</Text>
                      <Text style={styles.contactPhone} selectable>
                        {contact.phone_number}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => callNumber(contact)}
                      accessibilityRole="button"
                      accessibilityLabel={`Call ${contact.name}, ${contact.phone_number}`}
                      style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.85 }]}
                    >
                      <Ionicons name="call" size={20} color={colors.textOnPrimary} />
                      <Text style={styles.callText}>Call</Text>
                    </Pressable>
                  </View>
                ))
              ) : (
                <View style={styles.contactCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.contactName}>Emergency</Text>
                    <Text style={styles.contactPhone}>112</Text>
                  </View>
                  <Pressable
                    onPress={() => callNumber({ id: 0, name: 'Emergency', phone_number: '112' })}
                    accessibilityRole="button"
                    accessibilityLabel="Call emergency number 112"
                    style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.85 }]}
                  >
                    <Ionicons name="call" size={20} color={colors.textOnPrimary} />
                    <Text style={styles.callText}>Call</Text>
                  </Pressable>
                </View>
              )}
            </View>

            <Text style={styles.lifeNote}>
              Once everyone is safe, you can continue your report so the problem gets fixed. Officials are alerted to reports in this category
              straight away.
            </Text>
            <Button
              title="Continue my report"
              icon="arrow-forward"
              variant="outline"
              color={colors.danger}
              onPress={() => setLifeSafetyVisible(false)}
              style={{ marginTop: spacing.lg }}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

function StepIndicator({ step, onSelect, disabled }: { step: Step; onSelect: (step: Step) => void; disabled?: boolean }) {
  return (
    <View style={styles.steps} accessibilityRole="tablist" accessibilityLabel={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
      {STEPS.map((label, index) => {
        const done = index < step;
        const current = index === step;
        return (
          <Pressable
            key={label}
            onPress={() => onSelect(index as Step)}
            disabled={disabled || current}
            accessibilityRole="tab"
            accessibilityLabel={`Step ${index + 1}, ${label}${done ? ', completed' : current ? ', current step' : ''}`}
            accessibilityState={{ selected: current, disabled: disabled || current }}
            style={styles.step}
          >
            <View style={[styles.stepCircle, done && styles.stepCircleDone, current && styles.stepCircleCurrent]}>
              {done ? (
                <Ionicons name="checkmark" size={16} color={colors.textOnPrimary} />
              ) : (
                <Text style={[styles.stepNumber, current && { color: colors.textOnPrimary }]}>{index + 1}</Text>
              )}
            </View>
            <Text style={[styles.stepLabel, (done || current) && styles.stepLabelActive]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ReviewSection({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return (
    <Card style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <Text style={typography.subheading} accessibilityRole="header">
          {title}
        </Text>
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${title.toLowerCase()}`} style={styles.editButton}>
          <Ionicons name="create-outline" size={16} color={colors.primary} />
          <Text style={styles.editText}>Edit</Text>
        </Pressable>
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  steps: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  step: { flex: 1, alignItems: 'center', minHeight: TOUCH_TARGET + 8, justifyContent: 'center' },
  stepCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepCircleDone: { backgroundColor: colors.success, borderColor: colors.success },
  stepCircleCurrent: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepNumber: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  stepLabel: { fontSize: 12, color: colors.textSubtle, marginTop: 2 },
  stepLabelActive: { color: colors.text, fontWeight: '700' },
  stepTitle: { ...typography.heading, marginBottom: spacing.xs },
  stepHelp: { ...typography.caption, marginBottom: spacing.lg },
  fieldLabel: { ...typography.subheading, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  inlineLoading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  categoryTile: {
    width: '31.5%',
    minHeight: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  categoryTileActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryName: { fontSize: 12, fontWeight: '600', color: colors.text, textAlign: 'center' },
  categoryWarn: { position: 'absolute', top: 6, right: 6 },
  lifeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    minHeight: TOUCH_TARGET,
  },
  lifeBannerTitle: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 15 },
  lifeBannerText: { color: colors.textOnPrimary, fontSize: 13 },
  nearbyCard: { marginBottom: spacing.md, padding: spacing.md },
  nearbyRow: { flexDirection: 'row', gap: spacing.md },
  nearbyThumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  thumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  complaintId: { fontSize: 12, fontWeight: '700', color: colors.primary },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  nearbyActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, alignItems: 'center' },
  supportedTag: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: TOUCH_TARGET },
  supportedText: { color: colors.success, fontWeight: '700' },
  reviewCard: { marginBottom: spacing.md },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TOUCH_TARGET, paddingHorizontal: spacing.sm },
  editText: { color: colors.primary, fontWeight: '700' },
  reviewThumb: { width: 84, height: 84, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  footerRow: { flexDirection: 'row', gap: spacing.md },
  lifeModal: { flex: 1, backgroundColor: '#7F1D1D' },
  lifeContent: { padding: spacing.xl, paddingBottom: spacing.xxl },
  lifeIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: spacing.lg,
  },
  lifeTitle: { fontSize: 26, fontWeight: '800', color: colors.textOnPrimary, textAlign: 'center', marginTop: spacing.lg },
  lifeText: { fontSize: 18, lineHeight: 25, color: colors.textOnPrimary, textAlign: 'center', marginTop: spacing.sm, fontWeight: '600' },
  contactList: { marginTop: spacing.xl, gap: spacing.md },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  contactCardColumn: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xs },
  contactName: { ...typography.subheading },
  contactPhone: { fontSize: 20, fontWeight: '700', color: colors.danger, marginTop: 2 },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    minHeight: TOUCH_TARGET + 4,
  },
  callText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 16 },
  lifeNote: { color: '#FECACA', fontSize: 14, lineHeight: 20, marginTop: spacing.xl, textAlign: 'center' },
});

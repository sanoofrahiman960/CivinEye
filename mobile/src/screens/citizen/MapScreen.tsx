import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Callout, Marker, type Region } from 'react-native-maps';

import MapView, { type MapViewInstance } from '../../components/SafeMapView';

import { toApiError, type ApiError } from '../../api/client';
import { issueApi } from '../../api/issueApi';
import { Banner, Button, ChipGroup, type ChipOption } from '../../components/ui';
import type { CitizenTabScreenProps } from '../../navigation/types';
import { useReferenceStore } from '../../store/referenceStore';
import { colors, PRIORITY_ORDER, PRIORITY_STYLES, radius, shadow, spacing, STATUS_ORDER, STATUS_STYLES, TOUCH_TARGET, typography } from '../../theme';
import type { IssueStatus, MapIssue, Priority } from '../../types/api';
import { getCurrentLocation } from '../../utils/location';

/** Kochi, used until (or if) we get a GPS fix. */
const FALLBACK_REGION: Region = { latitude: 9.9816, longitude: 76.2999, latitudeDelta: 0.06, longitudeDelta: 0.06 };
const USER_DELTA = 0.03;
const FETCH_DEBOUNCE_MS = 450;
/** The backend returns at most this many markers per request. */
const MAX_MARKERS = 300;

const PRIORITY_OPTIONS: ChipOption<Priority>[] = PRIORITY_ORDER.map((p) => ({
  value: p,
  label: PRIORITY_STYLES[p].label,
  icon: PRIORITY_STYLES[p].icon,
  color: PRIORITY_STYLES[p].color,
}));

const STATUS_OPTIONS: ChipOption<IssueStatus>[] = STATUS_ORDER.map((s) => ({
  value: s,
  label: STATUS_STYLES[s].label,
  icon: STATUS_STYLES[s].icon,
  color: STATUS_STYLES[s].color,
}));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function MapScreen({ navigation }: CitizenTabScreenProps<'Map'>) {
  const categories = useReferenceStore((s) => s.categories);
  const referenceLoaded = useReferenceStore((s) => s.loaded);
  const mapRef = useRef<MapViewInstance>(null);

  const [region, setRegion] = useState<Region>(FALLBACK_REGION);
  const [issues, setIssues] = useState<MapIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [priorities, setPriorities] = useState<Priority[]>([]);
  const [statuses, setStatuses] = useState<IssueStatus[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const requestId = useRef(0);

  useEffect(() => {
    if (!referenceLoaded) useReferenceStore.getState().load().catch(() => undefined);
  }, [referenceLoaded]);

  const centreOnUser = useCallback(async () => {
    setLocating(true);
    setLocationMessage(null);
    const result = await getCurrentLocation();
    setLocating(false);
    if (result.ok) {
      const next = { latitude: result.coords.latitude, longitude: result.coords.longitude, latitudeDelta: USER_DELTA, longitudeDelta: USER_DELTA };
      mapRef.current?.animateToRegion(next, 500);
      setRegion(next);
    } else {
      setLocationMessage(`${result.message} Showing Kochi instead.`);
    }
  }, []);

  useEffect(() => {
    centreOnUser();
  }, [centreOnUser]);

  // Fetch markers for the visible area (debounced; out-of-date responses are ignored).
  useEffect(() => {
    const timer = setTimeout(async () => {
      const id = ++requestId.current;
      setLoading(true);
      try {
        const results = await issueApi.map({
          min_lat: clamp(region.latitude - region.latitudeDelta / 2, -90, 90),
          max_lat: clamp(region.latitude + region.latitudeDelta / 2, -90, 90),
          min_lng: clamp(region.longitude - region.longitudeDelta / 2, -180, 180),
          max_lng: clamp(region.longitude + region.longitudeDelta / 2, -180, 180),
          category: categoryId ?? undefined,
          status: statuses,
          priority: priorities,
        });
        if (id !== requestId.current) return;
        setIssues(results);
        setError(null);
      } catch (err) {
        if (id !== requestId.current) return;
        setError(toApiError(err));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, FETCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [region, categoryId, statuses, priorities, reloadKey]);

  // Invalidate in-flight requests when the screen unmounts.
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const activeFilterCount = priorities.length + statuses.length + (categoryId !== null ? 1 : 0);
  const categoryOptions: ChipOption<number>[] = categories.map((c) => ({ value: c.id, label: c.name }));

  function clearFilters() {
    setPriorities([]);
    setStatuses([]);
    setCategoryId(null);
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={FALLBACK_REGION}
        onRegionChangeComplete={(next) => setRegion(next)}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        accessibilityLabel="Map of reported issues"
      >
        {issues.map((issue) => {
          const priority = PRIORITY_STYLES[issue.priority];
          const status = STATUS_STYLES[issue.status];
          return (
            <Marker
              key={issue.id}
              coordinate={{ latitude: issue.latitude, longitude: issue.longitude }}
              pinColor={priority.color}
              accessibilityLabel={`${issue.title}, ${issue.category.name}, status ${status.label}, ${priority.label} priority`}
            >
              <Callout onPress={() => navigation.navigate('IssueDetail', { issueId: issue.id })} accessibilityLabel={`Open ${issue.title}`}>
                <View style={styles.callout}>
                  <Text style={styles.calloutId}>
                    {issue.complaint_id}
                    {issue.is_mine ? ' · Your report' : ''}
                  </Text>
                  <Text style={styles.calloutTitle} numberOfLines={2}>
                    {issue.title}
                  </Text>
                  <Text style={typography.caption} numberOfLines={1}>
                    {issue.category.name}
                  </Text>
                  <Text style={styles.calloutMeta}>
                    Status: {status.label}
                    {'\n'}Priority: {priority.label}
                    {issue.impact_count > 0 ? `\n${issue.impact_count} also affected` : ''}
                  </Text>
                  <Text style={styles.calloutLink}>Tap for details ›</Text>
                </View>
              </Callout>
            </Marker>
          );
        })}
      </MapView>

      {/* Top controls */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.statusPill} accessibilityLiveRegion="polite">
          {loading ? (
            <>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.pillText}>Loading issues…</Text>
            </>
          ) : (
            <Text style={styles.pillText}>
              {issues.length >= MAX_MARKERS ? `${MAX_MARKERS}+ issues · zoom in to see all` : `${issues.length} issue${issues.length === 1 ? '' : 's'} here`}
            </Text>
          )}
        </View>
        <View style={styles.topButtons}>
          <Pressable
            onPress={() => setFiltersOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={`Filters${activeFilterCount ? `, ${activeFilterCount} active` : ''}`}
            accessibilityState={{ expanded: filtersOpen }}
            style={[styles.roundButton, filtersOpen && styles.roundButtonActive]}
          >
            <Ionicons name="options" size={22} color={filtersOpen ? colors.textOnPrimary : colors.text} />
            {activeFilterCount ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            onPress={centreOnUser}
            accessibilityRole="button"
            accessibilityLabel="Centre the map on my location"
            style={styles.roundButton}
            disabled={locating}
          >
            {locating ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={22} color={colors.text} />}
          </Pressable>
        </View>
      </View>

      {error || locationMessage ? (
        <View style={styles.banners} pointerEvents="box-none">
          {error ? (
            <Banner
              tone="danger"
              title="Couldn't load issues"
              message={error.message}
              action={{ label: 'Try again', onPress: () => setReloadKey((k) => k + 1) }}
            />
          ) : null}
          {locationMessage ? (
            <Banner tone="warning" message={locationMessage} action={{ label: 'Dismiss', onPress: () => setLocationMessage(null) }} />
          ) : null}
        </View>
      ) : null}

      {filtersOpen ? (
        <View style={styles.filterPanel}>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.sm }}>
            <Text style={styles.filterTitle} accessibilityRole="header">
              Priority
            </Text>
            <ChipGroup options={PRIORITY_OPTIONS} selected={priorities} onToggle={(p) => setPriorities((cur) => toggle(cur, p))} />
            <Text style={styles.filterTitle} accessibilityRole="header">
              Status
            </Text>
            <ChipGroup options={STATUS_OPTIONS} selected={statuses} onToggle={(s) => setStatuses((cur) => toggle(cur, s))} />
            <Text style={styles.filterTitle} accessibilityRole="header">
              Category
            </Text>
            {categoryOptions.length ? (
              <ChipGroup
                options={categoryOptions}
                selected={categoryId === null ? [] : [categoryId]}
                onToggle={(id) => setCategoryId((cur) => (cur === id ? null : id))}
              />
            ) : (
              <Text style={typography.caption}>Categories are loading…</Text>
            )}
          </ScrollView>
          <View style={styles.filterActions}>
            <Button title="Clear" variant="outline" onPress={clearFilters} disabled={!activeFilterCount} compact style={{ flex: 1 }} />
            <Button title="Done" onPress={() => setFiltersOpen(false)} compact style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}

      {/* Legend + privacy note */}
      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.legend}>
          <Pressable
            onPress={() => setLegendOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityLabel={legendOpen ? 'Hide priority legend' : 'Show priority legend'}
            accessibilityState={{ expanded: legendOpen }}
            style={styles.legendHeader}
          >
            <Text style={styles.legendTitle}>Pin colour = priority</Text>
            <Ionicons name={legendOpen ? 'chevron-down' : 'chevron-up'} size={16} color={colors.textMuted} />
          </Pressable>
          {legendOpen ? (
            <View style={styles.legendItems}>
              {PRIORITY_ORDER.map((p) => (
                <View key={p} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: PRIORITY_STYLES[p].color }]} />
                  <Ionicons name={PRIORITY_STYLES[p].icon} size={12} color={PRIORITY_STYLES[p].color} />
                  <Text style={styles.legendText}>{PRIORITY_STYLES[p].label}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View style={styles.privacy}>
            <Ionicons name="lock-closed" size={12} color={colors.textMuted} />
            <Text style={styles.privacyText}>Locations are approximate to protect privacy.</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statusPill: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    minHeight: 36,
    ...shadow,
  },
  pillText: { fontSize: 13, fontWeight: '600', color: colors.text },
  topButtons: { gap: spacing.sm },
  roundButton: {
    width: TOUCH_TARGET + 4,
    height: TOUCH_TARGET + 4,
    borderRadius: (TOUCH_TARGET + 4) / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  roundButtonActive: { backgroundColor: colors.primary },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.textOnPrimary, fontSize: 11, fontWeight: '700' },
  banners: { position: 'absolute', top: 70, left: spacing.md, right: 72 },
  filterPanel: {
    position: 'absolute',
    top: 70,
    left: spacing.md,
    right: spacing.md,
    maxHeight: '65%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadow,
    elevation: 6,
  },
  filterTitle: { ...typography.subheading, marginTop: spacing.sm, marginBottom: spacing.sm },
  filterActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  bottom: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.md },
  legend: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, paddingBottom: spacing.sm, ...shadow },
  legendHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH_TARGET },
  legendTitle: { ...typography.subheading, fontSize: 14 },
  legendItems: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  privacyText: { ...typography.small },
  callout: { width: 220, padding: spacing.xs, gap: 2 },
  calloutId: { fontSize: 11, fontWeight: '700', color: colors.primary },
  calloutTitle: { ...typography.subheading, fontSize: 14 },
  calloutMeta: { fontSize: 12, color: colors.text, marginTop: 2 },
  calloutLink: { fontSize: 12, fontWeight: '700', color: colors.primary, marginTop: 4 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authorityApi, type AuthorityIssueQuery, type AuthoritySort } from '../../api/authorityApi';
import { type ApiError, toApiError } from '../../api/client';
import { IssueCard } from '../../components/IssueCard';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Screen } from '../../components/Screen';
import { Banner, Button, ChipGroup, IconButton, type ChipOption } from '../../components/ui';
import type { AuthorityTabParamList, AuthorityTabScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { useReferenceStore } from '../../store/referenceStore';
import {
  colors,
  PRIORITY_ORDER,
  PRIORITY_STYLES,
  radius,
  spacing,
  STATUS_ORDER,
  STATUS_STYLES,
  TOUCH_TARGET,
  typography,
} from '../../theme';
import type { AuthorityIssueListItem, IssueStatus, Priority } from '../../types/api';

// --- Date range helpers (shared with the reports screen) ---------------------------------

export type DateRange = 'any' | 'today' | 'week' | 'month';

export const DATE_RANGE_OPTIONS: ChipOption<DateRange>[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
];

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** `date_from` (YYYY-MM-DD, local calendar day) for a date-range chip, or undefined for "Any time". */
export function dateFromForRange(range: DateRange, now: Date = new Date()): string | undefined {
  if (range === 'any') return undefined;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'week') start.setDate(start.getDate() - 6);
  if (range === 'month') start.setDate(start.getDate() - 29);
  return toIsoDate(start);
}

export const STATUS_FILTER_OPTIONS: ChipOption<IssueStatus>[] = STATUS_ORDER.map((status) => ({
  value: status,
  label: STATUS_STYLES[status].label,
  icon: STATUS_STYLES[status].icon,
  color: STATUS_STYLES[status].color,
}));

// --- Filters ---------------------------------------------------------------------------------

type AssignedFilter = 'any' | 'me' | 'unassigned';

interface Filters {
  status: IssueStatus[];
  priority: Priority[];
  category: number | null;
  department: number | null;
  serviceArea: number | null;
  assigned: AssignedFilter;
  dateRange: DateRange;
  overdue: boolean;
}

const EMPTY_FILTERS: Filters = {
  status: [],
  priority: [],
  category: null,
  department: null,
  serviceArea: null,
  assigned: 'any',
  dateRange: 'any',
  overdue: false,
};

type IssuesParams = AuthorityTabParamList['Issues'];

function filtersFromParams(params: IssuesParams): Filters {
  return {
    ...EMPTY_FILTERS,
    status: params?.status ? [...params.status] : [],
    priority: params?.priority ? [...params.priority] : [],
    overdue: !!params?.overdue,
  };
}

function countActiveFilters(filters: Filters): number {
  let count = 0;
  if (filters.status.length) count += 1;
  if (filters.priority.length) count += 1;
  if (filters.category !== null) count += 1;
  if (filters.department !== null) count += 1;
  if (filters.serviceArea !== null) count += 1;
  if (filters.assigned !== 'any') count += 1;
  if (filters.dateRange !== 'any') count += 1;
  if (filters.overdue) count += 1;
  return count;
}

const SORT_OPTIONS: { value: AuthoritySort; label: string; icon: ChipOption<string>['icon'] }[] = [
  { value: 'newest', label: 'Newest', icon: 'arrow-down' },
  { value: 'oldest', label: 'Oldest', icon: 'arrow-up' },
  { value: 'priority', label: 'Highest priority', icon: 'alert-circle-outline' },
  { value: 'longest_unresolved', label: 'Longest unresolved', icon: 'hourglass-outline' },
];

const ASSIGNED_OPTIONS: ChipOption<AssignedFilter>[] = [
  { value: 'any', label: 'Anyone' },
  { value: 'me', label: 'Assigned to me', icon: 'person' },
  { value: 'unassigned', label: 'Unassigned', icon: 'person-remove-outline' },
];

const PRIORITY_FILTER_OPTIONS: ChipOption<Priority>[] = PRIORITY_ORDER.map((priority) => ({
  value: priority,
  label: PRIORITY_STYLES[priority].label,
  icon: PRIORITY_STYLES[priority].icon,
  color: PRIORITY_STYLES[priority].color,
}));

/** Chip value standing for "no selection" in single-select groups (ids are always positive). */
const ANY = 0;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

// --- Screen ----------------------------------------------------------------------------------

export function AuthorityIssuesScreen({ navigation, route }: AuthorityTabScreenProps<'Issues'>) {
  const [filters, setFilters] = useState<Filters>(() => filtersFromParams(route.params));
  const [sort, setSort] = useState<AuthoritySort>('newest');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);

  const [items, setItems] = useState<AuthorityIssueListItem[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const pageRef = useRef(1);
  pageRef.current = page;
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [moreError, setMoreError] = useState<ApiError | null>(null);

  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);
  const firstFocus = useRef(true);
  const lastParams = useRef(route.params);
  const mounted = useRef(true);

  const loadReference = useReferenceStore((s) => s.load);
  useEffect(() => {
    loadReference().catch(() => undefined);
  }, [loadReference]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Filters passed from the dashboard KPIs replace the current filters.
  useEffect(() => {
    if (route.params === lastParams.current) return;
    lastParams.current = route.params;
    setFilters(filtersFromParams(route.params));
    setSearchText('');
    setSearch('');
  }, [route.params]);

  // Debounce the search box.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const query = useMemo<AuthorityIssueQuery>(
    () => ({
      status: filters.status,
      priority: filters.priority,
      category: filters.category ?? undefined,
      department: filters.department ?? undefined,
      service_area: filters.serviceArea ?? undefined,
      assigned_officer: filters.assigned === 'any' ? undefined : filters.assigned,
      date_from: dateFromForRange(filters.dateRange),
      overdue: filters.overdue || undefined,
      search: search || undefined,
      sort,
    }),
    [filters, search, sort],
  );

  const loadFirstPage = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent') => {
      const id = ++requestId.current;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setMoreError(null);
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      // A silent refresh (returning to the tab) reloads every page already shown, keeping the scroll depth.
      const pagesToLoad = mode === 'silent' ? Math.max(1, pageRef.current) : 1;
      try {
        let results: AuthorityIssueListItem[] = [];
        let total = 0;
        let next: string | null = null;
        let loaded = 0;
        for (let p = 1; p <= pagesToLoad; p += 1) {
          const result = await authorityApi.issues({ ...query, page: p });
          if (!mounted.current || id !== requestId.current) return;
          const seen = new Set(results.map((issue) => issue.id));
          results = [...results, ...result.results.filter((issue) => !seen.has(issue.id))];
          total = result.count;
          next = result.next;
          loaded = p;
          if (!result.next) break;
        }
        setItems(results);
        setCount(total);
        setPage(loaded);
        setHasMore(!!next);
        setError(null);
      } catch (err) {
        if (!mounted.current || id !== requestId.current) return;
        setError(toApiError(err));
      } finally {
        if (mounted.current && id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    loadFirstPage('initial');
  }, [loadFirstPage]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      loadFirstPage('silent');
    }, [loadFirstPage]),
  );

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || refreshing || loadingMoreRef.current) return;
    const id = requestId.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const result = await authorityApi.issues({ ...query, page: page + 1 });
      if (!mounted.current || id !== requestId.current) return;
      setItems((current) => {
        const seen = new Set(current.map((issue) => issue.id));
        return [...current, ...result.results.filter((issue) => !seen.has(issue.id))];
      });
      setCount(result.count);
      setPage(page + 1);
      setHasMore(!!result.next);
    } catch (err) {
      if (mounted.current && id === requestId.current) setMoreError(toApiError(err));
    } finally {
      if (mounted.current && id === requestId.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore, loading, refreshing, query, page]);

  const activeCount = countActiveFilters(filters);
  const hasAnyFilter = activeCount > 0 || !!search;
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Newest';

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    setSearchText('');
    setSearch('');
  }

  const openIssue = useCallback(
    (issueId: number) => navigation.navigate('AuthorityIssueDetail', { issueId }),
    [navigation],
  );

  function renderFooter() {
    if (loadingMore) {
      return (
        <View style={styles.footer} accessibilityLabel="Loading more issues">
          <ActivityIndicator color={colors.authority} />
        </View>
      );
    }
    if (moreError) {
      return (
        <View style={styles.footer}>
          <Text style={[typography.caption, styles.center]}>{moreError.message}</Text>
          <Button title="Load more" icon="refresh" variant="outline" color={colors.authority} compact onPress={loadMore} style={{ marginTop: spacing.sm }} />
        </View>
      );
    }
    if (!hasMore && items.length > 0) {
      return <Text style={[typography.small, styles.center, styles.footer]}>Showing all {count} issues</Text>;
    }
    return undefined;
  }

  return (
    <Screen scroll={false}>
      <View style={styles.toolbar}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search complaint ID, title or location"
            placeholderTextColor={colors.textSubtle}
            style={styles.searchInput}
            accessibilityLabel="Search issues by complaint ID, title or location"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            onSubmitEditing={() => setSearch(searchText.trim())}
          />
          {searchText ? (
            <IconButton icon="close-circle" label="Clear search" color={colors.textSubtle} size={18} onPress={() => setSearchText('')} />
          ) : null}
        </View>
        <View style={styles.toolbarRow}>
          <Pressable
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={activeCount ? `Filters, ${activeCount} active` : 'Filters'}
            style={({ pressed }) => [styles.toolButton, activeCount > 0 && styles.toolButtonActive, pressed && styles.pressed]}
          >
            <Ionicons name="options-outline" size={18} color={activeCount ? colors.textOnPrimary : colors.authority} />
            <Text style={[styles.toolButtonText, activeCount > 0 && { color: colors.textOnPrimary }]}>
              Filters{activeCount ? ` (${activeCount})` : ''}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSortOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Sort: ${sortLabel}. Double tap to change.`}
            style={({ pressed }) => [styles.toolButton, styles.sortButton, pressed && styles.pressed]}
          >
            <Ionicons name="swap-vertical" size={18} color={colors.authority} />
            <Text style={styles.toolButtonText} numberOfLines={1}>
              {sortLabel}
            </Text>
          </Pressable>
          {hasAnyFilter ? (
            <Pressable
              onPress={clearFilters}
              accessibilityRole="button"
              accessibilityLabel="Clear filters and search"
              style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
        {!loading && !error ? (
          <Text style={typography.small} accessibilityLiveRegion="polite">
            {count} issue{count === 1 ? '' : 's'}
            {hasAnyFilter ? ' match your filters' : ''}
          </Text>
        ) : null}
      </View>

      {loading && !items.length ? (
        <LoadingState message="Loading issues…" />
      ) : error && !items.length ? (
        <ErrorState error={error} onRetry={() => loadFirstPage('initial')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(issue) => String(issue.id)}
          renderItem={({ item }) => <IssueCard issue={item} showAssignment onPress={() => openIssue(item.id)} />}
          contentContainerStyle={styles.list}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFirstPage('refresh')} tintColor={colors.authority} colors={[colors.authority]} />}
          ListHeaderComponent={
            error ? <Banner tone="danger" title="Couldn't refresh" message={error.message} action={{ label: 'Try again', onPress: () => loadFirstPage('initial') }} /> : undefined
          }
          ListEmptyComponent={
            hasAnyFilter ? (
              <EmptyState
                icon="filter-outline"
                title="No matching issues"
                message="No issues match these filters. Try widening the search."
                action={{ label: 'Clear filters', onPress: clearFilters }}
              />
            ) : (
              <EmptyState icon="checkmark-done-outline" title="No issues yet" message="Issues for your department will appear here." />
            )
          }
          ListFooterComponent={renderFooter()}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        />
      )}

      <FilterSheet
        visible={filterOpen}
        initial={filters}
        onClose={() => setFilterOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFilterOpen(false);
        }}
      />

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSortOpen(false)} accessibilityRole="button" accessibilityLabel="Close sort options" />
          <View style={styles.sortSheet} accessibilityViewIsModal>
            <Text style={typography.heading} accessibilityRole="header">
              Sort issues
            </Text>
            {SORT_OPTIONS.map((option) => {
              const selected = option.value === sort;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    setSort(option.value);
                    setSortOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={option.label}
                  style={({ pressed }) => [styles.sortOption, pressed && styles.pressed]}
                >
                  <Ionicons name={option.icon ?? 'ellipse-outline'} size={20} color={colors.authority} />
                  <Text style={[typography.body, { flex: 1 }]}>{option.label}</Text>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.authority : colors.borderStrong} />
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// --- Filter sheet ----------------------------------------------------------------------------

function FilterSheet({ visible, initial, onClose, onApply }: { visible: boolean; initial: Filters; onClose: () => void; onApply: (filters: Filters) => void }) {
  const user = useAuthStore((s) => s.user);
  const categories = useReferenceStore((s) => s.categories);
  const departments = useReferenceStore((s) => s.departments);
  const [draft, setDraft] = useState<Filters>(initial);

  useEffect(() => {
    if (visible) setDraft(initial);
  }, [visible, initial]);

  const categoryOptions: ChipOption<number>[] = [{ value: ANY, label: 'All categories' }, ...categories.map((c) => ({ value: c.id, label: c.name }))];
  const departmentOptions: ChipOption<number>[] = [{ value: ANY, label: 'All departments' }, ...departments.map((d) => ({ value: d.id, label: d.name }))];

  const areaDepartmentId = draft.department ?? user?.department?.id ?? null;
  const serviceAreas = departments.find((d) => d.id === areaDepartmentId)?.service_areas ?? [];
  const areaOptions: ChipOption<number>[] = [{ value: ANY, label: 'All areas' }, ...serviceAreas.map((a) => ({ value: a.id, label: a.name }))];

  const update = (patch: Partial<Filters>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.sheetHeader}>
          <IconButton icon="close" label="Close filters" onPress={onClose} />
          <Text style={typography.heading} accessibilityRole="header">
            Filter issues
          </Text>
          <Pressable onPress={() => setDraft(EMPTY_FILTERS)} accessibilityRole="button" accessibilityLabel="Reset all filters" style={styles.resetButton}>
            <Text style={styles.clearText}>Reset</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.sheetContent}>
          <FilterSection title="Status" hint="Select one or more">
            <ChipGroup options={STATUS_FILTER_OPTIONS} selected={draft.status} onToggle={(value) => update({ status: toggle(draft.status, value) })} />
          </FilterSection>

          <FilterSection title="Priority" hint="Select one or more">
            <ChipGroup options={PRIORITY_FILTER_OPTIONS} selected={draft.priority} onToggle={(value) => update({ priority: toggle(draft.priority, value) })} />
          </FilterSection>

          <FilterSection title="Category">
            <ChipGroup
              options={categoryOptions}
              selected={[draft.category ?? ANY]}
              onToggle={(value) => update({ category: value === ANY || value === draft.category ? null : value })}
            />
          </FilterSection>

          {departments.length ? (
            <FilterSection title="Department">
              <ChipGroup
                options={departmentOptions}
                selected={[draft.department ?? ANY]}
                onToggle={(value) => update({ department: value === ANY || value === draft.department ? null : value, serviceArea: null })}
              />
            </FilterSection>
          ) : null}

          {serviceAreas.length ? (
            <FilterSection title="Service area" hint="Optional">
              <ChipGroup
                options={areaOptions}
                selected={[draft.serviceArea ?? ANY]}
                onToggle={(value) => update({ serviceArea: value === ANY || value === draft.serviceArea ? null : value })}
              />
            </FilterSection>
          ) : null}

          <FilterSection title="Assigned officer">
            <ChipGroup options={ASSIGNED_OPTIONS} selected={[draft.assigned]} onToggle={(value) => update({ assigned: value })} />
          </FilterSection>

          <FilterSection title="Reported">
            <ChipGroup options={DATE_RANGE_OPTIONS} selected={[draft.dateRange]} onToggle={(value) => update({ dateRange: value })} />
          </FilterSection>

          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={typography.subheading}>Overdue only</Text>
              <Text style={typography.small}>Issues past their acknowledgement or resolution deadline</Text>
            </View>
            <Switch
              value={draft.overdue}
              onValueChange={(value) => update({ overdue: value })}
              accessibilityLabel="Show overdue issues only"
              trackColor={{ true: colors.authority, false: colors.borderStrong }}
            />
          </View>
        </ScrollView>

        <View style={styles.sheetFooter}>
          <Button title="Cancel" variant="outline" color={colors.authority} onPress={onClose} style={{ flex: 1 }} />
          <Button
            title={countActiveFilters(draft) ? `Apply (${countActiveFilters(draft)})` : 'Apply'}
            color={colors.authority}
            icon="checkmark"
            onPress={() => onApply(draft)}
            style={{ flex: 1 }}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function FilterSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={typography.subheading} accessibilityRole="header">
        {title}
        {hint ? <Text style={typography.small}>{`  ${hint}`}</Text> : null}
      </Text>
      <View style={{ marginTop: spacing.sm }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: TOUCH_TARGET + 4,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, minHeight: TOUCH_TARGET, paddingRight: spacing.sm },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.authority,
    backgroundColor: colors.surface,
  },
  toolButtonActive: { backgroundColor: colors.authority },
  toolButtonText: { fontSize: 14, fontWeight: '600', color: colors.authority },
  sortButton: { flexShrink: 1 },
  clearButton: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm, marginLeft: 'auto' },
  clearText: { color: colors.authority, fontWeight: '700', fontSize: 15 },
  pressed: { opacity: 0.7 },
  list: { padding: spacing.lg, paddingTop: spacing.sm, flexGrow: 1 },
  footer: { paddingVertical: spacing.lg, alignItems: 'center' },
  center: { textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sortSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.xs,
  },
  sortOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET + 4 },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  resetButton: { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.sm },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.xl },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    minHeight: TOUCH_TARGET + 12,
  },
  sheetFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});

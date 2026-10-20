import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { toApiError, type ApiError } from '../../api/client';
import { issueApi, type MyIssuesSort } from '../../api/issueApi';
import { IssueCard } from '../../components/IssueCard';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Banner, ChipGroup, IconButton, type ChipOption } from '../../components/ui';
import type { CitizenTabScreenProps } from '../../navigation/types';
import { colors, radius, spacing, STATUS_STYLES, TOUCH_TARGET, typography } from '../../theme';
import type { IssueListItem, IssueStatus } from '../../types/api';

type FilterValue = IssueStatus | 'ALL';

const FILTER_OPTIONS: ChipOption<FilterValue>[] = [
  { value: 'ALL', label: 'All' },
  { value: 'SUBMITTED', label: 'Submitted', icon: STATUS_STYLES.SUBMITTED.icon, color: STATUS_STYLES.SUBMITTED.color },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged', icon: STATUS_STYLES.ACKNOWLEDGED.icon, color: STATUS_STYLES.ACKNOWLEDGED.color },
  { value: 'IN_PROGRESS', label: 'In Progress', icon: STATUS_STYLES.IN_PROGRESS.icon, color: STATUS_STYLES.IN_PROGRESS.color },
  {
    value: 'RESOLVED',
    label: 'Resolved — Awaiting Citizen Confirmation',
    icon: STATUS_STYLES.RESOLVED.icon,
    color: STATUS_STYLES.RESOLVED.color,
  },
  { value: 'CLOSED', label: 'Closed', icon: STATUS_STYLES.CLOSED.icon, color: STATUS_STYLES.CLOSED.color },
  { value: 'REOPENED', label: 'Reopened', icon: STATUS_STYLES.REOPENED.icon, color: STATUS_STYLES.REOPENED.color },
];

const SORT_OPTIONS: { value: MyIssuesSort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Recently updated' },
];

const SEARCH_DEBOUNCE_MS = 400;

/** Page number from DRF's `next` URL (falls back to the following page). */
function pageFromNext(next: string | null, current: number): number | null {
  if (!next) return null;
  const match = /[?&]page=(\d+)/.exec(next);
  return match ? Number(match[1]) : current + 1;
}

export function MyIssuesScreen({ navigation, route }: CitizenTabScreenProps<'MyIssues'>) {
  const paramStatus = route.params?.status;
  const [filter, setFilter] = useState<IssueStatus[]>(paramStatus ?? []);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sort, setSort] = useState<MyIssuesSort>('newest');
  const [sortOpen, setSortOpen] = useState(false);

  const [items, setItems] = useState<IssueListItem[]>([]);
  const [count, setCount] = useState(0);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [moreError, setMoreError] = useState<string | null>(null);

  const requestId = useRef(0);
  const mounted = useRef(true);
  const firstFocus = useRef(true);
  const hasData = useRef(false);

  // Follow filter changes requested by other screens (e.g. the Home count cards).
  useEffect(() => {
    if (paramStatus) setFilter(paramStatus);
  }, [paramStatus]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'update' | 'silent') => {
      const id = ++requestId.current;
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'update') setUpdating(true);
      setMoreError(null);
      try {
        const page = await issueApi.myIssues({ status: filter, search: debouncedSearch, sort, page: 1 });
        if (!mounted.current || id !== requestId.current) return;
        setItems(page.results);
        setCount(page.count);
        setNextPage(pageFromNext(page.next, 1));
        setError(null);
        hasData.current = true;
      } catch (err) {
        if (!mounted.current || id !== requestId.current) return;
        setError(toApiError(err));
      } finally {
        if (mounted.current && id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
          setUpdating(false);
        }
      }
    },
    [filter, debouncedSearch, sort],
  );

  useEffect(() => {
    load(hasData.current ? 'update' : 'initial');
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      load('silent');
    }, [load]),
  );

  async function loadMore() {
    if (nextPage === null || loadingMore || loading || refreshing) return;
    const id = requestId.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await issueApi.myIssues({ status: filter, search: debouncedSearch, sort, page: nextPage });
      if (!mounted.current || id !== requestId.current) return;
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id));
        return [...current, ...page.results.filter((i) => !seen.has(i.id))];
      });
      setCount(page.count);
      setNextPage(pageFromNext(page.next, nextPage));
    } catch (err) {
      if (mounted.current && id === requestId.current) setMoreError(toApiError(err).message);
    } finally {
      if (mounted.current) setLoadingMore(false);
    }
  }

  function toggleFilter(value: FilterValue) {
    if (value === 'ALL') {
      setFilter([]);
      return;
    }
    setFilter((current) => (current.includes(value) ? current.filter((s) => s !== value) : [...current, value]));
  }

  const sortLabel = SORT_OPTIONS.find((o) => o.value === sort)?.label ?? 'Newest';
  const filtered = filter.length > 0 || debouncedSearch.length > 0;

  const header = (
    <View style={styles.header}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by complaint ID, title or location"
          placeholderTextColor={colors.textSubtle}
          style={styles.searchInput}
          accessibilityLabel="Search your issues"
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="never"
        />
        {search ? <IconButton icon="close-circle" label="Clear search" color={colors.textSubtle} onPress={() => setSearch('')} /> : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
        <ChipGroup options={FILTER_OPTIONS} selected={filter.length ? filter : ['ALL']} onToggle={toggleFilter} scrollable />
      </ScrollView>

      <View style={styles.toolbar}>
        <View style={styles.countRow}>
          <Text style={typography.caption} accessibilityLiveRegion="polite">
            {loading || updating ? 'Loading…' : `${count} issue${count === 1 ? '' : 's'}`}
          </Text>
          {updating ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        <Pressable
          onPress={() => setSortOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Sort: ${sortLabel}. Change sort order`}
          style={styles.sortButton}
        >
          <Ionicons name="swap-vertical" size={16} color={colors.primary} />
          <Text style={styles.sortText}>{sortLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );

  let body;
  if (loading && !hasData.current) {
    body = <LoadingState message="Loading your issues…" />;
  } else if (error && items.length === 0) {
    body = <ErrorState error={error} onRetry={() => load('initial')} />;
  } else {
    body = (
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <IssueCard issue={item} onPress={() => navigation.navigate('IssueDetail', { issueId: item.id })} />}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.primary} />}
        ListHeaderComponent={
          error ? <Banner tone="danger" message={error.message} action={{ label: 'Try again', onPress: () => load('refresh') }} /> : undefined
        }
        ListEmptyComponent={
          filtered ? (
            <EmptyState
              icon="search-outline"
              title="No matching issues"
              message="Try a different search or clear the filters."
              action={{
                label: 'Clear filters',
                onPress: () => {
                  setFilter([]);
                  setSearch('');
                },
              }}
            />
          ) : (
            <EmptyState
              icon="document-text-outline"
              title="You haven't reported anything yet"
              message="Spotted a pothole, broken streetlight or overflowing bin? Report it in a minute."
              action={{ label: 'Report an issue', onPress: () => navigation.navigate('ReportIssue') }}
            />
          )
        }
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} accessibilityLabel="Loading more issues" />
          ) : moreError ? (
            <Banner tone="danger" message={moreError} action={{ label: 'Try again', onPress: loadMore }} />
          ) : undefined
        }
      />
    );
  }

  return (
    <View style={styles.container}>
      {header}
      {body}

      <Modal visible={sortOpen} transparent animationType="fade" onRequestClose={() => setSortOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSortOpen(false)} accessibilityRole="button" accessibilityLabel="Close sort options">
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <Pressable accessible={false}>
              <Text style={[typography.heading, { marginBottom: spacing.sm }]} accessibilityRole="header">
                Sort by
              </Text>
              {SORT_OPTIONS.map((option) => {
                const active = option.value === sort;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      setSort(option.value);
                      setSortOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active, checked: active }}
                    accessibilityLabel={option.label}
                    style={styles.sortOption}
                  >
                    <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? colors.primary : colors.textMuted} />
                    <Text style={[typography.body, active && { fontWeight: '700' }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </Pressable>
          </SafeAreaView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingTop: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    paddingLeft: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    minHeight: TOUCH_TARGET + 4,
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.text, minHeight: TOUCH_TARGET, paddingRight: spacing.md },
  chipsRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: TOUCH_TARGET, paddingHorizontal: spacing.sm },
  sortText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.xl,
  },
  sortOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: TOUCH_TARGET + 4 },
});

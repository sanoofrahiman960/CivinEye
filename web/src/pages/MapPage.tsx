import { Filter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { authorityApi, type IssueQuery } from '../api/endpoints';
import { IssueFilters } from '../components/IssueFilters';
import { IssueMap, PriorityLegend } from '../components/IssueMap';
import { Banner, Button, Card, ErrorState, PageHeader } from '../components/ui';
import { useApi, useDocumentTitle } from '../hooks/useApi';
import { countActiveFilters, paramsFromQuery, queryFromParams } from '../lib/issueQuery';
import type { AuthorityIssueListItem } from '../types/api';

const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const ACTIVE: IssueQuery['status'] = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REOPENED'];

/** Load up to MAX_PAGES × PAGE_SIZE issues for the map. */
async function loadPoints(query: IssueQuery) {
  const results: AuthorityIssueListItem[] = [];
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const data = await authorityApi.issues({ ...query, page, page_size: PAGE_SIZE, sort: 'priority' });
    total = data.count;
    results.push(...data.results);
    if (!data.next) break;
  }
  return { results, total };
}

export function MapPage() {
  useDocumentTitle('Map');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [showFilters, setShowFilters] = useState(false);
  // Default to open (unresolved) issues so the map shows what still needs work.
  const query = useMemo(() => {
    const q = queryFromParams(params);
    return params.has('status') ? q : { ...q, status: ACTIVE };
  }, [params]);
  const { data, error, loading, reload } = useApi(() => loadPoints(query), [params.toString()]);

  const points = useMemo(
    () =>
      (data?.results ?? []).map((i) => ({
        id: i.id,
        latitude: i.latitude,
        longitude: i.longitude,
        priority: i.priority,
        status: i.status,
        title: i.title,
        complaint_id: i.complaint_id,
        is_overdue: i.is_overdue,
      })),
    [data],
  );

  return (
    <>
      <PageHeader
        title="Issue map"
        subtitle={data ? `${data.results.length} of ${data.total} issue${data.total === 1 ? '' : 's'} shown` : loading ? 'Loading…' : undefined}
        actions={
          <Button variant="outline" icon={Filter} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            Filters{countActiveFilters(query) ? ` (${countActiveFilters(query)})` : ''}
          </Button>
        }
      />
      {showFilters ? (
        <Card>
          <IssueFilters query={query} onChange={(next) => setParams(paramsFromQuery({ ...next, page: undefined }))} />
        </Card>
      ) : null}
      {data && data.total > data.results.length ? (
        <Banner tone="info">Showing the {data.results.length} highest-priority issues. Narrow the filters to see the rest.</Banner>
      ) : null}
      <div style={{ margin: '12px 0' }}>
        <PriorityLegend />
      </div>
      {error && !data ? <ErrorState error={error} onRetry={reload} /> : <IssueMap points={points} className="map map-full" onOpen={(id) => navigate(`/issues/${id}`)} />}
    </>
  );
}

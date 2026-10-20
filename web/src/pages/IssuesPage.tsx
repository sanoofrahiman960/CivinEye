import { ChevronLeft, ChevronRight, Download, Filter, ImageOff, Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { authorityApi, type AuthoritySort, type IssueQuery } from '../api/endpoints';
import { ImpactBadge, OverdueBadge, PriorityBadge, StatusBadge } from '../components/badges';
import { IssueFilters, SearchBox } from '../components/IssueFilters';
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { useApi, useDocumentTitle } from '../hooks/useApi';
import { formatDate, formatDue } from '../lib/format';
import { countActiveFilters, paramsFromQuery, queryFromParams } from '../lib/issueQuery';

const PAGE_SIZE = 20;

const SORTS: { value: AuthoritySort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'priority', label: 'Highest priority' },
  { value: 'longest_unresolved', label: 'Longest unresolved' },
];

export function IssuesPage() {
  useDocumentTitle('Issues');
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = useMemo(() => queryFromParams(params), [params]);
  const [showFilters, setShowFilters] = useState(countActiveFilters(query) > 0);
  const page = query.page ?? 1;

  const key = params.toString();
  const { data, error, loading, reload } = useApi(() => authorityApi.issues({ ...query, page_size: PAGE_SIZE }), [key]);

  const setQuery = (next: IssueQuery) => setParams(paramsFromQuery(next));
  const totalPages = data ? Math.max(1, Math.ceil(data.count / PAGE_SIZE)) : 1;
  const active = countActiveFilters(query);

  return (
    <>
      <PageHeader
        title="Issues"
        subtitle={data ? `${data.count} issue${data.count === 1 ? '' : 's'} in your scope${active ? ' match these filters' : ''}` : 'Complaints you are authorised to manage'}
        actions={
          <>
            <Button variant="outline" icon={Filter} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              Filters{active ? ` (${active})` : ''}
            </Button>
            <Link className="btn btn-outline" to={`/reports?${paramsFromQuery({ ...query, page: undefined }).toString()}`}>
              <Download size={16} aria-hidden /> Export
            </Link>
          </>
        }
      />

      <div style={{ maxWidth: 520, marginBottom: 12 }}>
        <SearchBox value={query.search} onChange={(search) => setQuery({ ...query, search, page: undefined })} />
      </div>
      {showFilters ? (
        <Card>
          <IssueFilters query={query} onChange={setQuery} />
        </Card>
      ) : null}

      <div className="row-between" style={{ margin: '16px 0 10px' }}>
        <div className="subtle">{data && data.count ? `Page ${page} of ${totalPages}` : ''}</div>
        <label className="row" style={{ gap: 8 }}>
          <span className="subtle">Sort</span>
          <select className="select" style={{ width: 200 }} value={query.sort ?? 'newest'} onChange={(e) => setQuery({ ...query, sort: e.target.value as AuthoritySort, page: undefined })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="card">
        {loading && !data ? (
          <LoadingState message="Loading issues…" />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.results.length ? (
          <EmptyState icon={Inbox} title="No issues found" message={active || query.search ? 'Try clearing some filters.' : 'New complaints for your department will appear here.'} />
        ) : (
          <>
            <div className="table-wrap" aria-busy={loading}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Photo</th>
                    <th scope="col">Complaint</th>
                    <th scope="col">Location</th>
                    <th scope="col">Reported</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assigned</th>
                    <th scope="col">Open / SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {data.results.map((issue) => (
                    <tr
                      key={issue.id}
                      className={issue.is_overdue ? 'overdue' : undefined}
                      onClick={() => navigate(`/issues/${issue.id}`)}
                    >
                      <td>
                        {issue.thumbnail_url ? (
                          <img className="thumb" src={issue.thumbnail_url} alt="" loading="lazy" />
                        ) : (
                          <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
                            <ImageOff size={18} aria-hidden />
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: 240 }}>
                        <Link to={`/issues/${issue.id}`} className="mono" style={{ fontWeight: 700 }} onClick={(e) => e.stopPropagation()}>
                          {issue.complaint_id}
                        </Link>
                        <div style={{ fontWeight: 600 }}>{issue.title}</div>
                        <div className="subtle">{issue.category.name}</div>
                      </td>
                      <td style={{ maxWidth: 220 }}>
                        <div>{issue.address || '—'}</div>
                        {issue.service_area_name ? <div className="subtle">{issue.service_area_name}</div> : null}
                      </td>
                      <td>{formatDate(issue.created_at)}</td>
                      <td>
                        <div className="row">
                          <PriorityBadge priority={issue.priority} />
                          <ImpactBadge count={issue.impact_count} />
                        </div>
                      </td>
                      <td>
                        <div className="row">
                          <StatusBadge status={issue.status} />
                          {issue.is_overdue ? <OverdueBadge /> : null}
                        </div>
                      </td>
                      <td>
                        <div>{issue.department?.name ?? 'Unassigned'}</div>
                        <div className="subtle">{issue.assigned_officer?.full_name ?? 'No officer'}</div>
                      </td>
                      <td>
                        <div>
                          {issue.days_open} day{issue.days_open === 1 ? '' : 's'}
                        </div>
                        {issue.status !== 'CLOSED' && issue.status !== 'RESOLVED' ? (
                          <div className="subtle" style={issue.is_overdue ? { color: 'var(--c-danger)', fontWeight: 600 } : undefined}>
                            {formatDue(issue.due_at)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="pagination" aria-label="Pagination">
              <Button variant="outline" size="sm" icon={ChevronLeft} disabled={!data.previous} onClick={() => setQuery({ ...query, page: page - 1 })}>
                Previous
              </Button>
              <span className="subtle">
                Showing {(page - 1) * PAGE_SIZE + 1}–{(page - 1) * PAGE_SIZE + data.results.length} of {data.count}
              </span>
              <Button variant="outline" size="sm" disabled={!data.next} onClick={() => setQuery({ ...query, page: page + 1 })}>
                Next <ChevronRight size={16} aria-hidden />
              </Button>
            </nav>
          </>
        )}
      </section>
    </>
  );
}

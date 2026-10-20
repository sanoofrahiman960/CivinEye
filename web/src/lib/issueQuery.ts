import type { AuthoritySort, IssueQuery } from '../api/endpoints';
import type { IssueStatus, Priority } from '../types/api';
import { PRIORITY_ORDER, STATUS_ORDER } from './styles';

/**
 * Issue filters live in the URL (e.g. /issues?status=SUBMITTED,REOPENED&overdue=true) so views can be
 * bookmarked, shared and linked from dashboard KPIs.
 */
export function queryFromParams(params: URLSearchParams): IssueQuery {
  const list = <T extends string>(key: string, allowed: readonly T[]) =>
    (params.get(key) ?? '').split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
  const int = (key: string) => {
    const value = Number(params.get(key));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };
  const officer = params.get('assigned_officer');
  const sort = params.get('sort') as AuthoritySort | null;
  return {
    status: list<IssueStatus>('status', STATUS_ORDER),
    priority: list<Priority>('priority', PRIORITY_ORDER),
    category: int('category'),
    department: int('department'),
    service_area: int('service_area'),
    assigned_officer: officer === 'me' || officer === 'unassigned' ? officer : int('assigned_officer'),
    date_from: params.get('date_from') ?? undefined,
    date_to: params.get('date_to') ?? undefined,
    overdue: params.get('overdue') === 'true',
    search: params.get('search') ?? undefined,
    sort: sort && ['newest', 'oldest', 'priority', 'longest_unresolved'].includes(sort) ? sort : undefined,
    page: int('page'),
  };
}

export function paramsFromQuery(query: IssueQuery): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined | false | null) => {
    if (value !== undefined && value !== null && value !== false && value !== '') params.set(key, String(value));
  };
  set('status', query.status?.join(','));
  set('priority', query.priority?.join(','));
  set('category', query.category);
  set('department', query.department);
  set('service_area', query.service_area);
  set('assigned_officer', query.assigned_officer);
  set('date_from', query.date_from);
  set('date_to', query.date_to);
  set('overdue', query.overdue ? 'true' : undefined);
  set('search', query.search);
  set('sort', query.sort);
  set('page', query.page && query.page > 1 ? query.page : undefined);
  return params;
}

/** `/issues?…` link for a filter. */
export function issuesLink(query: IssueQuery): string {
  const params = paramsFromQuery(query).toString();
  return params ? `/issues?${params}` : '/issues';
}

export function countActiveFilters(query: IssueQuery): number {
  return [
    query.status?.length,
    query.priority?.length,
    query.category,
    query.department,
    query.service_area,
    query.assigned_officer,
    query.date_from || query.date_to,
    query.overdue,
  ].filter(Boolean).length;
}

/** ISO date (YYYY-MM-DD) `days` ago, in local time. */
export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

import { describe, expect, it } from 'vitest';

import { countActiveFilters, issuesLink, paramsFromQuery, queryFromParams } from '../lib/issueQuery';

describe('issue filters in the URL', () => {
  it('round-trips a query through URL params', () => {
    const query = {
      status: ['SUBMITTED' as const, 'REOPENED' as const],
      priority: ['CRITICAL' as const],
      category: 3,
      assigned_officer: 'unassigned' as const,
      overdue: true,
      search: 'CE-2026',
      sort: 'priority' as const,
      page: 2,
    };
    const parsed = queryFromParams(paramsFromQuery(query));
    expect(parsed).toMatchObject(query);
  });

  it('ignores unknown or malformed values', () => {
    const parsed = queryFromParams(new URLSearchParams('status=SUBMITTED,HACKED&priority=URGENT&category=abc&sort=evil&page=-1'));
    expect(parsed.status).toEqual(['SUBMITTED']);
    expect(parsed.priority).toEqual([]);
    expect(parsed.category).toBeUndefined();
    expect(parsed.sort).toBeUndefined();
    expect(parsed.page).toBeUndefined();
  });

  it('builds dashboard deep links', () => {
    expect(issuesLink({})).toBe('/issues');
    expect(issuesLink({ overdue: true })).toBe('/issues?overdue=true');
    expect(issuesLink({ status: ['IN_PROGRESS'] })).toBe('/issues?status=IN_PROGRESS');
  });

  it('counts active filters but not search or sort', () => {
    expect(countActiveFilters({ search: 'x', sort: 'oldest' })).toBe(0);
    expect(countActiveFilters({ status: ['CLOSED'], overdue: true, date_from: '2026-10-01' })).toBe(3);
  });
});

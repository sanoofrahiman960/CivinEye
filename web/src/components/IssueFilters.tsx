import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { IssueQuery } from '../api/endpoints';
import { useDebounced } from '../hooks/useApi';
import { countActiveFilters, daysAgo } from '../lib/issueQuery';
import { PRIORITY_ORDER, PRIORITY_STYLES, STATUS_ORDER, STATUS_STYLES } from '../lib/styles';
import { useAuthStore } from '../store/auth';
import { useReferenceStore } from '../store/reference';
import { Button, ChipGroup, Select, TextInput } from './ui';

interface IssueFiltersProps {
  query: IssueQuery;
  onChange: (next: IssueQuery) => void;
}

/** Debounced search box for complaint ID, title or location. */
export function SearchBox({ value, onChange }: { value: string | undefined; onChange: (value: string | undefined) => void }) {
  const [text, setText] = useState(value ?? '');
  const debounced = useDebounced(text);

  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if ((debounced || undefined) !== (value || undefined)) onChange(debounced || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="search">
      <Search size={16} aria-hidden />
      <input
        className="input"
        type="search"
        placeholder="Search complaint ID, title or location"
        aria-label="Search issues"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </div>
  );
}

const toggle = <T,>(list: T[] | undefined, value: T) => (list?.includes(value) ? list.filter((v) => v !== value) : [...(list ?? []), value]);

/** Shared filter panel for the issue list, map and reports. Changing a filter resets to page 1. */
export function IssueFilters({ query, onChange }: IssueFiltersProps) {
  const user = useAuthStore((s) => s.user);
  const categories = useReferenceStore((s) => s.categories);
  const departments = useReferenceStore((s) => s.departments);
  const serviceAreas = useReferenceStore((s) => s.serviceAreas);
  function update(changes: Partial<IssueQuery>) {
    onChange({ ...query, ...changes, page: undefined });
  }

  const dateRange = query.date_from === daysAgo(0) ? 'today' : query.date_from === daysAgo(7) ? '7' : query.date_from === daysAgo(30) ? '30' : query.date_from ? 'custom' : 'any';
  const active = countActiveFilters(query);
  const canPickDepartment = user?.role !== 'OFFICER';

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div>
        <div className="subtle" style={{ marginBottom: 6 }}>Status</div>
        <ChipGroup
          label="Status"
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_STYLES[s].label }))}
          selected={query.status ?? []}
          onToggle={(value) => update({ status: toggle(query.status, value) })}
        />
      </div>
      <div>
        <div className="subtle" style={{ marginBottom: 6 }}>Priority</div>
        <ChipGroup
          label="Priority"
          options={PRIORITY_ORDER.map((p) => ({ value: p, label: PRIORITY_STYLES[p].label }))}
          selected={query.priority ?? []}
          onToggle={(value) => update({ priority: toggle(query.priority, value) })}
        />
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
        <Select label="Category" value={query.category ?? ''} onChange={(e) => update({ category: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {canPickDepartment ? (
          <Select label="Department" value={query.department ?? ''} onChange={(e) => update({ department: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        ) : null}
        <Select label="Area" value={query.service_area ?? ''} onChange={(e) => update({ service_area: e.target.value ? Number(e.target.value) : undefined })}>
          <option value="">All areas</option>
          {serviceAreas.map((a) => (
            <option key={a.id} value={a.id}>
              {'\u00a0\u00a0'.repeat(a.depth)}
              {a.name} ({a.level_label})
            </option>
          ))}
        </Select>
        <Select
          label="Assigned officer"
          value={query.assigned_officer ?? ''}
          onChange={(e) => update({ assigned_officer: (e.target.value || undefined) as IssueQuery['assigned_officer'] })}
        >
          <option value="">Anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
        </Select>
        <Select
          label="Reported"
          value={dateRange === 'custom' ? 'any' : dateRange}
          onChange={(e) => {
            const value = e.target.value;
            update({ date_from: value === 'any' ? undefined : daysAgo(value === 'today' ? 0 : Number(value)), date_to: undefined });
          }}
        >
          <option value="any">Any time</option>
          <option value="today">Today</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </Select>
        <TextInput label="From date" type="date" value={query.date_from ?? ''} onChange={(e) => update({ date_from: e.target.value || undefined })} />
        <TextInput label="To date" type="date" value={query.date_to ?? ''} onChange={(e) => update({ date_to: e.target.value || undefined })} />
      </div>
      <div className="row-between">
        <label className="checkbox">
          <input type="checkbox" checked={!!query.overdue} onChange={(e) => update({ overdue: e.target.checked })} />
          Overdue only
        </label>
        {active ? (
          <Button variant="ghost" size="sm" icon={X} onClick={() => onChange({ search: query.search, sort: query.sort })}>
            Clear {active} filter{active === 1 ? '' : 's'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

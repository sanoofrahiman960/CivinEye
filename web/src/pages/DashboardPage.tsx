import { AlertTriangle, CheckCheck, Clock, FileBarChart, Inbox, ListChecks, RefreshCcw, ShieldCheck, Wrench, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import type { IssueQuery } from '../api/endpoints';
import { authorityApi } from '../api/endpoints';
import { Card, ErrorState, LoadingState, PageHeader, Segmented } from '../components/ui';
import { useApi, useDocumentTitle } from '../hooks/useApi';
import { formatDateTime, formatHours } from '../lib/format';
import { issuesLink } from '../lib/issueQuery';
import { PRIORITY_STYLES, STATUS_STYLES } from '../lib/styles';
import { useAuthStore } from '../store/auth';
import type { Dashboard, DurationStats, IssueStatus, Priority } from '../types/api';

type KpiKey = keyof Dashboard['kpis'];

const KPIS: { key: KpiKey; label: string; icon: LucideIcon; color: string; query: IssueQuery }[] = [
  { key: 'total', label: 'Total reported issues', icon: ListChecks, color: '#1E3A8A', query: {} },
  { key: 'awaiting_review', label: 'New / awaiting review', icon: Inbox, color: '#2563EB', query: { status: ['SUBMITTED', 'REOPENED'] } },
  {
    key: 'critical_high',
    label: 'Critical & high priority (open)',
    icon: AlertTriangle,
    color: '#DC2626',
    query: { priority: ['CRITICAL', 'HIGH'], status: ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'REOPENED'] },
  },
  { key: 'in_progress', label: 'In progress', icon: Wrench, color: '#D97706', query: { status: ['IN_PROGRESS'] } },
  { key: 'overdue', label: 'Overdue', icon: Clock, color: '#B91C1C', query: { overdue: true } },
  { key: 'awaiting_verification', label: 'Awaiting citizen verification', icon: ShieldCheck, color: '#0D9488', query: { status: ['RESOLVED'] } },
  { key: 'reopened', label: 'Reopened', icon: RefreshCcw, color: '#BE185D', query: { status: ['REOPENED'] } },
  { key: 'closed', label: 'Closed', icon: CheckCheck, color: '#15803D', query: { status: ['CLOSED'] } },
];

function DurationCard({ title, stats }: { title: string; stats: DurationStats }) {
  return (
    <div>
      <div className="subtle">{title}</div>
      <div style={{ fontSize: 24, fontWeight: 800 }}>{formatHours(stats.average_hours)}</div>
      <div className="subtle">
        Median {formatHours(stats.median_hours)} · {stats.sample_size} issue{stats.sample_size === 1 ? '' : 's'} (last 90 days)
      </div>
    </div>
  );
}

export function DashboardPage() {
  useDocumentTitle('Dashboard');
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const { data, error, loading, reload } = useApi(() => authorityApi.dashboard(period), [period]);

  const firstName = user?.full_name.split(' ')[0] ?? '';
  const scope = user?.role === 'ADMIN' ? 'All departments' : user?.department?.name ?? '';

  return (
    <>
      <PageHeader
        title={`Welcome, ${firstName}`}
        subtitle={`${scope}${data ? ` · Updated ${formatDateTime(data.generated_at)}` : ''}`}
        actions={
          <Link className="btn btn-outline" to="/reports">
            <FileBarChart size={16} aria-hidden /> Reports & export
          </Link>
        }
      />

      {loading && !data ? (
        <LoadingState message="Loading dashboard…" />
      ) : error && !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : data ? (
        <div className="stack">
          <div className="grid grid-kpi">
            {KPIS.map(({ key, label, icon: Icon, color, query }) => (
              <button key={key} type="button" className="card kpi" onClick={() => navigate(issuesLink(query))} aria-label={`${label}: ${data.kpis[key]}. Open the list.`}>
                <span className="kpi-icon" style={{ background: `${color}1A`, color }}>
                  <Icon size={18} aria-hidden />
                </span>
                <span className="kpi-value">{data.kpis[key]}</span>
                <span className="kpi-label">{label}</span>
              </button>
            ))}
          </div>

          <Card
            title="Complaint trend"
            actions={
              <Segmented
                label="Trend period"
                value={period}
                onChange={setPeriod}
                options={[
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'monthly', label: 'Monthly' },
                ]}
              />
            }
          >
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.trend.points} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="reported" name="Reported" fill="#1E3A8A" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="resolved" name="Resolved" fill="#15803D" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-2">
            <Card title="Complaints by status">
              <HorizontalBars
                data={data.by_status.map((d) => ({ label: STATUS_STYLES[d.key as IssueStatus]?.label ?? d.label, value: d.value, color: STATUS_STYLES[d.key as IssueStatus]?.color }))}
                onSelect={(index) => navigate(issuesLink({ status: [data.by_status[index].key as IssueStatus] }))}
              />
            </Card>
            <Card title="Complaints by priority">
              <HorizontalBars
                data={data.by_priority.map((d) => ({ label: PRIORITY_STYLES[d.key as Priority]?.label ?? d.label, value: d.value, color: PRIORITY_STYLES[d.key as Priority]?.color }))}
                onSelect={(index) => navigate(issuesLink({ priority: [data.by_priority[index].key as Priority] }))}
              />
            </Card>
            <Card title="Complaints by category">
              <HorizontalBars data={data.by_category.map((d) => ({ label: d.label, value: d.value }))} />
            </Card>
            <Card title="Response times">
              <div className="stack">
                <DurationCard title="Average time to resolve" stats={data.resolution_time} />
                <DurationCard title="Average time to acknowledge" stats={data.acknowledgement_time} />
              </div>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Bar list with the count printed next to each bar, so values never depend on colour or hover. */
function HorizontalBars({ data, onSelect }: { data: { label: string; value: number; color?: string }[]; onSelect?: (index: number) => void }) {
  if (!data.some((d) => d.value > 0)) return <p className="muted">No data yet.</p>;
  const height = Math.max(160, data.length * 34);
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 12 }} />
          <Tooltip />
          <Bar
            dataKey="value"
            name="Issues"
            radius={[0, 4, 4, 0]}
            label={{ position: 'right', fontSize: 12, fontWeight: 700 }}
            cursor={onSelect ? 'pointer' : undefined}
            onClick={onSelect ? (_entry, index) => onSelect(index) : undefined}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={d.color ?? '#1E3A8A'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import { Download, Filter } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { toApiError } from '../api/client';
import { authorityApi } from '../api/endpoints';
import { IssueFilters } from '../components/IssueFilters';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../components/ui';
import { useAction, useApi, useDocumentTitle } from '../hooks/useApi';
import { formatHours } from '../lib/format';
import { countActiveFilters, paramsFromQuery, queryFromParams } from '../lib/issueQuery';

export function ReportsPage() {
  useDocumentTitle('Reports');
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => queryFromParams(params), [params]);
  const [showFilters, setShowFilters] = useState(true);
  const { data, error, loading, reload } = useApi(() => authorityApi.reportSummary(query), [params.toString()]);
  const exportAction = useAction();
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportCsv() {
    setExportError(null);
    await exportAction.run(async () => {
      try {
        const blob = await authorityApi.exportCsv(query);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        link.href = url;
        link.download = `civiceye-report-${stamp}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        setExportError(toApiError(err).message);
      }
    });
  }

  const active = countActiveFilters(query);

  return (
    <>
      <PageHeader
        title="Reports & export"
        subtitle="Performance by department for the issues in your scope. Exports include every filtered issue (up to 10,000 rows)."
        actions={
          <>
            <Button variant="outline" icon={Filter} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              Filters{active ? ` (${active})` : ''}
            </Button>
            <Button icon={Download} loading={exportAction.busy} onClick={exportCsv}>
              Export CSV
            </Button>
          </>
        }
      />
      {exportError ? <Banner tone="danger">{exportError}</Banner> : null}
      {showFilters ? (
        <Card>
          <IssueFilters query={query} onChange={(next) => setParams(paramsFromQuery({ ...next, page: undefined }))} />
        </Card>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title={data ? `${data.total} issue${data.total === 1 ? '' : 's'}` : 'Departments'} bodyClassName="">
          {loading && !data ? (
            <LoadingState />
          ) : error && !data ? (
            <ErrorState error={error} onRetry={reload} />
          ) : !data?.departments.length ? (
            <EmptyState title="No issues match these filters" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Department</th>
                    <th scope="col">Total</th>
                    <th scope="col">Open</th>
                    <th scope="col">Resolved / closed</th>
                    <th scope="col">Overdue</th>
                    <th scope="col">Reopen rate</th>
                    <th scope="col">Avg. resolution time</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((row) => (
                    <tr key={row.department_id ?? 'none'} style={{ cursor: 'default' }}>
                      <th scope="row" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--c-text)', background: 'none', position: 'static' }}>
                        {row.department}
                      </th>
                      <td>{row.total}</td>
                      <td>{row.open}</td>
                      <td>{row.resolved}</td>
                      <td style={row.overdue ? { color: 'var(--c-danger)', fontWeight: 700 } : undefined}>{row.overdue}</td>
                      <td>{row.reopen_rate === null ? '—' : `${Math.round(row.reopen_rate * 100)}%`}</td>
                      <td>{formatHours(row.average_resolution_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

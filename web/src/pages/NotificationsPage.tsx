import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { toApiError } from '../api/client';
import { notificationApi } from '../api/endpoints';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from '../components/ui';
import { useApi, useDocumentTitle } from '../hooks/useApi';
import { formatRelative } from '../lib/format';
import { useNotificationStore } from '../store/notifications';
import type { AppNotification, NotificationType } from '../types/api';

const URGENT: NotificationType[] = ['LIFE_SAFETY_ALERT', 'SLA_BREACH'];

export function NotificationsPage() {
  useDocumentTitle('Notifications');
  const navigate = useNavigate();
  const refreshUnread = useNotificationStore((s) => s.refreshUnread);
  const setUnread = useNotificationStore((s) => s.setUnread);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, error, loading, reload, setData } = useApi(() => notificationApi.list(page, filter === 'unread'), [page, filter]);

  function markLocal(update: (n: AppNotification) => AppNotification) {
    if (data) setData({ ...data, results: data.results.map(update) });
  }

  async function open(item: AppNotification) {
    if (!item.is_read) {
      markLocal((n) => (n.id === item.id ? { ...n, is_read: true } : n));
      notificationApi.markRead(item.id).then(refreshUnread).catch(() => undefined);
    }
    if (item.issue) navigate(`/issues/${item.issue}`);
  }

  async function markAll() {
    setActionError(null);
    try {
      await notificationApi.markAllRead();
      markLocal((n) => ({ ...n, is_read: true }));
      setUnread(0);
    } catch (err) {
      setActionError(toApiError(err).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <>
            <Segmented
              label="Show"
              value={filter}
              onChange={(value) => {
                setFilter(value);
                setPage(1);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'unread', label: 'Unread' },
              ]}
            />
            <Button variant="outline" icon={CheckCheck} onClick={markAll}>
              Mark all as read
            </Button>
          </>
        }
      />
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      <Card bodyClassName="">
        {loading && !data ? (
          <LoadingState />
        ) : error && !data ? (
          <ErrorState error={error} onRetry={reload} />
        ) : !data?.results.length ? (
          <EmptyState icon={Bell} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} />
        ) : (
          <>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {data.results.map((item) => {
                const urgent = URGENT.includes(item.notification_type);
                return (
                  <li key={item.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                    <button
                      type="button"
                      onClick={() => open(item)}
                      style={{
                        display: 'flex',
                        gap: 12,
                        width: '100%',
                        textAlign: 'left',
                        padding: '14px 20px',
                        border: 0,
                        cursor: 'pointer',
                        background: item.is_read ? 'transparent' : 'var(--c-primary-50)',
                        borderLeft: `4px solid ${item.is_read ? 'transparent' : urgent ? 'var(--c-danger)' : 'var(--c-primary-600)'}`,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div className="row">
                          <strong>{item.title}</strong>
                          {urgent ? <span className="badge badge-danger">Urgent</span> : null}
                          {!item.is_read ? <span className="sr-only">Unread</span> : null}
                        </div>
                        <div className="muted">{item.message}</div>
                        <div className="subtle">
                          {item.complaint_id ? <span className="mono">{item.complaint_id} · </span> : null}
                          {formatRelative(item.created_at)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <nav className="pagination" aria-label="Pagination">
              <Button variant="outline" size="sm" disabled={!data.previous} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="subtle">Page {page}</span>
              <Button variant="outline" size="sm" disabled={!data.next} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </nav>
          </>
        )}
      </Card>
    </>
  );
}

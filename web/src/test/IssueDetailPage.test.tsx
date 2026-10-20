import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import { authorityApi } from '../api/endpoints';
import { IssueDetailPage } from '../pages/IssueDetailPage';
import { useAuthStore } from '../store/auth';
import type { AuthorityIssueDetail, Comment, User } from '../types/api';
// A real response captured from the running backend (seeded demo issue CE-2026-000004, status RESOLVED).
import resolvedFixture from './fixtures/authorityIssueDetail.json';

vi.mock('../components/IssueMap', () => ({ IssueMap: () => <div data-testid="map" />, PriorityLegend: () => null }));
vi.mock('../api/endpoints', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/endpoints')>();
  return {
    ...actual,
    authorityApi: {
      detail: vi.fn(),
      acknowledge: vi.fn(),
      startWork: vi.fn(),
      resolve: vi.fn(),
      reopen: vi.fn(),
      close: vi.fn(),
      changePriority: vi.fn(),
      assign: vi.fn(),
      comment: vi.fn(),
      overrideProofCheck: vi.fn(),
      officers: vi.fn().mockResolvedValue([]),
    },
  };
});

const resolved = resolvedFixture as unknown as AuthorityIssueDetail;
const submitted: AuthorityIssueDetail = {
  ...resolved,
  status: 'SUBMITTED',
  images: resolved.images.filter((i) => i.image_type === 'REPORT'),
  history: resolved.history.slice(0, 1),
  available_actions: ['acknowledge', 'assign', 'change_priority', 'comment'],
};

const officer: User = {
  id: 5,
  username: 'officer.pwd',
  full_name: 'Priya Officer',
  email: null,
  phone_number: '',
  role: 'OFFICER',
  is_authority: true,
  is_global_admin: false,
  department: resolved.department,
  service_areas: [{ id: 1, name: 'Kochi', code: 'kochi', level: 'CORPORATION', level_label: 'Municipal Corporation', parent: null }],
  preferred_language: 'en',
  date_joined: '2026-01-01T00:00:00Z',
};

function renderPage(id = resolved.id) {
  render(
    <MemoryRouter initialEntries={[`/issues/${id}`]}>
      <Routes>
        <Route path="/issues/:id" element={<IssueDetailPage />} />
        <Route path="/issues" element={<div>Issue list</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const api = vi.mocked(authorityApi);

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ status: 'signedIn', user: officer });
});

describe('IssueDetailPage', () => {
  it('renders a real backend response: reporter contact, photos, history and only the allowed actions', async () => {
    api.detail.mockResolvedValue(resolved);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(resolved.title);
    expect(screen.getAllByText(resolved.complaint_id).length).toBeGreaterThan(0);
    // Reporter contact is shown to authority staff (citizens sign in by phone, so the phone is always present).
    const telLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === `tel:${resolved.reporter.phone_number}`);
    expect(telLinks).toHaveLength(1);
    expect(telLinks[0]).toHaveTextContent(resolved.reporter.phone_number);
    expect(screen.getAllByText('Resolved — Awaiting Citizen Verification').length).toBeGreaterThan(0);

    // RESOLVED issues can be reopened but not acknowledged or resolved again.
    expect(screen.getAllByRole('button', { name: /Reopen/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Resolve/ })).toBeNull();
  });

  it('acknowledges a new issue and shows the updated status', async () => {
    api.detail.mockResolvedValue(submitted);
    api.acknowledge.mockResolvedValue({ ...submitted, status: 'ACKNOWLEDGED', available_actions: ['start_work', 'assign', 'change_priority', 'comment'] });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Crew notified');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(api.acknowledge).toHaveBeenCalledWith(submitted.id, 'Crew notified'));
    expect(await screen.findByRole('button', { name: 'Start work' })).toBeInTheDocument();
  });

  it('requires a reason before changing priority', async () => {
    api.detail.mockResolvedValue(submitted);
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Change priority' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Critical/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Change priority' }));
    expect(api.changePriority).not.toHaveBeenCalled();
  });

  it('posts internal comments by default', async () => {
    const comment: Comment = {
      id: 99,
      comment: 'Contractor scheduled',
      visibility: 'INTERNAL',
      author_name: officer.full_name,
      author_role: 'OFFICER',
      is_mine: true,
      created_at: '2026-10-20T10:00:00Z',
    };
    api.detail.mockResolvedValue(submitted);
    api.comment.mockResolvedValue(comment);
    renderPage();

    await screen.findByRole('heading', { level: 1 });
    await userEvent.type(screen.getByRole('textbox', { name: 'Add a comment' }), 'Contractor scheduled');
    await userEvent.click(screen.getByRole('button', { name: 'Post internal comment' }));
    await waitFor(() => expect(api.comment).toHaveBeenCalledWith(submitted.id, 'Contractor scheduled', 'INTERNAL'));
  });

  it('shows an out-of-scope message on 404', async () => {
    api.detail.mockRejectedValue(new ApiError(404, 'not_found', 'Not found.'));
    renderPage(12345);
    expect(await screen.findByText(/not found or no longer in your scope/i)).toBeInTheDocument();
  });
});

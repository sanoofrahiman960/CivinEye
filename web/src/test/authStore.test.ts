import { beforeEach, describe, expect, it, vi } from 'vitest';

import { tokens } from '../api/client';
import { authApi } from '../api/endpoints';
import { useAuthStore } from '../store/auth';
import type { User } from '../types/api';

vi.mock('../api/endpoints', () => ({
  authApi: { login: vi.fn(), logout: vi.fn(), me: vi.fn() },
}));

const officer: User = {
  id: 7,
  username: 'officer.sanitation',
  full_name: 'Sana Officer',
  email: null,
  phone_number: '',
  role: 'OFFICER',
  is_authority: true,
  is_global_admin: false,
  department: { id: 1, name: 'Sanitation' },
  service_areas: [{ id: 1, name: 'Kochi', code: 'kochi', level: 'CORPORATION', level_label: 'Municipal Corporation', parent: null }],
  preferred_language: 'en',
  date_joined: '2026-01-01T00:00:00Z',
};

describe('web auth store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokens.clear();
    useAuthStore.setState({ status: 'loading', user: null });
  });

  it('keeps the access token in memory and only the refresh token in sessionStorage', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ access: 'acc', refresh: 'ref', user: officer });
    await useAuthStore.getState().login('officer.sanitation', 'pw');
    expect(tokens.access).toBe('acc');
    expect(sessionStorage.getItem('civiceye.refresh')).toBe('ref');
    expect(JSON.stringify(sessionStorage)).not.toContain('acc');
    expect(localStorage.length).toBe(0);
  });

  it('signs out without a stored session', async () => {
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('logs out by blacklisting the refresh token and clearing storage', async () => {
    vi.mocked(authApi.login).mockResolvedValue({ access: 'acc', refresh: 'ref', user: officer });
    await useAuthStore.getState().login('officer.sanitation', 'pw');
    await useAuthStore.getState().logout();
    expect(authApi.logout).toHaveBeenCalledWith('ref');
    expect(tokens.access).toBeNull();
    expect(sessionStorage.getItem('civiceye.refresh')).toBeNull();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });
});

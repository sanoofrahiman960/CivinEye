import * as SecureStore from 'expo-secure-store';

import { authApi } from '../api/authApi';
import { ApiError } from '../api/client';
import { tokenStorage } from '../api/tokenStorage';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types/api';

jest.mock('../api/authApi', () => ({
  authApi: { login: jest.fn(), register: jest.fn(), logout: jest.fn(), me: jest.fn() },
}));

const api = authApi as jest.Mocked<typeof authApi>;

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

beforeEach(async () => {
  jest.clearAllMocks();
  await tokenStorage.clear();
  useAuthStore.setState({ status: 'loading', user: null });
});

describe('auth store', () => {
  it('logs staff in with a normalised username and keeps tokens in secure storage', async () => {
    api.login.mockResolvedValue({ access: 'acc', refresh: 'ref', user: officer });

    const user = await useAuthStore.getState().login('  Officer.Sanitation ', 'secret');

    expect(api.login).toHaveBeenCalledWith('officer.sanitation', 'secret');
    expect(user.role).toBe('OFFICER');
    expect(useAuthStore.getState().status).toBe('signedIn');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('civiceye.refresh', 'ref');
    expect(tokenStorage.access).toBe('acc');
  });

  it('surfaces the wrong-portal error from the backend without signing in', async () => {
    api.login.mockRejectedValue(new ApiError(403, 'wrong_portal', 'This account is a citizen account.'));
    await expect(useAuthStore.getState().login('someone', 'pw')).rejects.toMatchObject({ code: 'wrong_portal' });
    expect(useAuthStore.getState().status).toBe('loading');
    expect(tokenStorage.access).toBeNull();
  });

  it('restores a session using the role returned by /auth/me', async () => {
    await tokenStorage.save({ access: 'acc', refresh: 'ref' });
    api.me.mockResolvedValue(officer);
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedIn', user: { role: 'OFFICER' } });
  });

  it('clears a rejected session on bootstrap', async () => {
    await tokenStorage.save({ access: 'acc', refresh: 'ref' });
    api.me.mockRejectedValue(new ApiError(401, 'session_expired', 'expired'));
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().status).toBe('signedOut');
    expect(tokenStorage.refresh).toBeNull();
  });

  it('logs out by blacklisting the refresh token and clearing storage', async () => {
    await useAuthStore.getState().applyAuthResponse({ access: 'acc', refresh: 'ref', user: officer });
    await useAuthStore.getState().logout();
    expect(api.logout).toHaveBeenCalledWith('ref');
    expect(useAuthStore.getState()).toMatchObject({ status: 'signedOut', user: null });
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('civiceye.access');
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import { authApi } from '../api/endpoints';
import { ProfilePage } from '../pages/ProfilePage';
import { useAuthStore } from '../store/auth';
import type { User } from '../types/api';

vi.mock('../api/endpoints', () => ({ authApi: { updateProfile: vi.fn(), changePassword: vi.fn() } }));

const admin: User = {
  id: 1,
  username: 'unnikrishnan',
  full_name: 'Administrator',
  email: null,
  phone_number: '',
  role: 'ADMIN',
  is_authority: true,
  is_global_admin: true,
  department: null,
  service_areas: [],
  preferred_language: 'en',
  date_joined: '2026-10-20T00:00:00Z',
};

describe('ProfilePage username and email editing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ status: 'signedIn', user: admin });
  });

  it('saves a new username and email', async () => {
    vi.mocked(authApi.updateProfile).mockResolvedValue({ ...admin, username: 'kochi.admin', email: 'admin@kochi.gov' });
    render(<ProfilePage />);
    const username = screen.getByLabelText('Username');
    await userEvent.clear(username);
    await userEvent.type(username, 'Kochi.Admin');
    await userEvent.type(screen.getByLabelText('Email'), 'Admin@Kochi.gov');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() =>
      expect(authApi.updateProfile).toHaveBeenCalledWith({
        username: 'kochi.admin',
        email: 'admin@kochi.gov',
        full_name: 'Administrator',
        phone_number: '',
      }),
    );
    expect(await screen.findByText(/Sign in with your new username "kochi.admin"/)).toBeInTheDocument();
    expect(useAuthStore.getState().user?.username).toBe('kochi.admin');
  });

  it('does not resend unchanged login details', async () => {
    vi.mocked(authApi.updateProfile).mockResolvedValue(admin);
    render(<ProfilePage />);
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(authApi.updateProfile).toHaveBeenCalledWith({ full_name: 'Administrator', phone_number: '' }));
  });

  it('validates the username locally and shows server errors on the field', async () => {
    render(<ProfilePage />);
    const username = screen.getByLabelText('Username');
    await userEvent.clear(username);
    await userEvent.type(username, 'a b');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText(/Use 3–50 lowercase letters/)).toBeInTheDocument();
    expect(authApi.updateProfile).not.toHaveBeenCalled();

    vi.mocked(authApi.updateProfile).mockRejectedValue(
      new ApiError(400, 'validation_error', 'username: This username is already taken.', { username: ['This username is already taken.'] }),
    );
    await userEvent.clear(username);
    await userEvent.type(username, 'supervisor');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByText('This username is already taken.')).toBeInTheDocument();
  });
});

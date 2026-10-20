import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import { LoginPage } from '../pages/LoginPage';
import { useAuthStore } from '../store/auth';

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Dashboard home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  const login = vi.fn();

  beforeEach(() => {
    login.mockReset();
    useAuthStore.setState({ status: 'signedOut', user: null, login });
  });

  it('validates the form before calling the API', async () => {
    renderLogin();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your username.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in and goes to the dashboard', async () => {
    login.mockImplementation(async () => {
      useAuthStore.setState({ status: 'signedIn' });
    });
    renderLogin();
    await userEvent.type(screen.getByLabelText('Username'), 'officer.sanitation');
    await userEvent.type(screen.getByLabelText('Password'), 'CivicEye@2026');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('officer.sanitation', 'CivicEye@2026'));
    expect(await screen.findByText('Dashboard home')).toBeInTheDocument();
  });

  it('explains that citizen accounts belong in the mobile app', async () => {
    login.mockRejectedValue(new ApiError(403, 'wrong_portal', 'This account is a citizen account.'));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Username'), 'someone');
    await userEvent.type(screen.getByLabelText('Password'), 'CivicEye@2026');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/Citizens use the CivicEye mobile app/)).toBeInTheDocument();
  });

  it('shows a generic message for wrong credentials', async () => {
    login.mockRejectedValue(new ApiError(401, 'no_active_account', 'No active account'));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Username'), 'officer.sanitation');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect username or password.')).toBeInTheDocument();
  });
});

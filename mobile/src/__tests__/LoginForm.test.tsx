import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ApiError } from '../api/client';
import { LoginForm } from '../screens/auth/LoginForm';
import { useAuthStore } from '../store/authStore';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

function renderForm() {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <LoginForm title="Authority sign in" subtitle="" icon="briefcase" accent="#1E3A8A" />
    </SafeAreaProvider>,
  );
}

describe('Authority LoginForm (username + password set up by the administrator)', () => {
  const login = jest.fn();

  beforeEach(() => {
    login.mockReset();
    useAuthStore.setState({ login });
  });

  it('validates fields before calling the API', async () => {
    renderForm();
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your username.')).toBeTruthy();
    expect(screen.getByText('Enter your password.')).toBeTruthy();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in with username and password', async () => {
    login.mockResolvedValue({});
    renderForm();
    fireEvent.changeText(screen.getByLabelText('Username'), 'officer.sanitation');
    fireEvent.changeText(screen.getByLabelText('Password'), 'S3cret-Pass');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(login).toHaveBeenCalledWith('officer.sanitation', 'S3cret-Pass'));
  });

  it('shows a generic message for wrong credentials and the backend message otherwise', async () => {
    login.mockRejectedValueOnce(new ApiError(401, 'no_active_account', 'No active account'));
    renderForm();
    fireEvent.changeText(screen.getByLabelText('Username'), 'officer');
    fireEvent.changeText(screen.getByLabelText('Password'), 'wrong');
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect username or password.')).toBeTruthy();

    login.mockRejectedValueOnce(
      new ApiError(403, 'wrong_portal', 'Citizens sign in with their mobile number and a one-time code in the CivicEye app.'),
    );
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/one-time code/)).toBeTruthy();
  });

  it('points to the administrator instead of self-service password reset', () => {
    renderForm();
    expect(screen.getByText(/Ask your system administrator/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).toBeNull();
  });
});

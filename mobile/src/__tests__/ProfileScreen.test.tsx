import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { authApi } from '../api/authApi';
import { ProfileScreen } from '../screens/shared/ProfileScreen';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types/api';

jest.mock('../api/authApi', () => ({ authApi: { updateProfile: jest.fn(), changePassword: jest.fn(), logout: jest.fn() } }));
jest.mock('../utils/push', () => ({ unregisterPushNotifications: jest.fn() }));
const api = authApi as jest.Mocked<typeof authApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const officer: User = {
  id: 7,
  username: 'officer.sanitation',
  full_name: 'Sana Officer',
  email: null,
  phone_number: '+919800000007',
  role: 'OFFICER',
  is_authority: true,
  is_global_admin: false,
  department: { id: 1, name: 'Sanitation' },
  service_areas: [{ id: 1, name: 'Kochi', code: 'kochi', level: 'CORPORATION', level_label: 'Municipal Corporation', parent: null }],
  preferred_language: 'en',
  date_joined: '2026-01-01T00:00:00Z',
};
const citizen: User = { ...officer, id: 3, username: null, full_name: 'Anita Nair', role: 'CITIZEN', is_authority: false, department: null, service_areas: [] };

function renderProfile() {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <ProfileScreen />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('ProfileScreen username and email editing', () => {
  it('lets staff change their username and email', async () => {
    useAuthStore.setState({ status: 'signedIn', user: officer });
    api.updateProfile.mockResolvedValue({ ...officer, username: 'kochi.sanitation', email: 'sana@kochi.gov' });
    renderProfile();

    fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.changeText(screen.getByLabelText('Username'), 'Kochi.Sanitation');
    fireEvent.changeText(screen.getByLabelText('Email (optional)'), 'Sana@Kochi.gov');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.updateProfile).toHaveBeenCalledWith({
        username: 'kochi.sanitation',
        email: 'sana@kochi.gov',
        full_name: 'Sana Officer',
        phone_number: '+919800000007',
      }),
    );
    await waitFor(() => expect(useAuthStore.getState().user?.username).toBe('kochi.sanitation'));
    expect(Alert.alert).toHaveBeenCalledWith('Username changed', 'Sign in with "kochi.sanitation" from now on.');
  });

  it('rejects an invalid username before calling the API', () => {
    useAuthStore.setState({ status: 'signedIn', user: officer });
    renderProfile();
    fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    fireEvent.changeText(screen.getByLabelText('Username'), 'a b');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByText(/Use 3–50 lowercase letters/)).toBeTruthy();
    expect(api.updateProfile).not.toHaveBeenCalled();
  });

  it('lets citizens add an email but shows no username field', async () => {
    useAuthStore.setState({ status: 'signedIn', user: citizen });
    api.updateProfile.mockResolvedValue({ ...citizen, email: 'anita@example.com' });
    renderProfile();
    fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    expect(screen.queryByLabelText('Username')).toBeNull();
    fireEvent.changeText(screen.getByLabelText('Email (optional)'), 'anita@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ email: 'anita@example.com', full_name: 'Anita Nair' }));
  });
});

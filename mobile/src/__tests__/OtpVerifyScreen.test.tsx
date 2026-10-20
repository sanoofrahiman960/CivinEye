import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { authApi } from '../api/authApi';
import { ApiError } from '../api/client';
import { OtpVerifyScreen } from '../screens/auth/OtpVerifyScreen';
import { toInternational, validateMobile } from '../screens/auth/PhoneLoginScreen';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types/api';

jest.mock('../api/authApi', () => ({ authApi: { verifyOtp: jest.fn(), requestOtp: jest.fn() } }));
const api = authApi as jest.Mocked<typeof authApi>;
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

const citizen: User = {
  id: 3,
  username: null,
  full_name: 'Anita Nair',
  email: null,
  phone_number: '+919812345678',
  role: 'CITIZEN',
  is_authority: false,
  is_global_admin: false,
  department: null,
  service_areas: [],
  preferred_language: 'en',
  date_joined: '2026-10-20T00:00:00Z',
};

function renderScreen(codeLength = 6) {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  const route = { key: 'otp', name: 'OtpVerify', params: { phoneNumber: '+919812345678', resendAfter: 60, message: 'Code sent', codeLength } };
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <OtpVerifyScreen navigation={navigation as any} route={route as any} />
    </SafeAreaProvider>,
  );
  return navigation;
}

describe('phone number helpers', () => {
  it('adds the default country code to local numbers', () => {
    expect(toInternational('98123 45678')).toBe('+919812345678');
    expect(toInternational('09812345678')).toBe('+919812345678');
    expect(toInternational('+44 7700 900123')).toBe('+447700900123');
  });

  it('validates numbers', () => {
    expect(validateMobile('')).toBe('Enter your mobile number.');
    expect(validateMobile('12345')).toBeDefined();
    expect(validateMobile('981234567')).toBe('Indian mobile numbers have 10 digits.');
    expect(validateMobile('98123 45678')).toBeUndefined();
  });
});

describe('OtpVerifyScreen', () => {
  const applyAuthResponse = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({ applyAuthResponse });
  });

  it('signs an existing citizen in as soon as 6 digits are entered', async () => {
    api.verifyOtp.mockResolvedValue({ status: 'authenticated', is_new_user: false, access: 'a', refresh: 'r', user: citizen });
    renderScreen();
    fireEvent.changeText(screen.getByLabelText('6-digit code'), '123456');
    await waitFor(() => expect(api.verifyOtp).toHaveBeenCalledWith('+919812345678', '123456', undefined));
    await waitFor(() => expect(applyAuthResponse).toHaveBeenCalledWith(expect.objectContaining({ access: 'a', user: citizen })));
  });

  it('asks a new number for a name, then creates the account', async () => {
    api.verifyOtp
      .mockResolvedValueOnce({ status: 'name_required', phone_number: '+919812345678' })
      .mockResolvedValueOnce({ status: 'authenticated', is_new_user: true, access: 'a', refresh: 'r', user: citizen });
    renderScreen();
    fireEvent.changeText(screen.getByLabelText('6-digit code'), '123456');
    expect(await screen.findByLabelText('Your full name')).toBeTruthy();
    expect(applyAuthResponse).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Your full name'), 'Anita Nair');
    fireEvent.press(screen.getByRole('button', { name: 'Create my account' }));
    await waitFor(() => expect(api.verifyOtp).toHaveBeenLastCalledWith('+919812345678', '123456', 'Anita Nair'));
    await waitFor(() => expect(applyAuthResponse).toHaveBeenCalled());
  });

  it('shows the backend message for a wrong code and clears the input', async () => {
    api.verifyOtp.mockRejectedValue(new ApiError(400, 'invalid_code', 'Incorrect code. 4 attempts left.', { attempts_left: 4 }));
    renderScreen();
    fireEvent.changeText(screen.getByLabelText('6-digit code'), '000000');
    expect(await screen.findByText('Incorrect code. 4 attempts left.')).toBeTruthy();
    expect(screen.getByLabelText('6-digit code').props.value).toBe('');
  });

  it('uses a 4-digit code when the backend runs with the test code', async () => {
    api.verifyOtp.mockResolvedValue({ status: 'authenticated', is_new_user: false, access: 'a', refresh: 'r', user: citizen });
    renderScreen(4);
    expect(screen.getByLabelText('4-digit code')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('4-digit code'), '1234');
    await waitFor(() => expect(api.verifyOtp).toHaveBeenCalledWith('+919812345678', '1234', undefined));
  });

  it('disables resend during the cooldown', () => {
    renderScreen();
    expect(screen.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
  });
});

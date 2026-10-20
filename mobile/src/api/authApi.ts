import type { AuthResponse, OtpRequestResponse, OtpVerifyResponse, User } from '../types/api';
import { get, patch, post } from './client';

export const authApi = {
  /** Citizens: send a one-time sign-in code by SMS. The same flow signs up new numbers. */
  requestOtp: (phone_number: string) => post<OtpRequestResponse>('/auth/otp/request/', { phone_number }),

  /** Citizens: verify the code. A new number returns `name_required` until `full_name` is sent. */
  verifyOtp: (phone_number: string, code: string, full_name?: string) =>
    post<OtpVerifyResponse>('/auth/otp/verify/', { phone_number, code, ...(full_name ? { full_name } : {}) }),

  /** Authority staff only: username + password created by the administrator. */
  login: (username: string, password: string) => post<AuthResponse>('/auth/login/', { username, password }),

  logout: (refresh: string) => post<void>('/auth/logout/', { refresh }),

  me: () => get<User>('/auth/me/'),

  updateProfile: (changes: Partial<Pick<User, 'username' | 'email' | 'full_name' | 'phone_number' | 'preferred_language'>>) =>
    patch<User>('/auth/profile/', changes),

  changePassword: (current_password: string, new_password: string) =>
    post<AuthResponse>('/auth/change-password/', { current_password, new_password }),
};

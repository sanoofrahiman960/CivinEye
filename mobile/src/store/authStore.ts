import { create } from 'zustand';

import { authApi } from '../api/authApi';
import { setSessionExpiredHandler } from '../api/client';
import { tokenStorage } from '../api/tokenStorage';
import type { AuthResponse, User } from '../types/api';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Restore a saved session on app start; the role always comes from the backend. */
  bootstrap: () => Promise<void>;
  /** Authority staff: username + password set up by the administrator. */
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  applyAuthResponse: (response: AuthResponse) => Promise<User>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,

  bootstrap: async () => {
    const tokens = await tokenStorage.load();
    if (!tokens) {
      set({ status: 'signedOut', user: null });
      return;
    }
    try {
      const user = await authApi.me();
      set({ status: 'signedIn', user });
    } catch (error) {
      const offline = (error as { isNetworkError?: boolean }).isNetworkError;
      if (offline) {
        // Without a network we cannot verify the session; ask the user to sign in once back online.
        set({ status: 'signedOut', user: null });
        return;
      }
      await tokenStorage.clear();
      set({ status: 'signedOut', user: null });
    }
  },

  applyAuthResponse: async (response) => {
    await tokenStorage.save({ access: response.access, refresh: response.refresh });
    set({ status: 'signedIn', user: response.user });
    return response.user;
  },

  login: async (username, password) => {
    const response = await authApi.login(username.trim().toLowerCase(), password);
    return get().applyAuthResponse(response);
  },

  logout: async () => {
    const refresh = tokenStorage.refresh;
    if (refresh) {
      try {
        await authApi.logout(refresh);
      } catch {
        // The token is cleared locally either way.
      }
    }
    await tokenStorage.clear();
    set({ status: 'signedOut', user: null });
  },

  setUser: (user) => set({ user }),
}));

setSessionExpiredHandler(() => useAuthStore.setState({ status: 'signedOut', user: null }));

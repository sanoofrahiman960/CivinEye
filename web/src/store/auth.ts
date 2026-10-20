import { create } from 'zustand';

import { refreshAccessToken, setSessionExpiredHandler, tokens } from '../api/client';
import { authApi } from '../api/endpoints';
import type { AuthResponse, User } from '../types/api';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: Status;
  user: User | null;
  /** Restore the session of this browser tab, if any. */
  bootstrap: () => Promise<void>;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  applyAuthResponse: (response: AuthResponse) => User;
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'loading',
  user: null,

  bootstrap: async () => {
    if (!tokens.refresh) {
      set({ status: 'signedOut', user: null });
      return;
    }
    try {
      const access = await refreshAccessToken();
      if (!access) throw new Error('expired');
      const user = await authApi.me();
      if (!user.is_authority) throw new Error('not authority');
      set({ status: 'signedIn', user });
    } catch {
      tokens.clear();
      set({ status: 'signedOut', user: null });
    }
  },

  applyAuthResponse: (response) => {
    tokens.save({ access: response.access, refresh: response.refresh });
    set({ status: 'signedIn', user: response.user });
    return response.user;
  },

  login: async (username, password) => get().applyAuthResponse(await authApi.login(username, password)),

  logout: async () => {
    const refresh = tokens.refresh;
    if (refresh) {
      try {
        await authApi.logout(refresh);
      } catch {
        // Cleared locally either way.
      }
    }
    tokens.clear();
    set({ status: 'signedOut', user: null });
  },

  setUser: (user) => set({ user }),
}));

setSessionExpiredHandler(() => useAuthStore.setState({ status: 'signedOut', user: null }));

export const isSupervisorOrAdmin = (user: User | null) => user?.role === 'SUPERVISOR' || user?.role === 'ADMIN';

import NetInfo from '@react-native-community/netinfo';
import { create } from 'zustand';

import { offlineQueue, type FlushResult, type QueuedReport } from '../offline/queue';
import { useAuthStore } from './authStore';

interface OfflineState {
  isOnline: boolean;
  pending: QueuedReport[];
  flushing: boolean;
  refresh: () => Promise<void>;
  flush: () => Promise<FlushResult | null>;
  remove: (clientSubmissionId: string) => Promise<void>;
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  isOnline: true,
  pending: [],
  flushing: false,

  refresh: async () => set({ pending: await offlineQueue.list() }),

  flush: async () => {
    // Reports are sent as the signed-in citizen; wait until there is a session.
    if (get().flushing || useAuthStore.getState().status !== 'signedIn') return null;
    set({ flushing: true });
    try {
      const result = await offlineQueue.flush();
      set({ pending: await offlineQueue.list() });
      return result;
    } finally {
      set({ flushing: false });
    }
  },

  remove: async (id) => {
    await offlineQueue.remove(id);
    set({ pending: await offlineQueue.list() });
  },
}));

/** Watch connectivity and send queued reports automatically when the device comes back online. */
export function startOfflineSync(): () => void {
  return NetInfo.addEventListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable !== false);
    const wasOnline = useOfflineStore.getState().isOnline;
    useOfflineStore.setState({ isOnline: online });
    if (online && !wasOnline && useOfflineStore.getState().pending.length) {
      useOfflineStore.getState().flush();
    }
  });
}

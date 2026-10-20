import { create } from 'zustand';

import { notificationApi } from '../api/notificationApi';

interface NotificationState {
  unread: number;
  refreshUnread: () => Promise<void>;
  setUnread: (count: number) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  refreshUnread: async () => {
    try {
      const { unread } = await notificationApi.unreadCount();
      set({ unread });
    } catch {
      // Badge is best-effort; keep the previous value when offline.
    }
  },
  setUnread: (unread) => set({ unread }),
}));

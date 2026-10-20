import { create } from 'zustand';

import { notificationApi } from '../api/endpoints';

interface NotificationState {
  unread: number;
  refreshUnread: () => Promise<void>;
  setUnread: (count: number) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  unread: 0,
  refreshUnread: async () => {
    try {
      set({ unread: (await notificationApi.unreadCount()).unread });
    } catch {
      // Best effort: keep the last known count.
    }
  },
  setUnread: (unread) => set({ unread }),
}));

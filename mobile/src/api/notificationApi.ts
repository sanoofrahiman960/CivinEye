import type { AppNotification, Paginated } from '../types/api';
import { get, http, patch, post } from './client';

export const notificationApi = {
  list: (page = 1, unreadOnly = false) =>
    get<Paginated<AppNotification>>('/notifications/', { params: { page, unread: unreadOnly ? 'true' : undefined } }),

  unreadCount: () => get<{ unread: number }>('/notifications/unread-count/'),

  markRead: (id: number) => patch<AppNotification>(`/notifications/${id}/read/`),

  markAllRead: () => post<{ updated: number }>('/notifications/read-all/'),

  registerDevice: (token: string, platform: 'ios' | 'android' | 'web') =>
    post<void>('/notifications/devices/', { token, platform }),

  unregisterDevice: async (token: string) => {
    await http.delete('/notifications/devices/', { data: { token } });
  },
};

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { notificationApi } from '../api/notificationApi';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let registeredToken: string | null = null;

/**
 * Register this device for Expo push notifications and send the token to the backend.
 * In-app notifications always work; push is skipped silently where it is unavailable
 * (simulators, Expo Go on Android, or a project without an EAS projectId).
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Issue updates',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
      await Notifications.setNotificationChannelAsync('urgent', {
        name: 'Urgent alerts',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300],
      });
    }
    if (!Device.isDevice) return null;

    const existing = await Notifications.getPermissionsAsync();
    const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!status.granted) return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await notificationApi.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    registeredToken = token;
    return token;
  } catch {
    return null;
  }
}

export async function unregisterPushNotifications() {
  if (!registeredToken) return;
  try {
    await notificationApi.unregisterDevice(registeredToken);
  } catch {
    // Server-side the token is also deactivated once Expo reports it as unregistered.
  }
  registeredToken = null;
}

/** Issue id carried in a push notification's data payload, if any. */
export function issueIdFromNotification(response: Notifications.NotificationResponse): number | null {
  const data = response.notification.request.content.data as { issue_id?: number | null } | undefined;
  return typeof data?.issue_id === 'number' ? data.issue_id : null;
}

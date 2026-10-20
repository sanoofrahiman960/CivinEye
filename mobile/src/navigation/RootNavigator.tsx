import AsyncStorage from '@react-native-async-storage/async-storage';
import { createNavigationContainerRef, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { SplashScreen } from '../screens/auth/SplashScreen';
import { ONBOARDING_KEY } from '../screens/auth/OnboardingScreen';
import { useAuthStore } from '../store/authStore';
import { useNotificationStore } from '../store/notificationStore';
import { startOfflineSync, useOfflineStore } from '../store/offlineStore';
import { useReferenceStore } from '../store/referenceStore';
import { colors } from '../theme';
import { issueIdFromNotification, registerForPushNotifications } from '../utils/push';
import { AuthNavigator } from './AuthNavigator';
import { AuthorityNavigator } from './AuthorityNavigator';
import { CitizenNavigator } from './CitizenNavigator';

// The navigation ref is untyped because the root renders one of three different navigators.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const navigationRef = createNavigationContainerRef<any>();

const theme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, primary: colors.primary, background: colors.background, card: colors.surface, text: colors.text, border: colors.border },
};

const UNREAD_POLL_MS = 60_000;

/**
 * Chooses the citizen or authority app from the role returned by the backend after login.
 * The role cards on the welcome screen only pick a sign-in form; they never grant access.
 */
export function RootNavigator() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  useEffect(() => {
    bootstrap();
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((value) => setOnboardingDone(value === '1'))
      .catch(() => setOnboardingDone(true));
    useOfflineStore.getState().refresh();
    return startOfflineSync();
  }, [bootstrap]);

  const userId = user?.id;
  const isAuthority = user?.is_authority ?? false;

  // Signed-in housekeeping: reference data, push registration, unread badge, queued reports.
  useEffect(() => {
    if (status !== 'signedIn' || !userId) return;
    useReferenceStore.getState().load(true).catch(() => undefined);
    registerForPushNotifications();
    const refreshUnread = useNotificationStore.getState().refreshUnread;
    refreshUnread();
    if (!isAuthority) useOfflineStore.getState().flush();

    const interval = setInterval(refreshUnread, UNREAD_POLL_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshUnread();
        if (!isAuthority && useOfflineStore.getState().pending.length) useOfflineStore.getState().flush();
      }
    });
    const tapSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const issueId = issueIdFromNotification(response);
      if (!issueId || !navigationRef.isReady()) return;
      navigationRef.navigate(isAuthority ? 'AuthorityIssueDetail' : 'IssueDetail', { issueId });
    });
    return () => {
      clearInterval(interval);
      appState.remove();
      tapSubscription.remove();
    };
  }, [status, userId, isAuthority]);

  if (status === 'loading' || onboardingDone === null) return <SplashScreen />;

  return (
    <NavigationContainer ref={navigationRef} theme={theme}>
      {status !== 'signedIn' || !user ? (
        <AuthNavigator showOnboarding={!onboardingDone} />
      ) : user.is_authority ? (
        <AuthorityNavigator />
      ) : (
        <CitizenNavigator />
      )}
    </NavigationContainer>
  );
}

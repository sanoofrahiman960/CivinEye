import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthorityDashboardScreen } from '../screens/authority/AuthorityDashboardScreen';
import { AuthorityIssueDetailScreen } from '../screens/authority/AuthorityIssueDetailScreen';
import { AuthorityIssuesScreen } from '../screens/authority/AuthorityIssuesScreen';
import { ReportsScreen } from '../screens/authority/ReportsScreen';
import { ResolveIssueScreen } from '../screens/authority/ResolveIssueScreen';
import { NotificationsScreen } from '../screens/shared/NotificationsScreen';
import { ProfileScreen } from '../screens/shared/ProfileScreen';
import { useNotificationStore } from '../store/notificationStore';
import { colors, type IconName } from '../theme';
import type { AuthorityStackParamList, AuthorityTabParamList } from './types';

const Tabs = createBottomTabNavigator<AuthorityTabParamList>();
const Stack = createNativeStackNavigator<AuthorityStackParamList>();

const TAB_ICONS: Record<keyof AuthorityTabParamList, [IconName, IconName]> = {
  Dashboard: ['speedometer', 'speedometer-outline'],
  Issues: ['file-tray-full', 'file-tray-full-outline'],
  Notifications: ['notifications', 'notifications-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};

function AuthorityTabs() {
  const unread = useNotificationStore((s) => s.unread);
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.authority,
        tabBarInactiveTintColor: colors.textSubtle,
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="Dashboard" component={AuthorityDashboardScreen} options={{ title: 'Dashboard' }} />
      <Tabs.Screen name="Issues" component={AuthorityIssuesScreen} options={{ title: 'Issues' }} />
      <Tabs.Screen name="Notifications" options={{ title: 'Notifications', tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined }}>
        {({ navigation }) => <NotificationsScreen openIssue={(issueId) => navigation.navigate('AuthorityIssueDetail', { issueId })} />}
      </Tabs.Screen>
      <Tabs.Screen name="Profile" options={{ title: 'Profile' }}>
        {() => <ProfileScreen />}
      </Tabs.Screen>
    </Tabs.Navigator>
  );
}

export function AuthorityNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{ headerTintColor: colors.authority, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerBackTitle: 'Back' }}
    >
      <Stack.Screen name="AuthorityTabs" component={AuthorityTabs} options={{ headerShown: false }} />
      <Stack.Screen name="AuthorityIssueDetail" component={AuthorityIssueDetailScreen} options={{ title: 'Issue' }} />
      <Stack.Screen name="ResolveIssue" component={ResolveIssueScreen} options={{ title: 'Resolve issue' }} />
      <Stack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports & export' }} />
    </Stack.Navigator>
  );
}

import Ionicons from '@expo/vector-icons/Ionicons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CitizenHomeScreen } from '../screens/citizen/CitizenHomeScreen';
import { IssueDetailScreen } from '../screens/citizen/IssueDetailScreen';
import { MapScreen } from '../screens/citizen/MapScreen';
import { MyIssuesScreen } from '../screens/citizen/MyIssuesScreen';
import { PendingReportsScreen } from '../screens/citizen/PendingReportsScreen';
import { ReportIssueScreen } from '../screens/citizen/ReportIssueScreen';
import { ReportSuccessScreen } from '../screens/citizen/ReportSuccessScreen';
import { NotificationsScreen } from '../screens/shared/NotificationsScreen';
import { ProfileScreen } from '../screens/shared/ProfileScreen';
import { useNotificationStore } from '../store/notificationStore';
import { colors, type IconName } from '../theme';
import type { CitizenStackParamList, CitizenTabParamList } from './types';

const Tabs = createBottomTabNavigator<CitizenTabParamList>();
const Stack = createNativeStackNavigator<CitizenStackParamList>();

const TAB_ICONS: Record<keyof CitizenTabParamList, [IconName, IconName]> = {
  Home: ['home', 'home-outline'],
  MyIssues: ['list', 'list-outline'],
  Map: ['map', 'map-outline'],
  Notifications: ['notifications', 'notifications-outline'],
  Profile: ['person-circle', 'person-circle-outline'],
};

function CitizenTabs() {
  const unread = useNotificationStore((s) => s.unread);
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSubtle,
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.background },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={TAB_ICONS[route.name][focused ? 0 : 1]} size={size} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="Home" component={CitizenHomeScreen} options={{ title: 'CivicEye', tabBarLabel: 'Home' }} />
      <Tabs.Screen name="MyIssues" component={MyIssuesScreen} options={{ title: 'My Issues' }} />
      <Tabs.Screen name="Map" component={MapScreen} options={{ title: 'Issue Map', tabBarLabel: 'Map' }} />
      <Tabs.Screen name="Notifications" options={{ title: 'Notifications', tabBarBadge: unread ? (unread > 99 ? '99+' : unread) : undefined }}>
        {({ navigation }) => <NotificationsScreen openIssue={(issueId) => navigation.navigate('IssueDetail', { issueId })} />}
      </Tabs.Screen>
      <Tabs.Screen name="Profile" options={{ title: 'Profile' }}>
        {({ navigation }) => <ProfileScreen onOpenPendingReports={() => navigation.navigate('PendingReports')} />}
      </Tabs.Screen>
    </Tabs.Navigator>
  );
}

export function CitizenNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{ headerTintColor: colors.primary, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerBackTitle: 'Back' }}
    >
      <Stack.Screen name="CitizenTabs" component={CitizenTabs} options={{ headerShown: false }} />
      <Stack.Screen name="ReportIssue" component={ReportIssueScreen} options={{ title: 'Report an issue' }} />
      <Stack.Screen name="ReportSuccess" component={ReportSuccessScreen} options={{ title: 'Report submitted', headerBackVisible: false, gestureEnabled: false }} />
      <Stack.Screen name="IssueDetail" component={IssueDetailScreen} options={{ title: 'Issue details' }} />
      <Stack.Screen name="PendingReports" component={PendingReportsScreen} options={{ title: 'Pending reports' }} />
    </Stack.Navigator>
  );
}

import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthorityLoginScreen } from '../screens/auth/AuthorityLoginScreen';
import { OnboardingScreen } from '../screens/auth/OnboardingScreen';
import { OtpVerifyScreen } from '../screens/auth/OtpVerifyScreen';
import { PhoneLoginScreen } from '../screens/auth/PhoneLoginScreen';
import { RoleSelectScreen } from '../screens/auth/RoleSelectScreen';
import { colors } from '../theme';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator({ showOnboarding }: { showOnboarding: boolean }) {
  return (
    <Stack.Navigator
      initialRouteName={showOnboarding ? 'Onboarding' : 'RoleSelect'}
      screenOptions={{ headerTintColor: colors.primary, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerBackTitle: 'Back' }}
    >
      <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
      <Stack.Screen name="RoleSelect" component={RoleSelectScreen} options={{ headerShown: false }} />
      <Stack.Screen name="PhoneLogin" component={PhoneLoginScreen} options={{ title: '' }} />
      <Stack.Screen name="OtpVerify" component={OtpVerifyScreen} options={{ title: 'Verify your number' }} />
      <Stack.Screen
        name="AuthorityLogin"
        component={AuthorityLoginScreen}
        options={{ title: '', headerTintColor: colors.authority }}
      />
    </Stack.Navigator>
  );
}

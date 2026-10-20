import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { APP_NAME } from '../../constants/config';
import type { AuthScreenProps } from '../../navigation/types';
import { colors, radius, shadow, spacing, typography, type IconName } from '../../theme';

function RoleCard({ icon, title, subtitle, color, background, onPress }: { icon: IconName; title: string; subtitle: string; color: string; background: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] }]}
    >
      <View style={[styles.cardIcon, { backgroundColor: background }]}>
        <Ionicons name={icon} size={34} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={typography.heading}>{title}</Text>
        <Text style={[typography.caption, { marginTop: 2 }]}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.textSubtle} />
    </Pressable>
  );
}

/**
 * Choosing a card only picks which sign-in screen to show. The backend decides the real role
 * after login, so this choice is never used as a security mechanism.
 */
export function RoleSelectScreen({ navigation }: AuthScreenProps<'RoleSelect'>) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="eye" size={40} color={colors.primary} />
        <Text style={styles.title}>Welcome to {APP_NAME}</Text>
        <Text style={[typography.caption, { textAlign: 'center' }]}>How would you like to continue?</Text>
      </View>
      <RoleCard
        icon="megaphone"
        title="Citizen"
        subtitle="Sign in with your mobile number to report and track issues"
        color={colors.primary}
        background={colors.primaryLight}
        onPress={() => navigation.navigate('PhoneLogin')}
      />
      <RoleCard
        icon="briefcase"
        title="Higher Authority"
        subtitle="Department officers — manage and resolve issues"
        color={colors.authority}
        background={colors.authorityLight}
        onPress={() => navigation.navigate('AuthorityLogin')}
      />
      <Text style={styles.note}>Authority accounts are created by your administrator.</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: spacing.xxl, gap: spacing.sm },
  title: { ...typography.title, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...shadow,
  },
  cardIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  note: { ...typography.small, textAlign: 'center', marginTop: spacing.md },
});

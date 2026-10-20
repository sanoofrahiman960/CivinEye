import { StyleSheet, View } from 'react-native';

import { Banner, Button } from '../../components/ui';
import type { AuthScreenProps } from '../../navigation/types';
import { colors, spacing } from '../../theme';
import { LoginForm } from './LoginForm';

export function AuthorityLoginScreen({ navigation }: AuthScreenProps<'AuthorityLogin'>) {
  return (
    <LoginForm
      title="Authority sign in"
      subtitle="For department officers, supervisors and administrators."
      icon="briefcase"
      accent={colors.authority}
      footer={
        <View style={styles.footer}>
          <Banner
            tone="info"
            message="Your username and password are created by your system administrator. Staff accounts cannot be created in the app."
          />
          <Button title="I'm a citizen" variant="ghost" onPress={() => navigation.replace('PhoneLogin')} compact />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: spacing.xl },
});

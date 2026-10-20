import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { toApiError } from '../../api/client';
import { Screen } from '../../components/Screen';
import { Banner, Button, TextField } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import { useAuthStore } from '../../store/authStore';
import { spacing, typography, type IconName } from '../../theme';
import { hasErrors, required, type Errors } from '../../utils/validation';

interface LoginFormProps {
  title: string;
  subtitle: string;
  icon: IconName;
  accent: string;
  footer?: ReactNode;
}

/** Username + password sign-in for authority staff. Accounts and passwords are set up by the administrator. */
export function LoginForm({ title, subtitle, icon, accent, footer }: LoginFormProps) {
  const login = useAuthStore((s) => s.login);
  const { busy, run } = useAction();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors<'username' | 'password'>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);

  async function submit() {
    const next = { username: required(username, 'Enter your username.'), password: required(password, 'Enter your password.') };
    setErrors(next);
    setFormError(null);
    if (hasErrors(next)) return;
    await run(async () => {
      try {
        await login(username, password);
        // RootNavigator switches to the authority app based on the role returned by the server.
      } catch (error) {
        const apiError = toApiError(error);
        setFormError(apiError.code === 'no_active_account' || apiError.status === 401 ? 'Incorrect username or password.' : apiError.message);
      }
    });
  }

  return (
    <Screen edges={['bottom']}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: `${accent}1A` }]}>
          <Ionicons name={icon} size={32} color={accent} />
        </View>
        <Text style={typography.title}>{title}</Text>
        <Text style={[typography.caption, { textAlign: 'center' }]}>{subtitle}</Text>
      </View>
      {formError ? <Banner tone="danger" message={formError} /> : null}
      <TextField
        label="Username"
        value={username}
        onChangeText={(v) => {
          setUsername(v);
          setErrors((e) => ({ ...e, username: undefined }));
        }}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        error={errors.username}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        value={password}
        onChangeText={(v) => {
          setPassword(v);
          setErrors((e) => ({ ...e, password: undefined }));
        }}
        secureToggle
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={errors.password}
      />
      <Button title="Sign in" icon="log-in-outline" onPress={submit} loading={busy} color={accent} />
      <Text style={styles.help}>Forgot your username or password? Ask your system administrator to reset it.</Text>
      {footer}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xl },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  help: { ...typography.small, textAlign: 'center', marginTop: spacing.md },
});

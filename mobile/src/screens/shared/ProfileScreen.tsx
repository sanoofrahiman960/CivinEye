import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { authApi } from '../../api/authApi';
import { toApiError } from '../../api/client';
import { Screen } from '../../components/Screen';
import { Button, Card, KeyValue, SectionHeader, TextField } from '../../components/ui';
import { API_URL, APP_NAME } from '../../constants/config';
import { useAction } from '../../hooks/useApi';
import { useAuthStore } from '../../store/authStore';
import { useOfflineStore } from '../../store/offlineStore';
import { colors, spacing, typography } from '../../theme';
import type { Role } from '../../types/api';
import { formatDate } from '../../utils/format';
import { unregisterPushNotifications } from '../../utils/push';
import {
  hasErrors,
  minLength,
  normalisePhone,
  validateEmail,
  validatePassword,
  validatePhone,
  validateUsername,
  type Errors,
} from '../../utils/validation';

type ProfileField = 'username' | 'email' | 'full_name' | 'phone_number';

const ROLE_LABELS: Record<Role, string> = {
  CITIZEN: 'Citizen',
  OFFICER: 'Department officer',
  SUPERVISOR: 'Department supervisor',
  ADMIN: 'System administrator',
};

export function ProfileScreen({ onOpenPendingReports }: { onOpenPendingReports?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const applyAuthResponse = useAuthStore((s) => s.applyAuthResponse);
  const logout = useAuthStore((s) => s.logout);
  const pending = useOfflineStore((s) => s.pending.length);

  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [phone, setPhone] = useState(user?.phone_number ?? '');
  const [profileErrors, setProfileErrors] = useState<Errors<ProfileField>>({});
  const saveProfile = useAction();

  const [changingPassword, setChangingPassword] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordErrors, setPasswordErrors] = useState<Errors<'current' | 'next'>>({});
  const savePassword = useAction();

  if (!user) return null;
  const isAuthority = user.is_authority;
  const accent = isAuthority ? colors.authority : colors.primary;

  function startEditing() {
    setUsername(user?.username ?? '');
    setEmail(user?.email ?? '');
    setFullName(user?.full_name ?? '');
    setPhone(user?.phone_number ?? '');
    setProfileErrors({});
    setEditing(true);
  }

  async function submitProfile() {
    const cleanedUsername = username.trim().toLowerCase();
    const cleanedEmail = email.trim().toLowerCase();
    // Staff log in with their username; a citizen's mobile number is their login, so only staff edit theirs here.
    const errors: Errors<ProfileField> = {
      username: isAuthority ? validateUsername(cleanedUsername) : undefined,
      email: cleanedEmail ? validateEmail(cleanedEmail) : undefined,
      full_name: minLength(fullName, 2, 'Enter your full name.'),
      phone_number: isAuthority && phone ? validatePhone(phone) : undefined,
    };
    setProfileErrors(errors);
    if (hasErrors(errors)) return;
    const usernameChanged = isAuthority && cleanedUsername !== user?.username;
    const emailChanged = cleanedEmail !== (user?.email ?? '');
    await saveProfile.run(async () => {
      try {
        const updated = await authApi.updateProfile({
          // Only send login details when they change, so unchanged values never trip the uniqueness check.
          ...(usernameChanged ? { username: cleanedUsername } : {}),
          ...(emailChanged ? { email: cleanedEmail } : {}),
          full_name: fullName.trim(),
          ...(isAuthority ? { phone_number: normalisePhone(phone) } : {}),
        });
        setUser(updated);
        setEditing(false);
        if (usernameChanged) Alert.alert('Username changed', `Sign in with "${updated.username}" from now on.`);
      } catch (error) {
        const apiError = toApiError(error);
        const fieldErrors: Errors<ProfileField> = {
          username: apiError.fieldError('username'),
          email: apiError.fieldError('email'),
          full_name: apiError.fieldError('full_name'),
          phone_number: apiError.fieldError('phone_number'),
        };
        setProfileErrors(fieldErrors);
        if (!hasErrors(fieldErrors)) Alert.alert('Could not save', apiError.message);
      }
    });
  }

  async function submitPassword() {
    const errors = { current: current ? undefined : 'Enter your current password.', next: validatePassword(next) };
    setPasswordErrors(errors);
    if (hasErrors(errors)) return;
    await savePassword.run(async () => {
      try {
        // The server revokes old sessions and returns fresh tokens for this device.
        await applyAuthResponse(await authApi.changePassword(current, next));
        setChangingPassword(false);
        setCurrent('');
        setNext('');
        Alert.alert('Password changed', 'Other devices have been signed out.');
      } catch (error) {
        const apiError = toApiError(error);
        setPasswordErrors({ current: apiError.fieldError('current_password'), next: apiError.fieldError('new_password') });
        if (!apiError.fieldError('current_password') && !apiError.fieldError('new_password')) Alert.alert('Could not change password', apiError.message);
      }
    });
  }

  function confirmLogout() {
    Alert.alert('Sign out?', pending ? `You have ${pending} report(s) waiting to be sent. They stay on this device.` : undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await unregisterPushNotifications();
          await logout();
        },
      },
    ]);
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: `${accent}1A` }]}>
          <Text style={[styles.initials, { color: accent }]}>
            {user.full_name
              .split(' ')
              .map((part) => part[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </Text>
        </View>
        <Text style={typography.title}>{user.full_name}</Text>
        <View style={[styles.rolePill, { backgroundColor: `${accent}1A` }]}>
          <Ionicons name={user.is_authority ? 'briefcase' : 'person'} size={14} color={accent} />
          <Text style={[styles.roleText, { color: accent }]}>{ROLE_LABELS[user.role]}</Text>
        </View>
      </View>

      <Card>
        {editing ? (
          <>
            {isAuthority ? (
              <TextField
                label="Username"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username"
                hint="Your login name: lowercase letters, digits, dots, hyphens or underscores."
                error={profileErrors.username}
              />
            ) : null}
            <TextField
              label="Email (optional)"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              error={profileErrors.email}
            />
            <TextField label="Full name" value={fullName} onChangeText={setFullName} error={profileErrors.full_name} />
            {user.is_authority ? (
              <TextField label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" error={profileErrors.phone_number} />
            ) : null}
            <View style={styles.row}>
              <Button title="Cancel" variant="outline" color={accent} onPress={() => setEditing(false)} style={{ flex: 1 }} />
              <Button title="Save" color={accent} onPress={submitProfile} loading={saveProfile.busy} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <>
            {user.username ? <KeyValue icon="person-outline" label="Username" value={user.username} /> : null}
            <KeyValue icon="call-outline" label={isAuthority ? 'Phone' : 'Mobile (login)'} value={user.phone_number || '—'} />
            <KeyValue icon="mail-outline" label="Email" value={user.email || '—'} />
            {user.department ? <KeyValue icon="business-outline" label="Department" value={user.department.name} /> : null}
            {isAuthority ? (
              <KeyValue
                icon="map-outline"
                label="Service areas"
                value={user.service_areas.map((a) => a.name).join(', ') || (user.role === 'ADMIN' ? 'All areas' : 'None — ask your administrator')}
              />
            ) : null}
            <KeyValue icon="calendar-outline" label="Member since" value={formatDate(user.date_joined)} />
            <Button title="Edit profile" icon="create-outline" variant="outline" color={accent} onPress={startEditing} style={{ marginTop: spacing.md }} compact />
          </>
        )}
      </Card>

      {!user.is_authority && onOpenPendingReports ? (
        <>
          <SectionHeader title="Offline reports" />
          <Card onPress={onOpenPendingReports} accessibilityLabel={`${pending} reports waiting to be sent`}>
            <View style={styles.row}>
              <Ionicons name="cloud-upload-outline" size={22} color={colors.primary} />
              <Text style={[typography.body, { flex: 1 }]}>{pending ? `${pending} report(s) waiting to be sent` : 'No reports waiting'}</Text>
              <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
            </View>
          </Card>
        </>
      ) : null}

      {user.is_authority ? (
        <>
      <SectionHeader title="Security" />
      <Card>
        {changingPassword ? (
          <>
            <TextField label="Current password" value={current} onChangeText={setCurrent} secureToggle error={passwordErrors.current} />
            <TextField label="New password" value={next} onChangeText={setNext} secureToggle error={passwordErrors.next} hint="At least 8 characters." />
            <View style={styles.row}>
              <Button title="Cancel" variant="outline" color={accent} onPress={() => setChangingPassword(false)} style={{ flex: 1 }} />
              <Button title="Update" color={accent} onPress={submitPassword} loading={savePassword.busy} style={{ flex: 1 }} />
            </View>
          </>
        ) : (
          <Button title="Change password" icon="key-outline" variant="outline" color={accent} onPress={() => setChangingPassword(true)} compact />
        )}
      </Card>
        </>
      ) : null}

      <Button title="Sign out" icon="log-out-outline" variant="danger" onPress={confirmLogout} style={{ marginTop: spacing.xl }} />
      <Text style={styles.footer}>
        {APP_NAME} · Server {API_URL}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 30, fontWeight: '800' },
  rolePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: 999 },
  roleText: { fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  footer: { ...typography.small, textAlign: 'center', marginTop: spacing.lg },
});

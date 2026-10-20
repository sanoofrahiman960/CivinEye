import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { authApi } from '../../api/authApi';
import { toApiError } from '../../api/client';
import { Screen } from '../../components/Screen';
import { Banner, Button } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import type { AuthScreenProps } from '../../navigation/types';
import { colors, radius, spacing, TOUCH_TARGET, typography } from '../../theme';

/** Shown in front of local numbers; the backend applies the same default (DEFAULT_COUNTRY_CODE). */
const COUNTRY_CODE = '+91';

/** What the backend will receive: an international number as typed, or the local number with the country code. */
export function toInternational(input: string): string {
  const cleaned = input.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  return `${COUNTRY_CODE}${cleaned.replace(/^0+/, '')}`;
}

export function validateMobile(input: string): string | undefined {
  const value = toInternational(input);
  if (!input.trim()) return 'Enter your mobile number.';
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return 'Enter a valid mobile number.';
  if (value.startsWith('+91') && value.length !== 13) return 'Indian mobile numbers have 10 digits.';
  return undefined;
}

/** Citizens sign in (and sign up) with their mobile number and a one-time SMS code — no password. */
export function PhoneLoginScreen({ navigation }: AuthScreenProps<'PhoneLogin'>) {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const { busy, run } = useAction();

  async function submit() {
    const validation = validateMobile(phone);
    setError(validation);
    setFormError(null);
    if (validation) return;
    await run(async () => {
      try {
        const result = await authApi.requestOtp(toInternational(phone));
        navigation.navigate('OtpVerify', {
          phoneNumber: result.phone_number,
          resendAfter: result.resend_after,
          message: result.detail,
          codeLength: result.code_length,
        });
      } catch (err) {
        const apiError = toApiError(err);
        if (apiError.code === 'otp_cooldown') {
          // A code was sent moments ago: go and enter it.
          const wait = Number(apiError.details.retry_after) || 60;
          navigation.navigate('OtpVerify', {
            phoneNumber: toInternational(phone),
            resendAfter: wait,
            message: 'We already sent you a code. Enter it below.',
            codeLength: Number(apiError.details.code_length) || 6,
          });
          return;
        }
        const field = apiError.fieldError('phone_number');
        if (field) setError(field);
        else setFormError(apiError.message);
      }
    });
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="phone-portrait-outline" size={32} color={colors.primary} />
        </View>
        <Text style={typography.title}>Sign in with your mobile</Text>
        <Text style={[typography.caption, { textAlign: 'center' }]}>
          We'll send you a one-time code by SMS. New here? The same steps create your account.
        </Text>
      </View>

      {formError ? <Banner tone="danger" message={formError} /> : null}

      <Text style={styles.label}>Mobile number</Text>
      <View style={[styles.inputRow, error ? { borderColor: colors.danger } : null]}>
        {!phone.trim().startsWith('+') ? (
          <Text style={styles.prefix} accessibilityLabel={`Country code ${COUNTRY_CODE}`}>
            {COUNTRY_CODE}
          </Text>
        ) : null}
        <TextInput
          value={phone}
          onChangeText={(value) => {
            setPhone(value);
            setError(undefined);
          }}
          placeholder="98123 45678"
          placeholderTextColor={colors.textSubtle}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          returnKeyType="send"
          onSubmitEditing={submit}
          maxLength={18}
          accessibilityLabel="Mobile number"
          accessibilityHint={error}
          style={styles.input}
          autoFocus
        />
      </View>
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : (
        <Text style={styles.hint}>For a number outside India, start with + and the country code.</Text>
      )}

      <Button title="Send code" icon="chatbubble-ellipses-outline" onPress={submit} loading={busy} style={{ marginTop: spacing.xl }} />
      <Text style={styles.terms}>Standard SMS rates may apply. Your number is only shared with officers handling your complaints.</Text>
      <Button title="I'm a department officer" variant="ghost" color={colors.authority} onPress={() => navigation.replace('AuthorityLogin')} compact />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xl },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  label: { ...typography.subheading, marginBottom: spacing.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  prefix: { fontSize: 18, fontWeight: '600', color: colors.textMuted, marginRight: spacing.sm },
  input: { flex: 1, minHeight: TOUCH_TARGET + 8, fontSize: 18, letterSpacing: 1, color: colors.text },
  hint: { ...typography.small, marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  terms: { ...typography.small, textAlign: 'center', marginVertical: spacing.lg },
});

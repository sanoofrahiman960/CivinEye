import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { authApi } from '../../api/authApi';
import { toApiError } from '../../api/client';
import { Screen } from '../../components/Screen';
import { Banner, Button, TextField } from '../../components/ui';
import { useAction } from '../../hooks/useApi';
import type { AuthScreenProps } from '../../navigation/types';
import { useAuthStore } from '../../store/authStore';
import { colors, radius, spacing, typography } from '../../theme';

/** Enter the SMS code. A brand-new number is asked for a name once, which creates the citizen account. */
export function OtpVerifyScreen({ navigation, route }: AuthScreenProps<'OtpVerify'>) {
  const { phoneNumber } = route.params;
  // 6 digits normally; 4 when the backend runs with a development test code.
  const CODE_LENGTH = route.params.codeLength || 6;
  const applyAuthResponse = useAuthStore((s) => s.applyAuthResponse);
  const [code, setCode] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [fullName, setFullName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(route.params.message);
  const [secondsLeft, setSecondsLeft] = useState(route.params.resendAfter);
  const verify = useAction();
  const resend = useAction();
  const codeInput = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  async function submit(currentCode = code) {
    if (currentCode.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the SMS.`);
      return;
    }
    if (needsName && fullName.trim().length < 2) {
      setNameError('Enter your full name.');
      return;
    }
    setError(null);
    await verify.run(async () => {
      try {
        const result = await authApi.verifyOtp(phoneNumber, currentCode, needsName ? fullName.trim() : undefined);
        if (result.status === 'name_required') {
          setNeedsName(true);
          setNotice('Welcome to CivicEye! Tell us your name to finish creating your account.');
          return;
        }
        // RootNavigator switches to the citizen app as soon as the session is stored.
        await applyAuthResponse(result);
      } catch (err) {
        const apiError = toApiError(err);
        setError(apiError.message);
        if (apiError.code === 'invalid_code') {
          setCode('');
          codeInput.current?.focus();
        }
      }
    });
  }

  async function resendCode() {
    await resend.run(async () => {
      try {
        const result = await authApi.requestOtp(phoneNumber);
        setSecondsLeft(result.resend_after);
        setNotice(result.detail);
        setError(null);
        setCode('');
        codeInput.current?.focus();
      } catch (err) {
        const apiError = toApiError(err);
        if (apiError.code === 'otp_cooldown') setSecondsLeft(Number(apiError.details.retry_after) || 60);
        setError(apiError.message);
      }
    });
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="keypad-outline" size={30} color={colors.primary} />
        </View>
        <Text style={typography.title}>Enter the code</Text>
        <Text style={[typography.caption, { textAlign: 'center' }]}>Sent by SMS to {phoneNumber}</Text>
      </View>

      {notice && !error ? <Banner tone={needsName ? 'success' : 'info'} message={notice} /> : null}
      {error ? <Banner tone="danger" message={error} /> : null}

      <Pressable onPress={() => codeInput.current?.focus()} accessibilityRole="none" style={styles.boxes}>
        {Array.from({ length: CODE_LENGTH }).map((_, index) => {
          const filled = index < code.length;
          const active = index === code.length && !needsName;
          return (
            <View key={index} style={[styles.box, filled && styles.boxFilled, active && styles.boxActive]} accessibilityElementsHidden>
              <Text style={styles.boxText}>{code[index] ?? ''}</Text>
            </View>
          );
        })}
      </Pressable>
      {/* One real input drives the boxes, so SMS autofill and paste work. */}
      <TextInput
        ref={codeInput}
        value={code}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
          setCode(digits);
          setError(null);
          if (digits.length === CODE_LENGTH && !needsName) submit(digits);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={CODE_LENGTH}
        autoFocus
        accessibilityLabel={`${CODE_LENGTH}-digit code`}
        style={styles.hiddenInput}
        editable={!verify.busy}
      />

      {needsName ? (
        <View style={{ marginTop: spacing.xl }}>
          <TextField
            label="Your full name"
            value={fullName}
            onChangeText={(value) => {
              setFullName(value);
              setNameError(undefined);
            }}
            autoComplete="name"
            textContentType="name"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => submit()}
            error={nameError}
            hint="Shown to officers handling your complaints."
            maxLength={150}
          />
        </View>
      ) : null}

      <Button
        title={needsName ? 'Create my account' : 'Verify and continue'}
        icon={needsName ? 'person-add-outline' : 'checkmark-circle-outline'}
        onPress={() => submit()}
        loading={verify.busy}
        style={{ marginTop: spacing.xl }}
      />

      <View style={styles.row}>
        <Button title="Change number" variant="ghost" onPress={() => navigation.goBack()} compact />
        <Button
          title={secondsLeft > 0 ? `Resend in ${secondsLeft}s` : 'Resend code'}
          variant="ghost"
          onPress={resendCode}
          disabled={secondsLeft > 0}
          loading={resend.busy}
          compact
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.sm, marginVertical: spacing.xl },
  icon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primaryLight },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm },
  box: {
    width: 46,
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: { borderColor: colors.primary },
  boxActive: { borderColor: colors.primary, borderWidth: 2.5 },
  boxText: { fontSize: 24, fontWeight: '700', color: colors.text },
  hiddenInput: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
});

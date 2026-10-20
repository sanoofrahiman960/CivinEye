import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme';
import { Button, TextField } from './ui';

interface ReasonModalProps {
  visible: boolean;
  title: string;
  message?: string;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  /** If true the text is required (minimum 3 characters). */
  required?: boolean;
  destructive?: boolean;
  busy?: boolean;
  error?: string | null;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}

/** Confirmation dialog that collects a reason — used for reopening, priority changes and closures. */
export function ReasonModal({
  visible,
  title,
  message,
  label = 'Reason',
  placeholder,
  confirmLabel,
  required = true,
  destructive,
  busy,
  error,
  children,
  onCancel,
  onConfirm,
}: ReasonModalProps) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | undefined>();

  useEffect(() => {
    if (visible) {
      setText('');
      setLocalError(undefined);
    }
  }, [visible]);

  function confirm() {
    if (required && text.trim().length < 3) {
      setLocalError('Please give a short reason (at least 3 characters).');
      return;
    }
    onConfirm(text.trim());
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={typography.heading} accessibilityRole="header">
              {title}
            </Text>
            {message ? <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.md }]}>{message}</Text> : null}
            <TextField
              label={required ? label : `${label} (optional)`}
              value={text}
              onChangeText={(value) => {
                setText(value);
                setLocalError(undefined);
              }}
              placeholder={placeholder}
              multiline
              maxLength={2000}
              error={localError ?? error ?? undefined}
            />
            {children}
            <View style={styles.actions}>
              <Button title="Cancel" variant="outline" onPress={onCancel} style={{ flex: 1 }} disabled={busy} />
              <Button
                title={confirmLabel}
                variant={destructive ? 'danger' : 'primary'}
                onPress={confirm}
                loading={busy}
                style={{ flex: 1 }}
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  sheet: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, maxHeight: '90%' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});

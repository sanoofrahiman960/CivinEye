import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { ApiError } from '../api/client';
import { colors, spacing, typography, type IconName } from '../theme';
import { Button } from './ui';

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={message}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[typography.caption, { marginTop: spacing.md }]}>{message}</Text>
    </View>
  );
}

export function EmptyState({
  icon = 'leaf-outline',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.center}>
      <View style={styles.iconCircle}>
        <Ionicons name={icon} size={36} color={colors.primary} />
      </View>
      <Text style={[typography.heading, styles.textCenter]}>{title}</Text>
      {message ? <Text style={[typography.caption, styles.textCenter, { marginTop: spacing.xs }]}>{message}</Text> : null}
      {action ? <Button title={action.label} onPress={action.onPress} style={{ marginTop: spacing.lg, alignSelf: 'stretch' }} /> : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  const offline = error?.isNetworkError;
  return (
    <View style={styles.center}>
      <View style={[styles.iconCircle, { backgroundColor: colors.dangerLight }]}>
        <Ionicons name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'} size={36} color={colors.danger} />
      </View>
      <Text style={[typography.heading, styles.textCenter]}>{offline ? "You're offline" : 'Something went wrong'}</Text>
      <Text style={[typography.caption, styles.textCenter, { marginTop: spacing.xs }]}>
        {error?.message ?? 'Please try again.'}
      </Text>
      {onRetry ? <Button title="Try again" icon="refresh" variant="outline" onPress={onRetry} style={{ marginTop: spacing.lg }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 260 },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  textCenter: { textAlign: 'center' },
});

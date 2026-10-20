import type { ReactNode } from 'react';
import { RefreshControl, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';
import { KeyboardAwareScroll } from './KeyboardAwareScroll';

interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
}

/** Standard screen container: safe area, keyboard-aware scroll and optional pull-to-refresh. */
export function Screen({ children, scroll = true, refreshing = false, onRefresh, edges = ['bottom'], contentStyle, footer }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {scroll ? (
        <KeyboardAwareScroll
          contentContainerStyle={[styles.content, contentStyle]}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
        >
          {children}
        </KeyboardAwareScroll>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  footer: {
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});

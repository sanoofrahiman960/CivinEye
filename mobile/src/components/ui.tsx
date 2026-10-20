/**
 * Small shared building blocks: buttons, text fields, cards, banners, chips and section headers.
 * Every interactive element has an accessibility role/label and a touch target of at least 44pt.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { colors, radius, shadow, spacing, TOUCH_TARGET, typography, type IconName } from '../theme';

// --- Button ------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  color?: string;
  compact?: boolean;
}

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, accessibilityHint, color, compact }: ButtonProps) {
  const isDisabled = disabled || loading;
  const base = color ?? colors.primary;
  const palette: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
    primary: { bg: base, fg: colors.textOnPrimary, border: base },
    secondary: { bg: colors.primaryLight, fg: colors.primaryDark, border: colors.primaryLight },
    outline: { bg: colors.surface, fg: base, border: base },
    danger: { bg: colors.danger, fg: colors.textOnPrimary, border: colors.danger },
    ghost: { bg: 'transparent', fg: base, border: 'transparent' },
  };
  const p = palette[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: p.bg, borderColor: p.border, opacity: isDisabled ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.buttonContent}>
          {icon ? <Ionicons name={icon} size={18} color={p.fg} /> : null}
          <Text style={[styles.buttonText, { color: p.fg }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color = colors.text, size = 22 }: { icon: IconName; label: string; onPress: () => void; color?: string; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

// --- Text field ------------------------------------------------------------------

interface TextFieldProps extends TextInputProps {
  ref?: Ref<ComponentRef<typeof TextInput>>;
  label: string;
  error?: string;
  hint?: string;
  secureToggle?: boolean;
}

export function TextField({ ref, label, error, hint, secureToggle, secureTextEntry, style, multiline, ...rest }: TextFieldProps) {
  const [hidden, setHidden] = useState(true);
  const secure = secureToggle ? hidden : secureTextEntry;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.inputWrap, error ? styles.inputError : null, multiline && styles.inputMultilineWrap]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.textSubtle}
          secureTextEntry={secure}
          multiline={multiline}
          style={[styles.input, multiline && styles.inputMultiline, style]}
          {...rest}
        />
        {secureToggle ? (
          <IconButton
            icon={hidden ? 'eye-outline' : 'eye-off-outline'}
            label={hidden ? 'Show password' : 'Hide password'}
            onPress={() => setHidden((h) => !h)}
            color={colors.textMuted}
          />
        ) : null}
      </View>
      {error ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
}

// --- Containers -----------------------------------------------------------------------

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.9 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={typography.heading} accessibilityRole="header">
        {title}
      </Text>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={10} style={styles.sectionActionTarget}>
          <Text style={styles.sectionAction}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export function Banner({ tone = 'info', title, message, icon, action }: { tone?: BannerTone; title?: string; message: string; icon?: IconName; action?: { label: string; onPress: () => void } }) {
  const tones: Record<BannerTone, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: colors.infoLight, fg: colors.info, icon: 'information-circle' },
    success: { bg: colors.successLight, fg: colors.success, icon: 'checkmark-circle' },
    warning: { bg: colors.warningLight, fg: colors.warning, icon: 'warning' },
    danger: { bg: colors.dangerLight, fg: colors.danger, icon: 'alert-circle' },
  };
  const t = tones[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole="alert">
      <Ionicons name={icon ?? t.icon} size={22} color={t.fg} />
      <View style={{ flex: 1 }}>
        {title ? <Text style={[styles.bannerTitle, { color: t.fg }]}>{title}</Text> : null}
        <Text style={[styles.bannerText, { color: colors.text }]}>{message}</Text>
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" accessibilityLabel={action.label} hitSlop={8} style={styles.bannerActionTarget}>
            <Text style={[styles.bannerAction, { color: t.fg }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// --- Chips ------------------------------------------------------------------------------

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
  icon?: IconName;
  color?: string;
}

export function ChipGroup<T extends string | number>({
  options,
  selected,
  onToggle,
  scrollable,
}: {
  options: ChipOption<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  scrollable?: boolean;
}) {
  return (
    <View style={[styles.chips, scrollable && { flexWrap: 'nowrap' }]}>
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onToggle(option.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            accessibilityLabel={option.label}
            style={[styles.chip, active && { backgroundColor: option.color ?? colors.primary, borderColor: option.color ?? colors.primary }]}
          >
            {option.icon ? <Ionicons name={option.icon} size={14} color={active ? colors.textOnPrimary : option.color ?? colors.textMuted} /> : null}
            <Text style={[styles.chipText, active && { color: colors.textOnPrimary }]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function KeyValue({ label, value, icon }: { label: string; value: ReactNode; icon?: IconName }) {
  return (
    <View style={styles.kv}>
      {icon ? <Ionicons name={icon} size={16} color={colors.textMuted} style={{ marginTop: 2 }} /> : null}
      <Text style={styles.kvLabel}>{label}</Text>
      <View style={{ flex: 1 }}>{typeof value === 'string' || typeof value === 'number' ? <Text style={styles.kvValue}>{value}</Text> : value}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH_TARGET + 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { minHeight: TOUCH_TARGET, paddingHorizontal: spacing.md },
  buttonContent: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  buttonText: { fontSize: 16, fontWeight: '600' },
  iconButton: { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  field: { marginBottom: spacing.lg },
  fieldLabel: { ...typography.subheading, marginBottom: spacing.xs },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingLeft: spacing.md,
  },
  inputMultilineWrap: { alignItems: 'flex-start' },
  inputError: { borderColor: colors.danger },
  input: { flex: 1, minHeight: TOUCH_TARGET + 4, fontSize: 16, color: colors.text, paddingRight: spacing.md },
  inputMultiline: { minHeight: 110, paddingTop: spacing.md, textAlignVertical: 'top' },
  errorText: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
  hintText: { ...typography.small, marginTop: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, ...shadow },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.md },
  sectionAction: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  sectionActionTarget: { minHeight: TOUCH_TARGET, justifyContent: 'center' },
  banner: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  bannerTitle: { fontWeight: '700', fontSize: 15, marginBottom: 2 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  bannerAction: { fontWeight: '700', fontSize: 14 },
  bannerActionTarget: { minHeight: TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  kv: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs + 2, alignItems: 'flex-start' },
  kvLabel: { ...typography.caption, width: 118 },
  kvValue: { fontSize: 14, color: colors.text, fontWeight: '500' },
});

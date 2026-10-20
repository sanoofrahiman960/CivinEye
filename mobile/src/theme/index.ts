import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';

import type { IssueStatus, Priority } from '../types/api';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export const colors = {
  primary: '#0F766E',
  primaryDark: '#115E59',
  primaryLight: '#CCFBF1',
  authority: '#1E3A8A',
  authorityLight: '#DBEAFE',
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5F9',
  text: '#0F172A',
  textMuted: '#475569',
  textSubtle: '#64748B',
  textOnPrimary: '#FFFFFF',
  border: '#E2E8F0',
  borderStrong: '#CBD5E1',
  danger: '#B91C1C',
  dangerLight: '#FEE2E2',
  success: '#15803D',
  successLight: '#DCFCE7',
  warning: '#B45309',
  warningLight: '#FEF3C7',
  info: '#1D4ED8',
  infoLight: '#DBEAFE',
  overlay: 'rgba(15, 23, 42, 0.55)',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };

export const typography = {
  title: { fontSize: 24, fontWeight: '700' as const, color: colors.text },
  heading: { fontSize: 18, fontWeight: '700' as const, color: colors.text },
  subheading: { fontSize: 15, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  caption: { fontSize: 13, color: colors.textMuted },
  small: { fontSize: 12, color: colors.textSubtle },
};

/** Minimum accessible touch target (points). */
export const TOUCH_TARGET = 44;

export const shadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
};

type BadgeStyle = { label: string; color: string; background: string; text: string; icon: IconName };

/** Priority is never shown by colour alone: every badge has a label and an icon. */
export const PRIORITY_STYLES: Record<Priority, BadgeStyle> = {
  CRITICAL: { label: 'Critical', color: '#DC2626', background: '#FEE2E2', text: '#991B1B', icon: 'alert-circle' },
  HIGH: { label: 'High', color: '#EA580C', background: '#FFEDD5', text: '#9A3412', icon: 'arrow-up-circle' },
  MEDIUM: { label: 'Medium', color: '#CA8A04', background: '#FEF9C3', text: '#854D0E', icon: 'remove-circle' },
  LOW: { label: 'Low', color: '#16A34A', background: '#DCFCE7', text: '#166534', icon: 'arrow-down-circle' },
  UNCLASSIFIED: { label: 'Unclassified', color: '#6B7280', background: '#F3F4F6', text: '#374151', icon: 'help-circle' },
};

export const STATUS_STYLES: Record<IssueStatus, BadgeStyle & { longLabel: string }> = {
  SUBMITTED: { label: 'Submitted', longLabel: 'Submitted', color: '#2563EB', background: '#DBEAFE', text: '#1E40AF', icon: 'paper-plane' },
  ACKNOWLEDGED: { label: 'Acknowledged', longLabel: 'Acknowledged', color: '#4F46E5', background: '#E0E7FF', text: '#3730A3', icon: 'eye' },
  IN_PROGRESS: { label: 'In Progress', longLabel: 'In Progress', color: '#D97706', background: '#FEF3C7', text: '#92400E', icon: 'construct' },
  RESOLVED: {
    label: 'Resolved – Verify',
    longLabel: 'Resolved — Awaiting Citizen Verification',
    color: '#0D9488',
    background: '#CCFBF1',
    text: '#115E59',
    icon: 'shield-checkmark',
  },
  CLOSED: { label: 'Closed', longLabel: 'Closed', color: '#15803D', background: '#DCFCE7', text: '#166534', icon: 'checkmark-done-circle' },
  REOPENED: { label: 'Reopened', longLabel: 'Reopened', color: '#BE185D', background: '#FCE7F3', text: '#9D174D', icon: 'refresh-circle' },
};

export const PRIORITY_ORDER: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNCLASSIFIED'];
export const STATUS_ORDER: IssueStatus[] = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];

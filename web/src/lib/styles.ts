import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCheck,
  Eye,
  HelpCircle,
  MinusCircle,
  RefreshCcw,
  Send,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

import type { IssueStatus, Priority } from '../types/api';

type BadgeStyle = { label: string; color: string; background: string; text: string; icon: LucideIcon };

/** Priority is always shown with a label and icon, never colour alone. */
export const PRIORITY_STYLES: Record<Priority, BadgeStyle> = {
  CRITICAL: { label: 'Critical', color: '#DC2626', background: '#FEE2E2', text: '#991B1B', icon: AlertCircle },
  HIGH: { label: 'High', color: '#EA580C', background: '#FFEDD5', text: '#9A3412', icon: ArrowUpCircle },
  MEDIUM: { label: 'Medium', color: '#CA8A04', background: '#FEF9C3', text: '#854D0E', icon: MinusCircle },
  LOW: { label: 'Low', color: '#16A34A', background: '#DCFCE7', text: '#166534', icon: ArrowDownCircle },
  UNCLASSIFIED: { label: 'Unclassified', color: '#6B7280', background: '#F3F4F6', text: '#374151', icon: HelpCircle },
};

export const STATUS_STYLES: Record<IssueStatus, BadgeStyle & { longLabel: string }> = {
  SUBMITTED: { label: 'Submitted', longLabel: 'Submitted', color: '#2563EB', background: '#DBEAFE', text: '#1E40AF', icon: Send },
  ACKNOWLEDGED: { label: 'Acknowledged', longLabel: 'Acknowledged', color: '#4F46E5', background: '#E0E7FF', text: '#3730A3', icon: Eye },
  IN_PROGRESS: { label: 'In Progress', longLabel: 'In Progress', color: '#D97706', background: '#FEF3C7', text: '#92400E', icon: Wrench },
  RESOLVED: {
    label: 'Awaiting verification',
    longLabel: 'Resolved — Awaiting Citizen Verification',
    color: '#0D9488',
    background: '#CCFBF1',
    text: '#115E59',
    icon: ShieldCheck,
  },
  CLOSED: { label: 'Closed', longLabel: 'Closed', color: '#15803D', background: '#DCFCE7', text: '#166534', icon: CheckCheck },
  REOPENED: { label: 'Reopened', longLabel: 'Reopened', color: '#BE185D', background: '#FCE7F3', text: '#9D174D', icon: RefreshCcw },
};

export const PRIORITY_ORDER: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNCLASSIFIED'];
export const STATUS_ORDER: IssueStatus[] = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];

export const ROLE_LABELS = {
  CITIZEN: 'Citizen',
  OFFICER: 'Department officer',
  SUPERVISOR: 'Department supervisor',
  ADMIN: 'System administrator',
} as const;

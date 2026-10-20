import { Clock, Users } from 'lucide-react';

import { PRIORITY_STYLES, STATUS_STYLES } from '../lib/styles';
import type { IssueStatus, Priority } from '../types/api';

export function PriorityBadge({ priority }: { priority: Priority }) {
  const s = PRIORITY_STYLES[priority];
  const Icon = s.icon;
  return (
    <span className="badge" style={{ background: s.background, color: s.text, borderColor: s.color }} title={`Priority: ${s.label}`}>
      <Icon size={12} color={s.color} aria-hidden />
      {s.label}
    </span>
  );
}

export function StatusBadge({ status, long }: { status: IssueStatus; long?: boolean }) {
  const s = STATUS_STYLES[status];
  const Icon = s.icon;
  return (
    <span className="badge" style={{ background: s.background, color: s.text }} title={`Status: ${s.longLabel}`}>
      <Icon size={12} color={s.color} aria-hidden />
      {long ? s.longLabel : s.label}
    </span>
  );
}

export function OverdueBadge() {
  return (
    <span className="badge badge-danger">
      <Clock size={12} aria-hidden />
      Overdue
    </span>
  );
}

export function ImpactBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="badge badge-neutral" title={`${count} other citizens said this affects them too`}>
      <Users size={12} aria-hidden />+{count}
    </span>
  );
}

import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, STATUS_STYLES, typography } from '../theme';
import type { ClosureType, IssueStatus } from '../types/api';
import { formatDateTime } from '../utils/format';

export interface TimelineEntry {
  id: number;
  new_status: IssueStatus;
  created_at: string;
  reason?: string;
  actor_label?: string;
  closure_type?: ClosureType;
}

const CLOSURE_TEXT: Record<Exclude<ClosureType, ''>, string> = {
  CITIZEN_CONFIRMED: 'Confirmed fixed by the reporter',
  AUTO_TIMEOUT: 'Closed automatically — not confirmed by the reporter',
  ADMIN_CLOSED: 'Closed by an administrator',
};

const LIFECYCLE: IssueStatus[] = ['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

/** Compact progress line: Reported → Acknowledged → In Progress → Resolved → Closed. */
export function LifecycleProgress({ status }: { status: IssueStatus }) {
  const current = status === 'REOPENED' ? 0 : LIFECYCLE.indexOf(status);
  return (
    <View style={styles.progress} accessible accessibilityLabel={`Progress: ${STATUS_STYLES[status].longLabel}`}>
      {LIFECYCLE.map((step, index) => {
        const done = index <= current;
        const style = STATUS_STYLES[step];
        return (
          <View key={step} style={styles.step}>
            <View style={[styles.stepDot, done && { backgroundColor: style.color, borderColor: style.color }]}>
              {done ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}
            </View>
            <Text style={[styles.stepLabel, done && { color: colors.text, fontWeight: '700' }]} numberOfLines={2}>
              {step === 'SUBMITTED' ? 'Reported' : step === 'RESOLVED' ? 'Resolved' : style.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Full status history, newest last. Every transition is preserved. */
export function StatusTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <View>
      {entries.map((entry, index) => {
        const style = STATUS_STYLES[entry.new_status];
        const last = index === entries.length - 1;
        return (
          <View key={entry.id} style={styles.row}>
            <View style={styles.rail}>
              <View style={[styles.dot, { backgroundColor: style.color }]}>
                <Ionicons name={style.icon} size={14} color="#fff" />
              </View>
              {!last ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.content}>
              <Text style={typography.subheading}>{style.longLabel}</Text>
              <Text style={typography.small}>
                {formatDateTime(entry.created_at)}
                {entry.actor_label ? ` · ${entry.actor_label}` : ''}
              </Text>
              {entry.closure_type ? <Text style={styles.closure}>{CLOSURE_TEXT[entry.closure_type]}</Text> : null}
              {entry.reason ? <Text style={styles.reason}>{entry.reason}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: spacing.sm },
  step: { flex: 1, alignItems: 'center' },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  stepLabel: { fontSize: 11, color: colors.textSubtle, textAlign: 'center', marginTop: 4 },
  row: { flexDirection: 'row', gap: spacing.md },
  rail: { alignItems: 'center', width: 28 },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  content: { flex: 1, paddingBottom: spacing.lg },
  closure: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginTop: 2 },
  reason: { ...typography.body, fontSize: 14, marginTop: spacing.xs, color: colors.textMuted },
});

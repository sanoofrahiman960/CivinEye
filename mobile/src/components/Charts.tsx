import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography, type IconName } from '../theme';
import { Card } from './ui';

export function KpiCard({ label, value, icon, color = colors.authority, onPress }: { label: string; value: number | string; icon: IconName; color?: string; onPress?: () => void }) {
  return (
    <Card style={styles.kpi} onPress={onPress} accessibilityLabel={`${label}: ${value}`}>
      <View style={[styles.kpiIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel} numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/** Horizontal bars with the value written next to each bar (readable without colour). */
export function BarChart({ data, emptyText = 'No data yet' }: { data: BarDatum[]; emptyText?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.some((d) => d.value > 0)) return <Text style={typography.caption}>{emptyText}</Text>;
  return (
    <View style={{ gap: spacing.sm }}>
      {data.map((d) => (
        <View key={d.label} accessible accessibilityLabel={`${d.label}: ${d.value}`}>
          <View style={styles.barHeader}>
            <Text style={styles.barLabel} numberOfLines={1}>
              {d.label}
            </Text>
            <Text style={styles.barValue}>{d.value}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.bar, { width: `${(d.value / max) * 100}%`, backgroundColor: d.color ?? colors.authority }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Paired columns for reported vs resolved per period. */
export function TrendChart({ points }: { points: { label: string; reported: number; resolved: number }[] }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.reported, p.resolved]));
  return (
    <View>
      <View style={styles.trend}>
        {points.map((p) => (
          <View
            key={p.label}
            style={styles.trendCol}
            accessible
            accessibilityLabel={`${p.label}: ${p.reported} reported, ${p.resolved} resolved`}
          >
            <View style={styles.trendBars}>
              <View style={[styles.trendBar, { height: `${(p.reported / max) * 100}%`, backgroundColor: colors.authority }]} />
              <View style={[styles.trendBar, { height: `${(p.resolved / max) * 100}%`, backgroundColor: colors.success }]} />
            </View>
            <Text style={styles.trendLabel} numberOfLines={1}>
              {p.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        <LegendItem color={colors.authority} label="Reported" />
        <LegendItem color={colors.success} label="Resolved" />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Text style={typography.small}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kpi: { flexBasis: '47%', flexGrow: 1, padding: spacing.md },
  kpiIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  kpiValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  kpiLabel: { ...typography.caption, marginTop: 2 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barLabel: { ...typography.caption, color: colors.text, flex: 1, marginRight: spacing.sm },
  barValue: { fontSize: 13, fontWeight: '700', color: colors.text },
  track: { height: 10, backgroundColor: colors.surfaceMuted, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: radius.pill },
  trend: { flexDirection: 'row', alignItems: 'flex-end', height: 150, gap: spacing.xs },
  trendCol: { flex: 1, alignItems: 'center', height: '100%' },
  trendBars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 2, width: '100%', justifyContent: 'center' },
  trendBar: { width: '35%', borderTopLeftRadius: 3, borderTopRightRadius: 3, minHeight: 2 },
  trendLabel: { fontSize: 10, color: colors.textSubtle, marginTop: 4 },
  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
});

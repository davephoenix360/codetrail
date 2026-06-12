/**
 * Weekly chart — 7 bars, one per day, oldest left → today right.
 *
 * Today's bar is highlighted in the brand blue. Days with 0 commits
 * are a flat muted color. The chart scales relative to the max count
 * in the window so a single big day doesn't dwarf the others.
 *
 * Tapping a bar could (v2.0) show a tooltip with the exact count. For
 * MVP, the count is shown as a small label above the bar.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import type { DailyCommitCount } from '@/lib/streak';
import { Spacing } from '@/constants/theme';

interface Props {
  weekly: DailyCommitCount[];
  /** IANA timezone — used for the day-letter labels (M, T, W…). */
  timeZone?: string;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday=0, per JS Date.getDay()
const BAR_HEIGHT_MAX = 56;
const BAR_HEIGHT_MIN = 4;

function dayLetter(dateKey: string, timeZone?: string): string {
  // Parse "YYYY-MM-DD" as noon UTC to avoid TZ shifts
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // Convert to the user's timezone before getting the day-of-week
  const localDay = new Date(
    dt.toLocaleString('en-US', { timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }),
  );
  return DAY_LETTERS[localDay.getDay()];
}

export function WeeklyChart({ weekly, timeZone }: Props) {
  if (weekly.length === 0) return null;
  const maxCount = Math.max(1, ...weekly.map((d) => d.count));
  const todayKey = weekly[weekly.length - 1]?.date;

  return (
    <View style={styles.container}>
      {weekly.map((d) => {
        const height =
          d.count === 0
            ? BAR_HEIGHT_MIN
            : BAR_HEIGHT_MIN + ((d.count / maxCount) * (BAR_HEIGHT_MAX - BAR_HEIGHT_MIN));
        const isToday = d.date === todayKey;
        const hasCommits = d.count > 0;

        return (
          <View key={d.date} style={styles.barColumn}>
            <ThemedText type="small" style={[styles.count, !hasCommits && styles.countMuted]}>
              {hasCommits ? d.count : ''}
            </ThemedText>
            <View
              style={[
                styles.bar,
                {
                  height,
                  backgroundColor: isToday
                    ? '#208AEF'
                    : hasCommits
                      ? '#30363d'
                      : '#21262d',
                },
              ]}
            />
            <ThemedText type="small" style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
              {dayLetter(d.date, timeZone)}
            </ThemedText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    backgroundColor: '#161b22',
    borderRadius: 12,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.one,
  },
  count: {
    fontSize: 11,
    color: '#8b949e',
    minHeight: 14,
  },
  countMuted: {
    color: 'transparent',
  },
  bar: {
    width: '60%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  dayLabel: {
    fontSize: 11,
    color: '#8b949e',
  },
  dayLabelToday: {
    color: '#208AEF',
    fontWeight: '700',
  },
});

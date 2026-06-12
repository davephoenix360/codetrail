/**
 * Weekly chart — 7 bars, one per day, oldest left → today right.
 *
 * Coloring:
 *   - Today: brand blue, regardless of count
 *   - Streak days (the most recent N days with ≥1 commit, where N = streak):
 *     a brighter "active" gray to highlight the run
 *   - Other days with commits: muted gray
 *   - Empty days: very dark
 *
 * The streak highlighting makes the visual match the headline — you can
 * SEE the streak. Tapping a bar could (v2.0) show a tooltip; for MVP,
 * the count is shown as a small label above the bar.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import type { DailyCommitCount } from '@/lib/streak';
import { Spacing } from '@/constants/theme';

interface Props {
  weekly: DailyCommitCount[];
  /** Number of consecutive days ending today (or yesterday) with commits.
   *  Used to color the streak days differently. */
  streakLength: number;
  /** IANA timezone — used for the day-letter labels (M, T, W…). */
  timeZone?: string;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday=0, per JS Date.getDay()
const BAR_HEIGHT_MAX = 56;
const BAR_HEIGHT_MIN = 4;

function dayLetter(dateKey: string, timeZone?: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const localDay = new Date(
    dt.toLocaleString('en-US', { timeZone: timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone }),
  );
  return DAY_LETTERS[localDay.getDay()];
}

export function WeeklyChart({ weekly, streakLength, timeZone }: Props) {
  if (weekly.length === 0) return null;
  const maxCount = Math.max(1, ...weekly.map((d) => d.count));
  const todayKey = weekly[weekly.length - 1]?.date;

  // The streak occupies the last `streakLength` days of `weekly`, but ONLY
  // the days that actually have commits. If streakLength=3 and the last
  // 3 days had commits, those 3 bars are colored as streak. If the streak
  // ended 2 days ago (so today + yesterday are empty but 3-5 days ago had
  // commits), the streak days are 3-5.
  //
  // Walk from the right, counting days with ≥1 commit, until we've found
  // `streakLength` of them.
  const isStreakDay = new Set<string>();
  let remaining = streakLength;
  for (let i = weekly.length - 1; i >= 0 && remaining > 0; i--) {
    if (weekly[i].count > 0) {
      isStreakDay.add(weekly[i].date);
      remaining--;
    }
  }

  return (
    <View style={styles.container}>
      {weekly.map((d) => {
        const height =
          d.count === 0
            ? BAR_HEIGHT_MIN
            : BAR_HEIGHT_MIN + ((d.count / maxCount) * (BAR_HEIGHT_MAX - BAR_HEIGHT_MIN));
        const isToday = d.date === todayKey;
        const hasCommits = d.count > 0;
        const isStreak = isStreakDay.has(d.date);

        const barColor = isToday
          ? '#208AEF' // brand blue — today is always highlighted
          : isStreak
            ? '#4d8de3' // brighter blue — streak days
            : hasCommits
              ? '#30363d' // gray — non-streak days with commits
              : '#21262d'; // dark — empty days

        return (
          <View key={d.date} style={styles.barColumn}>
            <ThemedText type="small" style={[styles.count, !hasCommits && styles.countMuted]}>
              {hasCommits ? d.count : ''}
            </ThemedText>
            <View style={[styles.bar, { height, backgroundColor: barColor }]} />
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

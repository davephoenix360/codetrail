/**
 * WeeklyChart — 7 bars, one per day, oldest left → today right.
 *
 * Coloring matches the design draft:
 *   - 0 commits → empty dark
 *   - 1-2 commits → bar1 (faintest green)
 *   - 3-5 commits → bar2
 *   - 6-9 commits → bar3
 *   - 10+ commits → bar4 (brightest green)
 *   - Today → always highlighted with a blue ring
 *   - Streak days → a slightly different blue to mark the run
 *
 * GitHub's green scale is intentionally familiar to devs. The blue
 * ring on today is the brand accent.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import type { DailyCommitCount } from '@/lib/streak';
import { Colors, Radius, Spacing } from '@/constants/theme';

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

/** Map a commit count to a color tier (0 = empty, 4 = brightest). */
function countTier(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

export function WeeklyChart({ weekly, streakLength, timeZone }: Props) {
  if (weekly.length === 0) return null;
  const maxCount = Math.max(1, ...weekly.map((d) => d.count));
  const todayKey = weekly[weekly.length - 1]?.date;

  // Walk from the right, counting days with ≥1 commit, until we've
  // found `streakLength` of them. These get the "streak" treatment.
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
        const tier = countTier(d.count);
        const isStreak = isStreakDay.has(d.date);

        // Bar color: today > streak (overrides) > tier color > empty
        const barColor = isStreak
          ? Colors.dark.barStreak
          : isToday
            ? Colors.dark.barToday
            : tier === 0
              ? Colors.dark.barEmpty
              : tier === 1
                ? Colors.dark.bar1
                : tier === 2
                  ? Colors.dark.bar2
                  : tier === 3
                    ? Colors.dark.bar3
                    : Colors.dark.bar4;

        return (
          <View key={d.date} style={styles.barColumn}>
            <ThemedText type="tiny" style={[styles.count, d.count === 0 && styles.countMuted]}>
              {d.count > 0 ? d.count : ''}
            </ThemedText>
            <View
              style={[
                styles.bar,
                { height, backgroundColor: barColor },
                isToday && styles.barToday,
              ]}
            />
            <ThemedText type="tiny" style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
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
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    backgroundColor: Colors.dark.raised,
    borderRadius: Radius.card,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.one,
  },
  count: {
    color: Colors.dark.muted,
    minHeight: 14,
    textAlign: 'center',
  },
  countMuted: {
    color: 'transparent',
  },
  bar: {
    width: '60%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  barToday: {
    borderWidth: 2,
    borderColor: Colors.dark.accent,
    borderRadius: 4,
  },
  dayLabel: { color: Colors.dark.faint, textAlign: 'center' },
  dayLabelToday: { color: Colors.dark.accent, fontWeight: '700' },
});

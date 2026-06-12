/**
 * StreakSection — the personal dashboard shown above the tracked repos.
 *
 * Renders one of four states:
 *   1. Loading: muted "Loading your streak..." line
 *   2. Ready: big streak number + status line + weekly summary + chart
 *   3. Error: soft "couldn't load" line
 *   4. Idle (no repos tracked): CTA to track a project
 *
 * The streak number is the FOCAL POINT — it's the largest text on the
 * card. The chart is visual context, not the primary signal.
 *
 * Hype-man voice throughout. No shame, no comparison-bait.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { WeeklyChart } from './weekly-chart';
import {
  formatStreakLine,
  formatStreakSubline,
  formatWeeklyLine,
  type StreakResult,
} from '@/lib/streak';
import { Spacing } from '@/constants/theme';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: StreakResult }
  | { status: 'error'; message: string };

interface Props {
  state: State;
  /** True if the user has no tracked repos yet. Shows a different empty state. */
  noTrackedRepos: boolean;
}

export function StreakSection({ state, noTrackedRepos }: Props) {
  // Different empty state for "no repos tracked" — softer, no chart.
  if (noTrackedRepos && state.status !== 'ready') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.muted}>
          Your streak starts here
        </ThemedText>
        <ThemedText type="small" style={styles.muted}>
          Track a project to see your commit activity. Even a README counts.
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.muted}>
          Loading your streak…
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.muted}>
          Hmm, we could not load your streak right now.
        </ThemedText>
        <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
          {state.message}
        </ThemedText>
      </View>
    );
  }

  // Ready
  const { streak, shippedToday, weekly, daysSinceLastShip, forgotToPushHint } = state.data;
  const totalThisWeek = weekly.reduce((sum, d) => sum + d.count, 0);
  const headline = formatStreakLine(streak, shippedToday, daysSinceLastShip);
  const subline = formatStreakSubline(streak, shippedToday, forgotToPushHint);

  return (
    <View style={styles.card}>
      {/* Headline: the streak itself. The "🔥" emoji can be the visual hook
          and the number does the talking. */}
      <ThemedText type="title" style={styles.headline}>
        {headline}
      </ThemedText>
      <ThemedText type="default" style={styles.subline}>
        {subline}
      </ThemedText>

      <View style={styles.divider} />

      <ThemedText type="default" style={styles.weekly}>
        {formatWeeklyLine(totalThisWeek)}
      </ThemedText>
      <View style={styles.chartSpacer} />
      <WeeklyChart weekly={weekly} streakLength={streak} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0d1117',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    padding: Spacing.four,
    gap: Spacing.two,
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  subline: {
    fontSize: 14,
    color: '#8b949e',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#21262d',
    marginVertical: Spacing.two,
  },
  weekly: {
    fontSize: 14,
    color: '#8b949e',
  },
  muted: {
    color: '#8b949e',
  },
  spacedTop: {
    marginTop: Spacing.two,
  },
  chartSpacer: {
    height: Spacing.three,
  },
});

/**
 * StreakSection — the personal dashboard shown above the tracked repos.
 *
 * Renders one of four states:
 *   1. Loading: skeleton (just a muted text label)
 *   2. Ready: streak line + weekly summary + chart
 *   3. Error: shows a soft "couldn't load your streak" line, no chart
 *   4. Idle (no repos tracked): CTA to track a project
 *
 * Hype-man voice throughout. No shame, no comparison-bait.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { WeeklyChart } from './weekly-chart';
import {
  formatStreakLine,
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
        <ThemedText type="subtitle" style={styles.heading}>
          Your streak starts here
        </ThemedText>
        <ThemedText type="default" style={styles.muted}>
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
  const { streak, shippedToday, weekly } = state.data;
  const totalThisWeek = weekly.reduce((sum, d) => sum + d.count, 0);

  return (
    <View style={styles.card}>
      <ThemedText type="subtitle" style={styles.heading}>
        {formatStreakLine(streak, shippedToday)}
      </ThemedText>
      <ThemedText type="default" style={styles.muted}>
        {formatWeeklyLine(totalThisWeek)}
      </ThemedText>
      <View style={styles.chartSpacer} />
      <WeeklyChart weekly={weekly} />
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
    gap: Spacing.one,
  },
  heading: {
    fontSize: 20,
    lineHeight: 26,
  },
  muted: {
    color: '#8b949e',
    opacity: 1, // override the default 0.7 — we want these readable
  },
  spacedTop: {
    marginTop: Spacing.two,
  },
  chartSpacer: {
    height: Spacing.three,
  },
});

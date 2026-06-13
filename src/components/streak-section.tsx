/**
 * StreakSection — the personal dashboard shown above the tracked repos.
 *
 * Renders one of five states:
 *   1. noTrackedRepos  → "Welcome to CodeTrail ✨" with CTA
 *   2. loading         → skeleton bars
 *   3. error           → red-soft error card with retry copy
 *   4. ready           → the full streak card:
 *        • big flame + number + "day streak" label
 *        • meta row: commits today + last shipped
 *        • weekly chart (7 bars)
 *        • optional grace-period hint ("Ship today to keep the run")
 *        • share button (subtle, right-aligned)
 *
 * The streak number is the FOCAL POINT — biggest text on the card,
 * fire-gradient color, drop-shadow glow. The chart is visual context.
 *
 * Hype-man voice throughout. No shame, no comparison-bait. See
 * `~/.hermes/skills/creative/codetrail-design/references/copy-bank.md`.
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { WeeklyChart } from './weekly-chart';
import {
  formatStreakLine,
  formatStreakSubline,
  type StreakResult,
} from '@/lib/streak';
import { Colors, Radius, Spacing } from '@/constants/theme';

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: StreakResult }
  | { status: 'error'; message: string };

interface Props {
  state: State;
  /** True if the user has no tracked repos yet. Shows a different empty state. */
  noTrackedRepos: boolean;
  /** Fires the system share sheet with the streak card. Only shown in 'ready'. */
  onShare?: () => void;
}

export function StreakSection({ state, noTrackedRepos, onShare }: Props) {
  // ---- New user (no repos tracked) — hype-man welcome with CTA ----
  if (noTrackedRepos && state.status !== 'ready') {
    return (
      <View style={styles.card}>
        <ThemedText style={styles.welcomeEmoji} accessibilityElementsHidden>
          ✨
        </ThemedText>
        <ThemedText type="h2" style={styles.welcomeHeading}>
          Welcome to CodeTrail
        </ThemedText>
        <ThemedText type="small" style={styles.welcomeSub}>
          Pick the repos you want us to watch. We'll show you the streak, the week, and what your friends are shipping.
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <View style={styles.card}>
        <View style={styles.headline}>
          <View style={[styles.iconBubble, styles.skeletonBubble]} />
          <View>
            <View style={styles.skeletonNumber} />
            <View style={styles.skeletonLabel} />
          </View>
        </View>
        <ThemedText type="small" style={styles.muted}>
          Counting your commits… 🔥
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.card, styles.errorCard]}>
        <View style={styles.errorRow}>
          <View style={styles.errorDot} />
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" style={styles.errorTitle}>
              Couldn't load your streak
            </ThemedText>
            <ThemedText type="small" style={styles.errorMsg}>
              {state.message}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  // ---- Ready: the full streak card ----
  const {
    streak,
    shippedToday,
    weekly,
    totalCommits,
    daysSinceLastShip,
    forgotToPushHint,
  } = state.data;
  const commitsToday = weekly.length > 0 ? weekly[weekly.length - 1]!.count : 0;

  // Subline copy (the second line under the number). Use the new
  // shorter forms: "Ship today to keep the streak" / "Welcome back 💪"
  // / etc. See copy-bank.md.
  const subline = formatStreakSubline(streak, shippedToday, forgotToPushHint);

  // "Last shipped" — reuse the formatter's relative phrasing.
  const lastShippedLine = formatStreakLine(streak, shippedToday, daysSinceLastShip);

  // Grace period hint: show when in grace (1-2 days) but streak still alive.
  const inGrace =
    streak > 0 && daysSinceLastShip !== null && daysSinceLastShip >= 1 && daysSinceLastShip <= 2;

  return (
    <View style={styles.card}>
      {/* Headline: the flame + the number + the label */}
      <View style={styles.headline}>
        <ThemedText style={styles.flame} accessibilityElementsHidden>
          🔥
        </ThemedText>
        <View>
          <ThemedText style={styles.streakNumber}>{streak}</ThemedText>
          <ThemedText type="small" style={styles.streakLabel}>
            day streak
          </ThemedText>
        </View>
      </View>

      {/* Meta: commits today + last shipped */}
      <View style={styles.metaRow}>
        <ThemedText type="tiny" style={styles.metaItem}>
          · {commitsToday} {commitsToday === 1 ? 'commit' : 'commits'} today
        </ThemedText>
        <ThemedText type="tiny" style={styles.metaItem}>
          · {totalCommits} this week
        </ThemedText>
      </View>

      {/* Weekly chart */}
      <WeeklyChart weekly={weekly} streakLength={streak} />

      {/* Hype-man subline (the secondary "what now" line) */}
      <ThemedText type="small" style={styles.subline}>
        {subline}
      </ThemedText>

      {/* Grace period hint — warm orange box */}
      {inGrace ? (
        <View style={styles.graceHint}>
          <ThemedText style={styles.graceIcon} accessibilityElementsHidden>
            🫠
          </ThemedText>
          <ThemedText type="small" style={styles.graceText}>
            {streak === 0
              ? "Did you forget to push? We're counting ships that hit GitHub."
              : 'Ship today to keep the streak going.'}
          </ThemedText>
        </View>
      ) : null}

      {/* Welcome-back hint when streak is fully broken (4+ days, no recent activity) */}
      {streak === 0 && daysSinceLastShip !== null && daysSinceLastShip >= 3 ? (
        <View style={styles.welcomeBackHint}>
          <ThemedText style={styles.graceIcon} accessibilityElementsHidden>
            💪
          </ThemedText>
          <ThemedText type="small" style={styles.welcomeBackText}>
            {`Welcome back. ${lastShippedLine.replace('🔥 0 — ', '')}. Let's start a new streak.`}
          </ThemedText>
        </View>
      ) : null}

      {/* Share button (subtle) */}
      {onShare ? (
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel="Share your streak"
          style={({ pressed }) => [styles.shareBtn, pressed && styles.shareBtnPressed]}
        >
          <ThemedText type="smallBold" style={styles.shareLabel}>
            Share
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // Soft fire-gradient feel using a single tinted surface. The HTML
    // draft uses a CSS gradient; RN doesn't have an equivalent without
    // a third-party lib, so we layer a soft tint over the surface.
    backgroundColor: Colors.dark.surface,
    borderRadius: Radius.modal,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
    padding: Spacing.five,
    gap: Spacing.three,
    // iOS shadow + Android elevation
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    elevation: 2,
  },
  errorCard: {
    backgroundColor: Colors.dark.dangerSoft,
    borderColor: 'rgba(248,81,73,0.3)',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  errorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.dark.danger,
    marginTop: 6,
  },
  errorTitle: { color: Colors.dark.text },
  errorMsg: { color: Colors.dark.muted, marginTop: 2 },

  // Welcome (new user)
  welcomeEmoji: { fontSize: 40, lineHeight: 44 },
  welcomeHeading: { color: Colors.dark.text },
  welcomeSub: { color: Colors.dark.muted, lineHeight: 20 },

  // Loading skeleton
  iconBubble: { width: 56, height: 56, borderRadius: 28 },
  skeletonBubble: { backgroundColor: Colors.dark.raised },
  skeletonNumber: {
    width: 100,
    height: 40,
    borderRadius: 6,
    backgroundColor: Colors.dark.raised,
    marginBottom: 6,
  },
  skeletonLabel: {
    width: 60,
    height: 12,
    borderRadius: 4,
    backgroundColor: Colors.dark.raised,
  },

  // Headline (ready)
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
  },
  flame: {
    fontSize: 56,
    lineHeight: 64,
    // Soft glow
    textShadowColor: 'rgba(247, 129, 102, 0.35)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  // The streak number — display-size, fire color, tight tracking.
  // RN doesn't support background-clip:text for a true gradient, so
  // we use a solid warm fire tone. The drop-shadow gives the "glow".
  streakNumber: {
    fontSize: 56,
    lineHeight: 60,
    fontWeight: '700',
    letterSpacing: -1.2,
    color: Colors.dark.fire1,
    textShadowColor: 'rgba(247, 129, 102, 0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  streakLabel: {
    color: Colors.dark.muted,
    marginTop: 2,
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  metaItem: {
    color: Colors.dark.muted,
    fontFamily: 'monospace',
  },
  muted: { color: Colors.dark.muted },

  subline: {
    color: Colors.dark.muted,
    lineHeight: 20,
  },

  // Grace hint
  graceHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    backgroundColor: Colors.dark.warningSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(210, 153, 34, 0.3)',
    borderRadius: Radius.chip,
  },
  graceIcon: { fontSize: 16 },
  graceText: { color: Colors.dark.warning, flex: 1 },

  // Welcome-back hint
  welcomeBackHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    backgroundColor: Colors.dark.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
    borderRadius: Radius.chip,
  },
  welcomeBackText: { color: Colors.dark.text, flex: 1 },

  // Share button
  shareBtn: {
    alignSelf: 'flex-end',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  shareBtnPressed: { backgroundColor: Colors.dark.surface },
  shareLabel: { color: Colors.dark.accent },
});

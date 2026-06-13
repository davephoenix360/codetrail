/**
 * FeedSection — the activity feed on /repos, below the streak section.
 *
 * Renders one of five states:
 *  - loading: muted "Catching up on everyone's ships..."
 *  - empty:   "Your friends are quiet this week. No pressure, neither
 *             are you. 🌱"  (no recent activity from anyone)
 *  - not-on-app: "None of your friends are on CodeTrail yet. Invite
 *             them so you can see their streaks too."
 *  - zero-friends: "Follow a friend to see what they're shipping." +
 *                  CTA to /friends
 *  - error:   "Couldn't load your friends' ships." + retry
 *  - ready:   the list of <FeedEntry />
 *
 * If `stale` is true (cache > 1 hour), we add a tiny "updated 2h ago"
 * line at the top so the user knows we have older data.
 *
 * Hype-man voice. See `~/.hermes/skills/creative/codetrail-design/
 * references/copy-bank.md`.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedText } from './themed-text';
import { FeedEntry } from './feed-entry';
import type { FeedEntry as FeedEntryT } from '@/lib/github-api';
import { Colors, Radius, Spacing } from '@/constants/theme';

type State =
  | { status: 'loading' }
  | { status: 'ready'; entries: FeedEntryT[]; stale: boolean }
  | { status: 'empty' }
  | { status: 'not-on-app' }
  | { status: 'zero-friends' }
  | { status: 'error'; message: string };

interface Props {
  state: State;
  onRefresh: () => void;
  onRetry: () => void;
}

export function FeedSection({ state, onRefresh, onRetry }: Props) {
  if (state.status === 'loading') {
    return (
      <View style={styles.card}>
        <ThemedText type="small" style={styles.muted}>
          Catching up on everyone's ships…
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'zero-friends') {
    return (
      <View style={styles.card}>
        <ThemedText type="h3" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <ThemedText type="small" style={styles.muted}>
          Follow a friend to see what they're shipping.
        </ThemedText>
        <Pressable
          onPress={() => router.push('/friends')}
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
        >
          <ThemedText type="smallBold" style={styles.primaryBtnLabel}>
            Add a friend
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'not-on-app') {
    return (
      <View style={styles.card}>
        <ThemedText type="h3" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <View style={styles.notOnAppBlock}>
          <ThemedText style={styles.bigEmoji} accessibilityElementsHidden>
            👀
          </ThemedText>
          <ThemedText type="small" style={styles.mutedCenter}>
            None of your friends are on CodeTrail yet. Invite them so you can see their streaks too.
          </ThemedText>
          <Pressable
            onPress={() => router.push('/friends')}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
          >
            <ThemedText type="smallBold" style={styles.primaryBtnLabel}>
              Invite a friend
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.status === 'empty') {
    return (
      <View style={styles.card}>
        <ThemedText type="h3" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <View style={styles.notOnAppBlock}>
          <ThemedText style={styles.bigEmoji} accessibilityElementsHidden>
            🌱
          </ThemedText>
          <ThemedText type="small" style={styles.mutedCenter}>
            Your friends are quiet this week. No pressure — neither are you.
          </ThemedText>
        </View>
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
              Couldn't load your friends' ships
            </ThemedText>
            <ThemedText type="small" style={styles.errorMsg}>
              {state.message}
            </ThemedText>
            <Pressable
              onPress={onRetry}
              style={({ pressed }) => [styles.retryBtn, pressed && styles.btnPressed]}
            >
              <ThemedText type="smallBold" style={styles.retryLabel}>
                Try again
              </ThemedText>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ready
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText type="h3" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <Pressable
          onPress={onRefresh}
          accessibilityRole="button"
          accessibilityLabel="Refresh feed"
          hitSlop={8}
          style={({ pressed }) => [styles.refreshBtn, pressed && styles.btnPressed]}
        >
          {state.stale ? (
            <ThemedText type="smallBold" style={styles.refreshLabel}>
              ↻ Refresh
            </ThemedText>
          ) : (
            <ActivityIndicator color={Colors.dark.accent} size="small" />
          )}
        </Pressable>
      </View>
      {state.entries.map((entry) => (
        <FeedEntry key={`${entry.friend.githubId}-${entry.date}`} entry={entry} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.dark.surface,
    borderRadius: Radius.modal,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
    padding: Spacing.five,
    gap: Spacing.three,
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
  errorMsg: { color: Colors.dark.muted, marginTop: 2, marginBottom: Spacing.two },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heading: { color: Colors.dark.text },
  muted: { color: Colors.dark.muted },
  mutedCenter: {
    color: Colors.dark.muted,
    textAlign: 'center',
    maxWidth: 280,
  },
  notOnAppBlock: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  bigEmoji: { fontSize: 36, lineHeight: 40 },

  primaryBtn: {
    backgroundColor: Colors.dark.accent,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: Radius.chip,
    alignSelf: 'center',
  },
  primaryBtnLabel: { color: '#fff' },
  btnPressed: { opacity: 0.7 },

  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.chip,
  },
  retryLabel: { color: Colors.dark.text },

  refreshBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  refreshLabel: { color: Colors.dark.accent },
});

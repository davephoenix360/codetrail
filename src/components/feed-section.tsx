/**
 * FeedSection — the activity feed on /repos, below the streak section.
 *
 * Renders one of four states:
 *  - loading: muted "Looking up your friends' ships..."
 *  - empty:   "Your friends are quiet this week. No pressure, neither
 *             are you. 🌱"  (no recent activity from anyone)
 *  - zero-friends: "Follow a friend to see what they're shipping." +
 *                  CTA to /friends
 *  - error:   "Couldn't load your friends' ships." + retry
 *  - ready:   the list of <FeedEntry />
 *
 * If `stale` is true (cache > 1 hour), we add a tiny "updated 2h ago"
 * line at the top so the user knows we have older data.
 */
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedText } from './themed-text';
import { FeedEntry } from './feed-entry';
import type { FeedEntry as FeedEntryT } from '@/lib/github-api';
import { Spacing } from '@/constants/theme';

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
        <ThemedText type="default" style={styles.muted}>
          Looking up your friends' ships…
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'zero-friends') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <ThemedText type="default" style={styles.muted}>
          Follow a friend to see what they're shipping.
        </ThemedText>
        <Pressable
          onPress={() => router.push('/friends')}
          style={[styles.button, styles.spacedTop]}
        >
          <ThemedText type="smallBold">Add a friend</ThemedText>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'not-on-app') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <ThemedText type="default" style={styles.muted}>
          None of your friends are on CodeTrail yet. Invite them so you can see their streaks too.
        </ThemedText>
      </View>
    );
  }

  if (state.status === 'empty') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <ThemedText type="default" style={styles.muted}>
          Your friends are quiet this week. No pressure — neither are you. 🌱
        </ThemedText>
        <Pressable
          onPress={onRefresh}
          accessibilityLabel="Refresh feed"
          style={styles.refreshBtn}
        >
          <ThemedText type="small" style={styles.refreshLabel}>
            Refresh
          </ThemedText>
        </Pressable>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.card}>
        <ThemedText type="default" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <ThemedText type="default" style={styles.muted}>
          Couldn't load your friends' ships.
        </ThemedText>
        <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
          {state.message}
        </ThemedText>
        <Pressable
          onPress={onRetry}
          style={[styles.retry, styles.spacedTop]}
        >
          <ThemedText type="smallBold">Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  // ready
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ThemedText type="default" style={styles.heading}>
          Your friends' ships
        </ThemedText>
        <Pressable
          onPress={onRefresh}
          accessibilityLabel="Refresh feed"
          hitSlop={8}
          style={styles.refreshIconBtn}
        >
          {state.stale ? (
            <ThemedText type="small" style={styles.refreshLabel}>
              ↻ Refresh
            </ThemedText>
          ) : (
            <ActivityIndicator color="#208AEF" size="small" />
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
    backgroundColor: '#0d1117',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    padding: Spacing.four,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.two,
  },
  heading: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e6edf3',
  },
  muted: {
    color: '#8b949e',
  },
  spacedTop: {
    marginTop: Spacing.three,
  },
  button: {
    alignSelf: 'flex-start',
    backgroundColor: '#208AEF',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 8,
  },
  retry: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
  },
  refreshIconBtn: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  refreshBtn: {
    alignSelf: 'flex-start',
    marginTop: Spacing.three,
  },
  refreshLabel: {
    color: '#208AEF',
    fontSize: 12,
    fontWeight: '600',
  },
});

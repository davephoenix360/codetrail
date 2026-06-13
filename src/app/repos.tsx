/**
 * /repos — the main authenticated screen.
 *
 * Shows the user's tracked repos (loaded from Firestore) and lets them open
 * a picker to add or remove repos. The picker fetches the user's public
 * GitHub repos through the Cloudflare Worker proxy.
 *
 * Above the list: a streak dashboard (lib/streak.ts) showing the user's
 * current streak and weekly commit activity, with hype-man framing.
 *
 * Hype-man voice throughout: every empty state, every error, every label.
 * See BRIEF.md §"Voice & tone" for the full checklist.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Share,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { RepoPicker } from '@/components/repo-picker';
import { StreakSection } from '@/components/streak-section';
import { FeedSection } from '@/components/feed-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useFriends } from '@/hooks/use-friends';
import { useFeed } from '@/hooks/use-feed';
import { useStreak } from '@/hooks/use-streak';
import { listTrackedRepos, trackRepo, untrackRepo } from '@/lib/firebase-repos';
import type { TrackedRepo } from '@/lib/firebase-repos';
import type { StreakSnapshot } from '@/lib/account-types';
import { GitHubApiError, listMyRepos, type GitHubRepo } from '@/lib/github-api';
import { formatShareMessage } from '@/lib/streak';
import { Spacing } from '@/constants/theme';

type LoadState = 'loading' | 'ready' | 'error';

export default function ReposScreen() {
  const { user, loading, isSignedIn, signOut, githubAccessToken, profileLoaded, userProfile, updateStreak } = useAuth();

  // Defensive: if a signed-out user lands here, bounce back to /.
  useEffect(() => {
    if (!loading && !isSignedIn) {
      router.replace('/');
    }
  }, [loading, isSignedIn]);

  // Tracked repos from Firestore.
  const [tracked, setTracked] = useState<TrackedRepo[]>([]);
  const [trackedState, setTrackedState] = useState<LoadState>('loading');
  const [trackedError, setTrackedError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Picker modal.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([]);
  const [pickerState, setPickerState] = useState<LoadState>('loading');
  const [pickerError, setPickerError] = useState<string | null>(null);

  // Streak dashboard. Uses the stored streak cache (on the user profile)
  // if it's recent (< 1 hour) — instant render, no API call. Otherwise
  // computes via loadStreak and writes back to Firestore for next time.
  //
  // onUpdate is memoized with useCallback so the useStreak effect's
  // dep array sees a stable reference. Without this, every render of
  // ReposScreen creates a new arrow → useStreak effect re-fires on
  // every render → setState → re-render → infinite loop ("Maximum
  // update depth exceeded"). The hook also defensively stashes
  // onUpdate in a ref, but the explicit memoization here makes the
  // intent obvious to the next reader.
  const handleStreakUpdate = useCallback(
    (snapshot: StreakSnapshot) => {
      // Fire-and-forget write to Firestore. The hook continues
      // regardless; next mount will pick up the cached value.
      void updateStreak(snapshot);
    },
    [updateStreak],
  );

  const { state: streakState, refresh: refreshStreak } = useStreak({
    accessToken: githubAccessToken,
    login: userProfile?.login ?? null,
    repos: tracked,
    storedStreakData: userProfile?.streakData ?? null,
    storedStreakUpdatedAt: userProfile?.streakUpdatedAt ?? null,
    onUpdate: handleStreakUpdate,
  });

  // Friends + activity feed (Phase 3).
  const { friends, refresh: refreshFriends } = useFriends(user?.uid ?? null);
  const { state: feedState, entries: feedEntries, error: feedError, stale: feedStale, refresh: refreshFeed } = useFeed({
    uid: user?.uid ?? null,
    accessToken: githubAccessToken,
    friends,
  });

  // Map useFeed's status to FeedSection's State shape.
  const friendsOnApp = friends.filter((f) => f.isOnCodeTrail).length;
  const feedSectionState = (() => {
    if (friends.length === 0) {
      return { status: 'zero-friends' as const };
    }
    if (friendsOnApp === 0) {
      // Have friends, but none are on CodeTrail — skip the feed fetch
      // entirely. New copy: invite them to see their streaks.
      return { status: 'not-on-app' as const };
    }
    if (feedState === 'loading' && feedEntries.length === 0) {
      return { status: 'loading' as const };
    }
    if (feedState === 'error' && feedEntries.length === 0) {
      return { status: 'error' as const, message: feedError ?? 'Try again.' };
    }
    if (feedEntries.length === 0) {
      return { status: 'empty' as const };
    }
    return { status: 'ready' as const, entries: feedEntries, stale: feedStale };
  })();

  // ---- Share streak (system share sheet) ----
  // Fires the OS-native share sheet with a hype-man message. No third-party
  // deps — uses react-native's built-in Share API. On iOS this is the bottom
  // sheet; on Android, the system chooser.
  const handleShare = useCallback(async () => {
    if (streakState.status !== 'ready') return;
    const login = userProfile?.login;
    if (!login) {
      Alert.alert('Not ready yet', 'We need your GitHub handle before sharing. Try again in a moment.');
      return;
    }
    const message = formatShareMessage(streakState.data, login);
    try {
      const result = await Share.share(
        {
          message,
          // iOS-only title — falls back to the app name in the chooser.
          title: 'My CodeTrail streak',
        },
        {
          // iOS subject line (email, etc.). Android ignores.
          subject: 'My CodeTrail streak',
        },
      );
      if (__DEV__ && result.action === Share.sharedAction) {
        console.log('[share] shared to', result.activityType ?? 'unknown');
      }
    } catch (e) {
      // Most common: user dismissed — not actually an error, but log it.
      if (__DEV__) console.warn('[share] cancelled or failed:', e);
    }
  }, [streakState, userProfile]);

  // Derived: set of full names of currently-tracked repos (for picker toggle state).
  const trackedFullNames = useMemo(
    () => new Set(tracked.map((r) => r.repoFullName)),
    [tracked],
  );

  // ---- Firestore: load tracked repos ----
  const reloadTracked = useCallback(async () => {
    if (!user) return;
    setTrackedState('loading');
    setTrackedError(null);
    try {
      const list = await listTrackedRepos(user.uid);
      setTracked(list);
      setTrackedState('ready');
    } catch (e) {
      setTrackedError(e instanceof Error ? e.message : 'Could not load your tracked projects.');
      setTrackedState('error');
    }
  }, [user]);

  useEffect(() => {
    if (user) void reloadTracked();
  }, [user, reloadTracked]);

  // ---- GitHub API: load all repos for the picker ----
  const loadAllRepos = useCallback(async () => {
    if (!githubAccessToken) return;
    setPickerState('loading');
    setPickerError(null);
    try {
      const repos = await listMyRepos(githubAccessToken);
      setAllRepos(repos);
      setPickerState('ready');
    } catch (e) {
      setPickerError(
        e instanceof GitHubApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not load your GitHub projects.',
      );
      setPickerState('error');
    }
  }, [githubAccessToken]);

  // Open the picker → load repos.
  const openPicker = useCallback(() => {
    setPickerOpen(true);
    void loadAllRepos();
  }, [loadAllRepos]);

  // ---- Track / untrack handlers (called from picker) ----
  const handleTrack = useCallback(
    async (repo: GitHubRepo) => {
      if (!user) return;
      try {
        await trackRepo(user.uid, repo);
        // Optimistic local update so the tracked list reflects the change
        // immediately. The Firestore read on next reload will reconcile.
        setTracked((prev) => {
          if (prev.some((r) => r.repoFullName === repo.fullName)) return prev;
          return [
            ...prev,
            {
              repoId: repo.id,
              repoFullName: repo.fullName,
              name: repo.name,
              description: repo.description,
              language: repo.language,
              stars: repo.stars,
              updatedAt: repo.updatedAt,
              trackedAt: Date.now(),
              lastFetchedAt: Date.now(),
            },
          ];
        });
        // Refresh the streak so the new repo's commits are included
        refreshStreak();
      } catch (e) {
        // Surface the actual error so we can see if it's a permission
        // problem, network issue, or something else. v2.0 will use a toast.
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String((e as { code: unknown }).code)
            : 'unknown';
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[codetrail] trackRepo failed:', code, message);
        Alert.alert(
          'Could not track that one',
          `code: ${code}\nmessage: ${message}\nrepo: ${repo.fullName}`,
          [{ text: 'OK' }],
        );
      }
    },
    [user, refreshStreak],
  );

  const handleUntrack = useCallback(
    async (repoId: number) => {
      if (!user) return;
      try {
        await untrackRepo(user.uid, repoId);
        setTracked((prev) => prev.filter((r) => r.repoId !== repoId));
        // Refresh the streak so the untracked repo's commits drop off
        refreshStreak();
      } catch (e) {
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String((e as { code: unknown }).code)
            : 'unknown';
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[codetrail] untrackRepo failed:', code, message);
        Alert.alert(
          'Could not untrack that one',
          `code: ${code}\nmessage: ${message}\nrepoId: ${repoId}`,
          [{ text: 'OK' }],
        );
      }
    },
    [user, refreshStreak],
  );

  // ---- Pull-to-refresh: reload tracked repos, streak, friends, feed ----
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        reloadTracked(),
        Promise.resolve(refreshStreak()),
        Promise.resolve(refreshFriends()),
        Promise.resolve(refreshFeed()),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [reloadTracked, refreshStreak, refreshFriends, refreshFeed]);

  // ---- Render: loading spinner until both auth + GitHub token are ready ----
  if (loading || !profileLoaded) {
    return (
      <ThemedView style={styles.full}>
        <ActivityIndicator size="large" />
      </ThemedView>
    );
  }

  // ---- Render: the actual screen ----
  return (
    <ThemedView style={styles.full}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="title" style={styles.heading}>
              You shipped.
            </ThemedText>
            <ThemedText type="small" style={styles.muted}>
              Hi, {user?.displayName || user?.email || userProfile?.login}.
            </ThemedText>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/friends')}
              accessibilityRole="button"
              accessibilityLabel="Friends"
              style={styles.headerButton}
            >
              <ThemedText type="small" style={styles.muted}>
                Friends
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={signOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={styles.headerButton}
            >
              <ThemedText type="small" style={styles.muted}>
                Sign out
              </ThemedText>
            </Pressable>
          </View>
        </View>

        {trackedState === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
              Loading your projects…
            </ThemedText>
          </View>
        ) : trackedState === 'error' ? (
          <View style={styles.center}>
            <ThemedText type="smallBold">Could not load your projects.</ThemedText>
            <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
              {trackedError}
            </ThemedText>
            <Pressable onPress={reloadTracked} style={styles.button}>
              <ThemedText type="smallBold">Try again</ThemedText>
            </Pressable>
          </View>
        ) : tracked.length === 0 ? (
          <>
            <StreakSection
              state={streakState}
              noTrackedRepos={true}
              onShare={handleShare}
            />
            <View style={[styles.spacedTop]}>
              <FeedSection
                state={feedSectionState}
                onRefresh={refreshFeed}
                onRetry={refreshFeed}
              />
            </View>
            <View style={styles.center}>
              <ThemedText type="subtitle" style={styles.emptyHeading}>
                Pick your projects
              </ThemedText>
              <ThemedText type="default" style={[styles.muted, styles.spacedTop]}>
                We will track your streak on the repos you choose. No judgment, just momentum.
              </ThemedText>
              <Pressable onPress={openPicker} style={[styles.button, styles.spacedTop]}>
                <ThemedText type="smallBold">Browse your projects</ThemedText>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <FlatList
              data={tracked}
              keyExtractor={(r) => r.repoFullName}
              ListHeaderComponent={
                <View style={styles.dashboardWrap}>
                  <StreakSection
                    state={streakState}
                    noTrackedRepos={false}
                    onShare={handleShare}
                  />
                  <View style={styles.spacedTop}>
                    <FeedSection
                      state={feedSectionState}
                      onRefresh={refreshFeed}
                      onRetry={refreshFeed}
                    />
                  </View>
                  <ThemedText type="default" style={[styles.muted, styles.spacedTop, styles.listHeader]}>
                    Tracked projects
                  </ThemedText>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.trackedRow}>
                  <ThemedText type="smallBold">{item.name}</ThemedText>
                  <ThemedText type="small" style={styles.muted}>
                    {item.language ?? '—'} · ⭐ {item.stars}
                  </ThemedText>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor="#8b949e"
                />
              }
            />
            <Pressable
              onPress={openPicker}
              style={[styles.button, styles.spacedTop]}
              accessibilityRole="button"
            >
              <ThemedText type="smallBold">Add or remove projects</ThemedText>
            </Pressable>
          </>
        )}

        <Modal
          visible={pickerOpen}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setPickerOpen(false)}
        >
          <RepoPicker
            repos={allRepos}
            trackedFullNames={trackedFullNames}
            loading={pickerState === 'loading'}
            error={pickerError}
            onTrack={handleTrack}
            onUntrack={handleUntrack}
            onRefresh={loadAllRepos}
            onClose={() => setPickerOpen(false)}
          />
        </Modal>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  full: {
    flex: 1,
  },
  safe: {
    flex: 1,
    padding: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.four,
  },
  headerText: {
    flex: 1,
    gap: Spacing.one,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  heading: {
    fontSize: 32,
    lineHeight: 36,
  },
  muted: {
    opacity: 0.7,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  emptyHeading: {
    textAlign: 'center',
  },
  spacedTop: {
    marginTop: Spacing.three,
  },
  button: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  trackedRow: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  listContent: {
    paddingBottom: Spacing.three,
  },
  dashboardWrap: {
    marginBottom: Spacing.four,
  },
  listHeader: {
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
});

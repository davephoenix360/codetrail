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
import { Ionicons } from '@expo/vector-icons';

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
import { Colors, Radius, Spacing } from '@/constants/theme';

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
        <ActivityIndicator size="large" color={Colors.dark.accent} />
        <ThemedText type="small" style={styles.muted}>
          Setting up your dashboard…
        </ThemedText>
      </ThemedView>
    );
  }

  // ---- Render: the actual screen ----
  return (
    <ThemedView style={styles.full}>
      <SafeAreaView style={styles.safe}>
        {/* App header — "CodeTrail" + handle + icon buttons */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="h1" style={styles.heading}>
              CodeTrail
            </ThemedText>
            <ThemedText type="small" style={styles.muted}>
              @{userProfile?.login ?? user?.email ?? 'you'}
            </ThemedText>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => router.push('/friends')}
              accessibilityRole="button"
              accessibilityLabel="Friends"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
            >
              <ThemedText type="bodyBold" style={styles.iconBtnLabel}>
                👥
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={signOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.btnPressed]}
            >
              <Ionicons name="log-out-outline" size={18} color={Colors.dark.text} />
            </Pressable>
          </View>
        </View>

        {trackedState === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.dark.accent} />
            <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
              Loading your projects…
            </ThemedText>
          </View>
        ) : trackedState === 'error' ? (
          <View style={[styles.center, styles.errorCard]}>
            <ThemedText type="smallBold" style={styles.errorTitle}>
              Could not load your projects
            </ThemedText>
            <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
              {trackedError}
            </ThemedText>
            <Pressable
              onPress={reloadTracked}
              style={({ pressed }) => [styles.retry, pressed && styles.btnPressed, styles.spacedTop]}
            >
              <ThemedText type="smallBold" style={styles.retryLabel}>Try again</ThemedText>
            </Pressable>
          </View>
        ) : tracked.length === 0 ? (
          <>
            <StreakSection
              state={streakState}
              noTrackedRepos={true}
              onShare={handleShare}
            />
            <View style={styles.spacedTop}>
              <FeedSection
                state={feedSectionState}
                onRefresh={refreshFeed}
                onRetry={refreshFeed}
              />
            </View>
            <View style={styles.emptyState}>
              <ThemedText style={styles.emptyEmoji} accessibilityElementsHidden>
                ✨
              </ThemedText>
              <ThemedText type="h2" style={styles.emptyHeading}>
                Pick your projects
              </ThemedText>
              <ThemedText type="small" style={[styles.muted, styles.spacedTop, styles.emptyBody]}>
                We track your streak on the repos you choose. No judgment, just momentum.
              </ThemedText>
              <Pressable
                onPress={openPicker}
                style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, styles.spacedTop]}
              >
                <ThemedText type="smallBold" style={styles.primaryBtnLabel}>
                  Browse your projects
                </ThemedText>
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
                  <ThemedText type="h3" style={[styles.trackedHeader, styles.spacedTop]}>
                    Tracking
                    <ThemedText type="body" style={styles.trackedCount}>
                      {' '}{tracked.length}
                    </ThemedText>
                  </ThemedText>
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.trackedRow}>
                  <View style={styles.trackedIcon}>
                    <Ionicons name="logo-github" size={16} color={Colors.dark.muted} />
                  </View>
                  <View style={styles.trackedText}>
                    <ThemedText type="bodyBold" style={styles.trackedName}>
                      {item.name}
                    </ThemedText>
                    <ThemedText type="tiny" style={styles.trackedMeta}>
                      {item.language ?? '—'} · ⭐ {item.stars}
                    </ThemedText>
                  </View>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={Colors.dark.muted}
                />
              }
            />
            <Pressable
              onPress={openPicker}
              style={({ pressed }) => [styles.addRepoBtn, pressed && styles.btnPressed]}
              accessibilityRole="button"
            >
              <ThemedText type="smallBold" style={styles.addRepoLabel}>
                + Add or remove projects
              </ThemedText>
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
  full: { flex: 1 },
  safe: { flex: 1, padding: Spacing.four },

  // App header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.five,
  },
  headerText: { flex: 1, gap: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.chip,
    backgroundColor: Colors.dark.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnLabel: { color: Colors.dark.text, fontSize: 18 },
  btnPressed: { opacity: 0.6 },
  heading: { color: Colors.dark.text, letterSpacing: -0.4 },
  muted: { color: Colors.dark.muted },

  // States
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  errorCard: {
    backgroundColor: Colors.dark.dangerSoft,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248,81,73,0.3)',
    margin: Spacing.three,
  },
  errorTitle: { color: Colors.dark.text },
  retry: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  retryLabel: { color: Colors.dark.text },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: Spacing.seven,
    paddingHorizontal: Spacing.five,
  },
  emptyEmoji: { fontSize: 48, lineHeight: 56 },
  emptyHeading: { color: Colors.dark.text, textAlign: 'center' },
  emptyBody: { textAlign: 'center', maxWidth: 280, lineHeight: 20 },

  // Buttons
  primaryBtn: {
    backgroundColor: Colors.dark.accent,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: Radius.chip,
  },
  primaryBtnLabel: { color: '#fff' },
  addRepoBtn: {
    backgroundColor: Colors.dark.accentSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.accent,
    borderStyle: 'dashed',
    borderRadius: Radius.card,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  addRepoLabel: { color: Colors.dark.accent },

  // Tracked repos list
  dashboardWrap: { marginBottom: Spacing.three },
  trackedHeader: {
    color: Colors.dark.text,
    marginBottom: Spacing.three,
  },
  trackedCount: { color: Colors.dark.muted, fontWeight: '500' },
  trackedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    gap: Spacing.three,
  },
  trackedIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.chip,
    backgroundColor: Colors.dark.raised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackedIconLabel: { color: Colors.dark.muted, fontSize: 16 },
  trackedText: { flex: 1 },
  trackedName: { color: Colors.dark.text, fontFamily: 'monospace' },
  trackedMeta: { color: Colors.dark.muted, fontFamily: 'monospace', marginTop: 2 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.dark.border,
  },
  listContent: { paddingBottom: Spacing.seven },
  spacedTop: { marginTop: Spacing.four },
});

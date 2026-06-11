/**
 * /repos — the main authenticated screen.
 *
 * Shows the user's tracked repos (loaded from Firestore) and lets them open
 * a picker to add or remove repos. The picker fetches the user's public
 * GitHub repos through the Cloudflare Worker proxy.
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
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { RepoPicker } from '@/components/repo-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { listTrackedRepos, trackRepo, untrackRepo } from '@/lib/firebase-repos';
import { GitHubApiError, listMyRepos, type GitHubRepo } from '@/lib/github-api';
import type { TrackedRepo } from '@/lib/firebase-repos';
import { Spacing } from '@/constants/theme';

type LoadState = 'loading' | 'ready' | 'error';

export default function ReposScreen() {
  const { user, loading, isSignedIn, signOut, githubAccessToken, accountsLoaded } = useAuth();

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

  // Picker modal.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([]);
  const [pickerState, setPickerState] = useState<LoadState>('loading');
  const [pickerError, setPickerError] = useState<string | null>(null);

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
    [user],
  );

  const handleUntrack = useCallback(
    async (repoId: number) => {
      if (!user) return;
      try {
        await untrackRepo(user.uid, repoId);
        setTracked((prev) => prev.filter((r) => r.repoId !== repoId));
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
    [user],
  );

  // ---- Render: loading spinner until both auth + GitHub token are ready ----
  if (loading || !accountsLoaded) {
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
              Hi, {user?.displayName || user?.email}.
            </ThemedText>
          </View>
          <Pressable
            onPress={signOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            style={styles.signOut}
          >
            <ThemedText type="small" style={styles.muted}>
              Sign out
            </ThemedText>
          </Pressable>
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
        ) : (
          <>
            <FlatList
              data={tracked}
              keyExtractor={(r) => r.repoFullName}
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
  heading: {
    fontSize: 32,
    lineHeight: 36,
  },
  signOut: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
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
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  listContent: {
    paddingBottom: Spacing.three,
  },
});

/**
 * RepoPicker — full-screen picker for the user's GitHub repos.
 *
 * Lets them filter by name and toggle tracking. Empty state, loading
 * state, and an error state are all handled in hype-man voice.
 *
 * Hype-man copy lives here (not on the parent screen) because the picker
 * is a self-contained "moment" — the user came here to do one thing.
 */
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';

import { RepoListItem } from './repo-list-item';
import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';
import { Colors, Spacing } from '@/constants/theme';
import type { GitHubRepo } from '@/lib/github-api';

export interface RepoPickerProps {
  repos: GitHubRepo[];
  trackedFullNames: Set<string>;
  loading: boolean;
  error: string | null;
  onTrack: (repo: GitHubRepo) => void;
  onUntrack: (repoFullName: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function RepoPicker({
  repos,
  trackedFullNames,
  loading,
  error,
  onTrack,
  onUntrack,
  onRefresh,
  onClose,
}: RepoPickerProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.fullName.toLowerCase().includes(q) ||
        (r.description?.toLowerCase().includes(q) ?? false),
    );
  }, [repos, query]);

  const renderItem: ListRenderItem<GitHubRepo> = ({ item }) => {
    const isTracked = trackedFullNames.has(item.fullName);
    return (
      <RepoListItem
        name={item.name}
        fullName={item.fullName}
        description={item.description}
        language={item.language}
        stars={item.stars}
        tracked={isTracked}
        onToggle={() =>
          isTracked ? onUntrack(item.fullName) : onTrack(item)
        }
      />
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="subtitle">Pick your projects</ThemedText>
        <ThemedText type="small" style={styles.muted}>
          Toggle on the repos you want us to cheer you on for. We will handle the streak.
        </ThemedText>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter by name…"
          placeholderTextColor={Colors.light.textSecondary}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          onPress={onClose}
          style={styles.closeButton}
          accessibilityRole="button"
          accessibilityLabel="Close picker"
        >
          <ThemedText type="smallBold">Done</ThemedText>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
            Looking for your projects…
          </ThemedText>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <ThemedText type="smallBold">Hmm, that did not work.</ThemedText>
          <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
            {error}
          </ThemedText>
          <Pressable onPress={onRefresh} style={styles.retryButton}>
            <ThemedText type="smallBold">Try again</ThemedText>
          </Pressable>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          {query.trim() ? (
            <>
              <ThemedText type="smallBold">No matches for {query}</ThemedText>
              <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
                Try a shorter search, or clear the filter to see all your projects.
              </ThemedText>
            </>
          ) : (
            <>
              <ThemedText type="smallBold">No public repos yet</ThemedText>
              <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
                Push something to GitHub and we will pick it up here. Even a README counts.
              </ThemedText>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(r) => String(r.id)}
          renderItem={renderItem}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
    gap: Spacing.two,
  },
  search: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 8,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  closeButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  listContent: {
    paddingBottom: Spacing.five,
  },
  separator: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.two,
  },
  muted: {
    opacity: 0.65,
    textAlign: 'center',
  },
  spacedTop: {
    marginTop: Spacing.two,
  },
  retryButton: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
});

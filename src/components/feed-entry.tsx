/**
 * FeedEntry — one row in the activity feed.
 *
 * Avatar | main line ("@tino shipped 3 commits to tino-notes.") +
 *          "today" / "yesterday" / "3d ago" suffix
 *
 * Tapping the row opens the latest commit on GitHub (we have the SHA
 * but the worker doesn't return the HTML URL — we'd need to add it
 * later; for now, the avatar/login link to the friend's profile).
 */
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import type { FeedEntry as FeedEntryT } from '@/lib/github-api';
import { formatFeedLine, timeAgo } from '@/lib/feed';
import { Spacing } from '@/constants/theme';

interface Props {
  entry: FeedEntryT;
}

export function FeedEntry({ entry }: Props) {
  const line = formatFeedLine(entry);
  const ago = timeAgo(entry.date);

  const openProfile = () => {
    const url = entry.friend.htmlUrl ?? `https://github.com/${entry.friend.login}`;
    void Linking.openURL(url);
  };

  return (
    <View style={styles.row}>
      <Pressable onPress={openProfile} hitSlop={8}>
        <Image source={{ uri: entry.friend.avatarUrl }} style={styles.avatar} />
      </Pressable>
      <View style={styles.body}>
        <ThemedText type="default" style={styles.line}>
          {line}
        </ThemedText>
        <ThemedText type="small" style={styles.meta}>
          {ago} · {entry.repo.fullName}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.three,
    gap: Spacing.three,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#21262d',
  },
  body: {
    flex: 1,
  },
  line: {
    fontSize: 14,
    lineHeight: 20,
    color: '#e6edf3',
  },
  meta: {
    fontSize: 12,
    color: '#8b949e',
    marginTop: 2,
  },
});

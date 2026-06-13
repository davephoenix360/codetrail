/**
 * FeedEntry — one row in the activity feed.
 *
 * Layout (matches the design draft):
 *   [avatar]  @login  shipped  N commits today    [optional badge]
 *             repo · 2h ago
 *
 * Tapping the row opens the friend's GitHub profile. We don't have
 * commit-level URLs from the worker yet (v2.0: add latest commit URL).
 *
 * Voice: "shipped" is the verb (not "committed"). See copy-bank.md.
 */
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import type { FeedEntry as FeedEntryT } from '@/lib/github-api';
import { formatFeedLine, timeAgo } from '@/lib/feed';
import { Colors, Radius, Spacing } from '@/constants/theme';

interface Props {
  entry: FeedEntryT;
}

export function FeedEntry({ entry }: Props) {
  const ago = timeAgo(entry.date);
  const line = formatFeedLine(entry);

  const openProfile = () => {
    const url = entry.friend.htmlUrl ?? `https://github.com/${entry.friend.login}`;
    void Linking.openURL(url);
  };

  // The friend's "big day" badge is shown when the worker reports
  // `commitCount >= 5` (signaled in the feed entry). The exact
  // threshold lives in the worker; we just render whatever it sends.
  const isBigDay = entry.repo.commitCount >= 5;

  return (
    <View style={styles.row}>
      <Pressable onPress={openProfile} hitSlop={8} accessibilityRole="link">
        <Image source={{ uri: entry.friend.avatarUrl }} style={styles.avatar} />
      </Pressable>
      <Pressable onPress={openProfile} style={styles.body} accessibilityRole="link">
        <ThemedText type="small" style={styles.line} numberOfLines={2}>
          <ThemedText type="smallBold" style={styles.login}>
            @{entry.friend.login}
          </ThemedText>
          <ThemedText type="small" style={styles.verb}>
            {' '}
            shipped
          </ThemedText>
          <ThemedText type="small" style={styles.target}>
            {' '}
            {line.replace(`@${entry.friend.login} shipped `, '').replace(`@${entry.friend.login} had a big day`, 'had a big day')}
          </ThemedText>
        </ThemedText>
        <ThemedText type="tiny" style={styles.meta}>
          {ago} · {entry.repo.fullName}
        </ThemedText>
      </Pressable>
      {isBigDay ? (
        <View style={styles.badge}>
          <ThemedText type="tiny" style={styles.badgeLabel}>
            🔥 Big day
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Colors.dark.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  body: { flex: 1, minWidth: 0 },
  line: {
    color: Colors.dark.text,
    lineHeight: 20,
  },
  login: { color: Colors.dark.accent },
  verb: { color: Colors.dark.muted },
  target: { color: Colors.dark.text },
  meta: {
    color: Colors.dark.muted,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  badge: {
    backgroundColor: Colors.dark.fireSoft,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  badgeLabel: {
    color: Colors.dark.fire1,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});

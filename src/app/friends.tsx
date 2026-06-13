/**
 * /friends — list of GitHub users the current user is following.
 *
 * Shows a header with a "Add" button that navigates to /friends/add.
 * Each row is a FriendListItem: avatar, login, on-CodeTrail badge,
 * and a small "Remove" button. Tapping the row opens the friend's
 * GitHub profile in the browser (no in-app profile in MVP).
 *
 * Empty state: "No friends yet. Add someone to start the feed."
 *
 * Voice & tone: hype-man. Never accusatory. Removing a friend is a
 * soft "Stop following" rather than a hard "Delete" or "Unfriend".
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useFriends, FRIEND_CAP } from '@/hooks/use-friends';
import type { Friend } from '@/lib/firebase-friends';
import { Colors, Radius, Spacing } from '@/constants/theme';

export default function FriendsScreen() {
  const { user, userProfile } = useAuth();
  const { state, friends, error, refresh, remove } = useFriends(user?.uid ?? null);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const handleRemove = useCallback(
    (friend: Friend) => {
      Alert.alert(
        `Stop following @${friend.login}?`,
        "You'll stop seeing their ships in your feed.",
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Stop following',
            style: 'destructive',
            onPress: () => {
              void remove(friend.githubId).catch((e) => {
                Alert.alert('Could not remove', e instanceof Error ? e.message : 'Try again.');
              });
            },
          },
        ],
      );
    },
    [remove],
  );

  const openProfile = useCallback((friend: Friend) => {
    const url = friend.htmlUrl ?? `https://github.com/${friend.login}`;
    void Linking.openURL(url).catch(() => {
      Alert.alert('Could not open profile', 'Try again later.');
    });
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Friends',
          headerShown: true,
          headerStyle: { backgroundColor: Colors.dark.bg },
          headerTitleStyle: { color: Colors.dark.text, fontWeight: '700' },
          headerTintColor: Colors.dark.text,
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/friends/add')}
              accessibilityLabel="Add a friend"
              style={({ pressed }) => [styles.headerBtn, pressed && styles.btnPressed]}
            >
              <ThemedText type="smallBold" style={styles.headerBtnLabel}>
                + Add
              </ThemedText>
            </Pressable>
          ),
        }}
      />
      {userProfile?.login ? (
        <ThemedText type="small" style={styles.subhead}>
          {friends.length > 0
            ? `Friends see your streak and you see theirs.\n${friends.length} of ${FRIEND_CAP} following`
            : 'Add up to 25 friends. Their ships appear in your feed.'}
        </ThemedText>
      ) : null}

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.dark.accent} />
          <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
            Rounding up the crew…
          </ThemedText>
        </View>
      ) : state === 'error' ? (
        <View style={[styles.center, styles.errorCard]}>
          <ThemedText type="smallBold" style={styles.errorTitle}>
            Couldn't load your friends
          </ThemedText>
          <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
            {error}
          </ThemedText>
          <Pressable onPress={refresh} style={[styles.retry, styles.spacedTop]}>
            <ThemedText type="smallBold" style={styles.retryLabel}>Try again</ThemedText>
          </Pressable>
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.emptyState}>
          <ThemedText style={styles.emptyEmoji} accessibilityElementsHidden>
            👀
          </ThemedText>
          <ThemedText type="h2" style={styles.emptyHeading}>
            No friends yet
          </ThemedText>
          <ThemedText type="small" style={[styles.muted, styles.spacedTop, styles.emptyBody]}>
            Follow a friend to see what they're shipping. Their streak, their week, the works.
          </ThemedText>
          <Pressable
            onPress={() => router.push('/friends/add')}
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed, styles.spacedTop]}
          >
            <ThemedText type="smallBold" style={styles.primaryBtnLabel}>
              Add your first friend
            </ThemedText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(f) => String(f.githubId)}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.dark.muted}
            />
          }
          renderItem={({ item }) => (
            <FriendListItem
              friend={item}
              onOpen={() => openProfile(item)}
              onRemove={() => handleRemove(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function FriendListItem({
  friend,
  onOpen,
  onRemove,
}: {
  friend: Friend;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed && styles.rowMainPressed]}
      >
        <Image source={{ uri: friend.avatarUrl }} style={styles.avatar} />
        <View style={styles.rowText}>
          <ThemedText type="bodyBold" style={styles.login}>
            @{friend.login}
          </ThemedText>
          <View style={styles.metaRow}>
            {friend.isOnCodeTrail ? (
              <ThemedText type="tiny" style={styles.metaOn}>
                ✓ On CodeTrail
              </ThemedText>
            ) : (
              <ThemedText type="tiny" style={styles.metaOff}>
                Not on CodeTrail
              </ThemedText>
            )}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onRemove}
        accessibilityLabel={`Stop following @${friend.login}`}
        style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
      >
        <ThemedText type="tiny" style={styles.removeLabel}>
          Remove
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.dark.bg },
  subhead: {
    color: Colors.dark.muted,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    marginRight: Spacing.two,
  },
  btnPressed: { opacity: 0.6 },
  headerBtnLabel: { color: Colors.dark.accent },

  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  errorCard: {
    backgroundColor: Colors.dark.dangerSoft,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(248,81,73,0.3)',
    margin: Spacing.four,
  },
  errorTitle: { color: Colors.dark.text },

  // Empty state
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.five,
  },
  emptyEmoji: { fontSize: 48, lineHeight: 56 },
  emptyHeading: {
    color: Colors.dark.text,
    textAlign: 'center',
    marginTop: Spacing.three,
  },
  emptyBody: { textAlign: 'center', maxWidth: 280, lineHeight: 20 },

  // Buttons
  primaryBtn: {
    backgroundColor: Colors.dark.accent,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Radius.chip,
  },
  primaryBtnLabel: { color: '#fff' },
  retry: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  retryLabel: { color: Colors.dark.text },

  // List
  listContent: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  rowMainPressed: { opacity: 0.6 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.dark.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  rowText: { flex: 1 },
  login: { color: Colors.dark.text, fontFamily: 'monospace' },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaOn: { color: Colors.dark.success },
  metaOff: { color: Colors.dark.faint },
  muted: { color: Colors.dark.muted },
  spacedTop: { marginTop: Spacing.three },

  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.dark.border,
  },
  removeBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dark.border,
  },
  removeBtnPressed: { backgroundColor: Colors.dark.surface },
  removeLabel: { color: Colors.dark.muted },
});

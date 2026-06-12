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
import { Spacing } from '@/constants/theme';

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
          headerStyle: { backgroundColor: '#0d1117' },
          headerTitleStyle: { color: '#e6edf3' },
          headerTintColor: '#e6edf3',
          headerRight: () => (
            <Pressable
              onPress={() => router.push('/friends/add')}
              accessibilityLabel="Add a friend"
              style={({ pressed }) => [styles.headerBtn, pressed && styles.headerBtnPressed]}
            >
              <ThemedText type="default" style={styles.headerBtnLabel}>
                + Add
              </ThemedText>
            </Pressable>
          ),
        }}
      />
      {userProfile?.login ? (
        <ThemedText type="small" style={styles.subhead}>
          Friends see your streak and you see theirs.{'\n'}
          {friends.length} of {FRIEND_CAP} following
        </ThemedText>
      ) : null}

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : state === 'error' ? (
        <View style={styles.center}>
          <ThemedText type="default" style={styles.muted}>
            Couldn't load your friends.
          </ThemedText>
          <ThemedText type="small" style={[styles.muted, styles.spacedTop]}>
            {error}
          </ThemedText>
          <Pressable onPress={refresh} style={[styles.retry, styles.spacedTop]}>
            <ThemedText type="smallBold">Try again</ThemedText>
          </Pressable>
        </View>
      ) : friends.length === 0 ? (
        <View style={styles.center}>
          <ThemedText type="subtitle" style={styles.emptyHeading}>
            No friends yet
          </ThemedText>
          <ThemedText type="default" style={[styles.muted, styles.spacedTop, styles.emptyBody]}>
            Follow a friend to see what they're shipping.
          </ThemedText>
          <Pressable
            onPress={() => router.push('/friends/add')}
            style={[styles.button, styles.spacedTop]}
          >
            <ThemedText type="smallBold">Add your first friend</ThemedText>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={friends}
          keyExtractor={(f) => String(f.githubId)}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
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
          <ThemedText type="default" style={styles.login}>
            @{friend.login}
          </ThemedText>
          <ThemedText type="small" style={styles.muted}>
            {friend.isOnCodeTrail ? 'On CodeTrail' : 'Not on CodeTrail'}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        onPress={onRemove}
        accessibilityLabel={`Stop following @${friend.login}`}
        style={({ pressed }) => [styles.removeBtn, pressed && styles.removeBtnPressed]}
      >
        <ThemedText type="small" style={styles.removeLabel}>
          Remove
        </ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  subhead: {
    color: '#8b949e',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  headerBtnPressed: {
    opacity: 0.6,
  },
  headerBtnLabel: {
    color: '#208AEF',
    fontWeight: '600',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
  },
  emptyHeading: {
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
    maxWidth: 280,
  },
  muted: {
    color: '#8b949e',
  },
  spacedTop: {
    marginTop: Spacing.three,
  },
  button: {
    backgroundColor: '#208AEF',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: 8,
  },
  retry: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
  },
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
  rowMainPressed: {
    opacity: 0.6,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#21262d',
  },
  rowText: {
    flex: 1,
  },
  login: {
    fontSize: 16,
    fontWeight: '600',
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#21262d',
  },
  removeBtn: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
  },
  removeBtnPressed: {
    backgroundColor: '#161b22',
  },
  removeLabel: {
    color: '#8b949e',
    fontSize: 12,
    fontWeight: '600',
  },
});

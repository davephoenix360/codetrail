/**
 * useFriends — auto-loading hook for the current user's friend list.
 *
 * Mirrors the pattern of useStreak / useAuth: subscribe to Firestore
 * once on mount, expose a refresh function for pull-to-refresh, and
 * surface loading/error states. Add/remove are passed-through to
 * firebase-friends so the caller can wire them to UI buttons.
 *
 * We don't auto-poll. The list is small and changes infrequently;
 * pull-to-refresh is enough for MVP. v2.0: onSnapshot for real-time
 * updates.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  addFriend as addFriendOp,
  listFriends,
  removeFriend as removeFriendOp,
  type Friend,
  type ResolvedFriend,
} from '@/lib/firebase-friends';

export const FRIEND_CAP = 25;

type LoadState = 'loading' | 'ready' | 'error';

interface UseFriendsResult {
  state: LoadState;
  friends: Friend[];
  error: string | null;
  refresh: () => Promise<void>;
  add: (resolved: ResolvedFriend) => Promise<Friend>;
  remove: (githubId: number) => Promise<void>;
}

export function useFriends(uid: string | null): UseFriendsResult {
  const [state, setState] = useState<LoadState>('loading');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!uid) {
      setFriends([]);
      setState('ready');
      return;
    }
    setError(null);
    try {
      const list = await listFriends(uid);
      setFriends(list);
      setState('ready');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load your friends.';
      setError(msg);
      setState('error');
    }
  }, [uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (resolved: ResolvedFriend) => {
      if (!uid) throw new Error('Not signed in.');
      if (friends.length >= FRIEND_CAP) {
        throw new Error(`You can follow up to ${FRIEND_CAP} friends. Remove one to add another.`);
      }
      const friend = await addFriendOp(uid, resolved);
      // Optimistic-ish: re-fetch the list so ordering by `addedAt desc`
      // is correct. A single doc write is cheap.
      await refresh();
      return friend;
    },
    [uid, friends.length, refresh],
  );

  const remove = useCallback(
    async (githubId: number) => {
      if (!uid) throw new Error('Not signed in.');
      await removeFriendOp(uid, githubId);
      // Optimistic update: drop from local state immediately.
      setFriends((prev) => prev.filter((f) => f.githubId !== githubId));
    },
    [uid],
  );

  return { state, friends, error, refresh, add, remove };
}

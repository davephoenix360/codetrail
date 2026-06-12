/**
 * useFeed — cache-first hook for the friends activity feed.
 *
 * Strategy:
 *  - On mount, show the cached entries immediately (if any)
 *  - If cache is stale OR missing, trigger a fresh fetch
 *  - On fetch error, keep showing the cache (if present) and surface
 *    a "couldn't refresh" error so the UI can show a small banner
 *  - No auto-polling. Pull-to-refresh on the parent screen does it.
 *
 * The hook re-fetches when the friends list changes (so adding a
 * friend triggers an immediate feed refresh) but NOT on every render.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { FeedEntry, FeedResponse } from '@/lib/github-api';
import { getFriendFeed, GitHubApiError } from '@/lib/github-api';
import { getCachedFeed, isStale, setCachedFeed } from '@/lib/feed-cache';
import type { Friend } from '@/lib/firebase-friends';

interface UseFeedInput {
  uid: string | null;
  accessToken: string | null;
  friends: Friend[];
}

interface UseFeedResult {
  state: 'loading' | 'ready' | 'error' | 'empty';
  entries: FeedEntry[];
  error: string | null;
  stale: boolean; // true if cache exists but is older than 1 hour
  refresh: () => Promise<void>;
}

export function useFeed({ uid, accessToken, friends }: UseFeedInput): UseFeedResult {
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [stale, setStale] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [error, setError] = useState<string | null>(null);

  // Track the most recent fetch so we can ignore late-arriving results
  // (e.g. if a fast second refresh is fired before a slow first one).
  const fetchIdRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!uid || !accessToken) return;
    if (friends.length === 0) {
      setEntries([]);
      setStale(false);
      setState('empty');
      setError(null);
      return;
    }
    const myFetchId = ++fetchIdRef.current;
    setError(null);
    if (__DEV__) {
      console.log('[useFeed] refreshing', { friendsCount: friends.length, fetchId: myFetchId });
    }
    try {
      const response: FeedResponse = await getFriendFeed(
        accessToken,
        friends.map((f) => ({
          githubId: f.githubId,
          login: f.login,
          avatarUrl: f.avatarUrl,
          htmlUrl: f.htmlUrl,
          isOnCodeTrail: f.isOnCodeTrail,
          friendUid: f.friendUid,
        })),
        { days: 7, maxFriends: 25 },
      );
      // Bail if a newer fetch has started.
      if (myFetchId !== fetchIdRef.current) return;
      if (__DEV__) {
        console.log('[useFeed] response', {
          entries: response.entries.length,
          failedFriends: response.failedFriends,
          rateLimited: response.rateLimited,
        });
      }
      setEntries(response.entries);
      setStale(false);
      setState(response.entries.length === 0 ? 'empty' : 'ready');
      void setCachedFeed(uid, response);
    } catch (e) {
      if (myFetchId !== fetchIdRef.current) return;
      const msg =
        e instanceof GitHubApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Could not load your friends\' ships.';
      if (__DEV__) {
        console.warn('[useFeed] refresh failed:', msg);
      }
      setError(msg);
      setState(entries.length > 0 ? 'ready' : 'error');
    }
  }, [uid, accessToken, friends, entries.length]);

  // Initial mount: show cache, then refresh in background if stale.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!uid) {
        setEntries([]);
        setState('empty');
        return;
      }
      const cached = await getCachedFeed(uid);
      if (cancelled) return;
      if (cached) {
        setEntries(cached.response.entries);
        setStale(isStale(cached));
        setState(cached.response.entries.length === 0 ? 'empty' : 'ready');
        // If stale OR no friends yet in cache, refresh in background.
        if (isStale(cached) || friends.length > 0) {
          void refresh();
        }
      } else if (friends.length > 0) {
        // No cache, have friends: show loading then fetch.
        setState('loading');
        await refresh();
      } else {
        setState('empty');
      }
    })();
    return () => {
      cancelled = true;
    };
    // Intentionally only re-run on identity change. `refresh` is stable
    // via its useCallback deps; we don't want to re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, friends.length === 0, friends.length]);

  return { state, entries, error, stale, refresh };
}

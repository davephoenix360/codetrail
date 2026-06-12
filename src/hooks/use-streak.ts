/**
 * useStreak — load the user's commit activity from cache or GitHub.
 *
 * Strategy:
 *   1. On mount, check the stored `streakData` on the user profile.
 *      - If present AND recent (< 1 hour): return it directly. No
 *        API call. The dashboard renders instantly.
 *      - If missing OR stale: call loadStreak() (GitHub API), then
 *        write the result back via `onUpdate` so the next mount is
 *        fast.
 *   2. If repos.length === 0: short-circuit to 'idle'. The user
 *      hasn't tracked anything yet; no streak to compute.
 *   3. `refresh()` always re-computes from GitHub (used by pull-to-
 *      refresh on /repos).
 *
 * For NEW users, the stored streak is 0 / streakData is null. The
 * auth-callback initializes these on sign-up so the dashboard
 * renders "🔥 0" instantly with no API call.
 */
import { useCallback, useEffect, useState } from 'react';

import { GitHubApiError } from '@/lib/github-api';
import { loadStreak, type StreakResult } from '@/lib/streak';
import type { TrackedRepo } from '@/lib/firebase-repos';
import type { StreakSnapshot } from '@/lib/account-types';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface UseStreakArgs {
  /** GitHub OAuth access token. Null if not loaded yet. */
  accessToken: string | null;
  /** The user's GitHub login. Null if profile not loaded. */
  login: string | null;
  /** Tracked repos. Empty array if not loaded yet. */
  repos: TrackedRepo[];
  /** Cached streak result from the user profile. Undefined if not yet loaded. */
  storedStreakData: StreakSnapshot | null | undefined;
  /** When `storedStreakData` was last refreshed (ms epoch). */
  storedStreakUpdatedAt: number | null | undefined;
  /** Called with the fresh result after a successful loadStreak() so the
   *  parent can write it back to Firestore. */
  onUpdate?: (snapshot: StreakSnapshot) => void;
}

export type StreakState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: StreakResult; fromCache: boolean }
  | { status: 'error'; message: string; partialData?: StreakResult };

/**
 * Convert a YYYY-MM-DD date string to a full ISO timestamp at UTC midnight.
 * Used when caching: the in-memory result uses just the date key, but the
 * stored snapshot keeps the full ISO so we can compute `daysSinceLastShip`
 * on read-back without timezone ambiguity.
 */
function dateKeyToIso(dateKey: string): string {
  return `${dateKey}T00:00:00.000Z`;
}

function isoToDateKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Convert a StreakSnapshot (cached in Firestore) back to a StreakResult. */
function snapshotToResult(snap: StreakSnapshot): StreakResult {
  return {
    streak: snap.streak,
    shippedToday: snap.shippedToday,
    weekly: snap.weekly.map((d) => ({ date: d.date, count: d.count })),
    totalCommits: snap.totalCommits,
    generatedAt: Date.now(),
    reposScanned: 0, // unknown from cache
    reposFailed: [],
    lastShipped: snap.lastShippedAt ? isoToDateKey(snap.lastShippedAt) : null,
    daysSinceLastShip: snap.daysSinceLastShip,
    forgotToPushHint: snap.forgotToPushHint,
  };
}

/** Convert a StreakResult to a StreakSnapshot for Firestore storage. */
function resultToSnapshot(result: StreakResult): StreakSnapshot {
  return {
    streak: result.streak,
    shippedToday: result.shippedToday,
    totalCommits: result.totalCommits,
    lastShippedAt: result.lastShipped ? dateKeyToIso(result.lastShipped) : null,
    daysSinceLastShip: result.daysSinceLastShip,
    forgotToPushHint: result.forgotToPushHint,
    weekly: result.weekly.map((d) => ({ date: d.date, count: d.count })),
  };
}

function isCacheFresh(updatedAt: number | null | undefined): boolean {
  if (!updatedAt) return false;
  return Date.now() - updatedAt < CACHE_TTL_MS;
}

export function useStreak({
  accessToken,
  login,
  repos,
  storedStreakData,
  storedStreakUpdatedAt,
  onUpdate,
}: UseStreakArgs): {
  state: StreakState;
  refresh: () => void;
} {
  const [state, setState] = useState<StreakState>({ status: 'idle' });
  // Bumped to force a re-fetch (used by refresh()).
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    // Gate: we need login at minimum (to filter the author on GitHub).
    if (!login) {
      setState({ status: 'idle' });
      return;
    }
    if (repos.length === 0) {
      // No repos tracked — no streak to compute. Render the empty state
      // from the parent instead of an error.
      setState({ status: 'idle' });
      return;
    }

    // CACHE PATH: if we have a recent snapshot, use it directly. No
    // API call. The dashboard renders instantly. This is the main
    // optimization the new storage layer enables.
    if (storedStreakData && isCacheFresh(storedStreakUpdatedAt)) {
      if (__DEV__) {
        console.log('[useStreak] cache hit', {
          streak: storedStreakData.streak,
          updatedAt: storedStreakUpdatedAt,
        });
      }
      setState({
        status: 'ready',
        data: snapshotToResult(storedStreakData),
        fromCache: true,
      });
      return;
    }

    // COMPUTE PATH: cache missing or stale. Hit GitHub.
    // (We still need an accessToken for the GitHub API call.)
    if (!accessToken) {
      setState({ status: 'idle' });
      return;
    }
    const ac = new AbortController();
    setState({ status: 'loading' });

    void (async () => {
      try {
        const data = await loadStreak(accessToken, login, repos, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setState({ status: 'ready', data, fromCache: false });
        if (onUpdate) {
          onUpdate(resultToSnapshot(data));
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        const message =
          e instanceof GitHubApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Could not load your streak.';
        if (__DEV__) console.warn('[useStreak] load failed:', message);
        setState({ status: 'error', message });
      }
    })();

    return () => ac.abort();
  }, [accessToken, login, repos, refreshTick, storedStreakData, storedStreakUpdatedAt, onUpdate]);

  return { state, refresh };
}

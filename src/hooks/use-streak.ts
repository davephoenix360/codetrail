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
 *      refresh on /repos) — the cache is bypassed on forced refresh
 *      because the user explicitly asked for fresh data.
 *
 * For NEW users, the stored streak is 0 / streakData is null. The
 * auth-callback initializes these on sign-up so the dashboard
 * renders "🔥 0" instantly with no API call.
 *
 * ### Effect-dep hygiene
 *
 * `onUpdate` and the stored cache data are passed in by the caller
 * and are typically new references on every render (`onUpdate` is
 * usually an inline arrow; `storedStreakData` is a sub-object of a
 * Firestore snapshot that gets replaced whenever the profile
 * updates). Including them in the effect's dep array would cause an
 * infinite loop:
 *
 *   render → new `onUpdate` ref → effect fires → setState → render
 *   → new `onUpdate` ref → effect fires → ...
 *
 * We stash both in refs and update the refs on every render, so the
 * effect always reads the latest values when it fires, but the
 * effect's identity stays stable. The effect's deps are only the
 * things that should *cause* a re-fetch: `accessToken`, `login`,
 * `repos`, and the `refreshTick` counter.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

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

  // Stash volatile inputs in refs. The parent typically passes
  // onUpdate as an inline arrow and storedStreakData as a sub-object
  // of a Firestore snapshot — both are new references on every render
  // even when the underlying value didn't change. If we put them in
  // the effect's deps, the effect re-fires on every render and we get
  // "Maximum update depth exceeded". The refs let the effect read the
  // latest values without re-firing.
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const cacheRef = useRef({ storedStreakData, storedStreakUpdatedAt });
  cacheRef.current = { storedStreakData, storedStreakUpdatedAt };

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

    // CACHE PATH: if this is NOT a forced refresh, try the cache.
    // On refreshTick > 0 the user explicitly asked for fresh data, so
    // skip the cache and recompute from GitHub. Otherwise the cache is
    // still valid (just written by us, or recently persisted) — no
    // point in hitting the API again.
    if (refreshTick === 0) {
      const { storedStreakData: cache, storedStreakUpdatedAt: updatedAt } = cacheRef.current;
      if (cache && isCacheFresh(updatedAt)) {
        if (__DEV__) {
          console.log('[useStreak] cache hit', {
            streak: cache.streak,
            updatedAt,
          });
        }
        setState({
          status: 'ready',
          data: snapshotToResult(cache),
          fromCache: true,
        });
        return;
      }
    }

    // COMPUTE PATH: cache missing or stale (or forced refresh). Hit GitHub.
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
        if (onUpdateRef.current) {
          onUpdateRef.current(resultToSnapshot(data));
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
  }, [accessToken, login, repos, refreshTick]);

  return { state, refresh };
}

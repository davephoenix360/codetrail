/**
 * useStreak — load and cache the user's commit activity.
 *
 * Auto-fetches on mount and whenever the inputs change (user, repos,
 * token). Exposes a `refresh` function for pull-to-refresh on /repos.
 *
 * Does NOT auto-poll. The /repos screen will refresh on each visit;
 * within a session, the cached result is reused until the user pulls
 * down or signs out.
 *
 * Why no auto-poll: GitHub's rate limit is 5,000 req/hr per user. With
 * 5 tracked repos, each refresh is 5 calls. A 5-minute polling
 * interval = 60 calls/hr, well under. But polling drains battery on
 * the user's phone — better to fetch on view. v2.0 will add a
 * background refresh on app foreground.
 */
import { useCallback, useEffect, useState } from 'react';

import { GitHubApiError } from '@/lib/github-api';
import { loadStreak, type StreakResult } from '@/lib/streak';
import type { TrackedRepo } from '@/lib/firebase-repos';

export interface UseStreakArgs {
  /** GitHub OAuth access token. Null if not loaded yet. */
  accessToken: string | null;
  /** The user's GitHub login. Null if profile not loaded. */
  login: string | null;
  /** Tracked repos. Empty array if not loaded yet. */
  repos: TrackedRepo[];
}

export type StreakState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: StreakResult }
  | { status: 'error'; message: string; partialData?: StreakResult };

export function useStreak({ accessToken, login, repos }: UseStreakArgs): {
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
    // Gate: we need all three inputs to make a request.
    if (!accessToken || !login) {
      setState({ status: 'idle' });
      return;
    }
    if (repos.length === 0) {
      // No repos tracked — no streak to compute. Render the empty state
      // from the parent instead of an error.
      setState({ status: 'idle' });
      return;
    }

    // AbortController to cancel on unmount or inputs change.
    const ac = new AbortController();
    setState({ status: 'loading' });

    void (async () => {
      try {
        const data = await loadStreak(accessToken, login, repos, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setState({ status: 'ready', data });
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

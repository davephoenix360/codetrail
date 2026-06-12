/**
 * The shape of `users/{uid}` — the app-level user profile (single-account MVP).
 *
 * For MVP, the user has ONE GitHub account. The OAuth access token is stored
 * directly on the profile doc (we need it for GitHub API calls; the Firebase
 * auth session doesn't expose it back). When we add multi-account in v2.0,
 * the token will move to a per-account subcollection.
 *
 * ## `description` and `language` are optional
 * GitHub's API returns `null` for missing optional fields. Firestore
 * rejects `null` in writes, so `lib/firebase-repos.ts` strips them
 * before writing. On read-back, the field will be `undefined` (not
 * present in the doc). Keep this in mind when accessing optional fields.
 *
 * ## Streak cache (Phase 2.6+)
 * `streak`, `lastShippedAt`, `streakData`, `streakUpdatedAt` are the
 * cached output of `loadStreak()`. We store them so the dashboard
 * renders instantly on /repos mount without re-fetching from GitHub
 * every time. The hook refreshes from GitHub if the cache is stale
 * (> 1 hour) or missing, then writes back via `updateStreak()`.
 *
 * For new users (just signed up, no commits), these are all 0 / null
 * — the UI shows "🔥 0" immediately without any API call.
 */
export interface StreakSnapshot {
  /** Current streak (consecutive shipping days, within the 2-day grace). */
  streak: number;
  /** True if the user shipped at least one commit today (device-local). */
  shippedToday: boolean;
  /** Total commits in the last 7 days, across all tracked repos. */
  totalCommits: number;
  /** ISO 8601 string of the most recent commit, or null if none. */
  lastShippedAt: string | null;
  /** Days since last ship. null if never shipped. */
  daysSinceLastShip: number | null;
  /** True if weekly has activity but streak is 0 (the "did you forget to push?" hint). */
  forgotToPushHint: boolean;
  /** 7-bar weekly chart, oldest first. `date` is YYYY-MM-DD (device-local). */
  weekly: Array<{ date: string; count: number }>;
}

export interface UserProfile {
  /** Firebase auth UID (also the Firestore doc ID). */
  uid: string;
  /** GitHub's stable numeric user ID. Will become a linked-account ID in v2.0. */
  githubId: number;
  /** GitHub login (e.g., "davephoenix360"). NOT stable — user can rename. */
  login: string;
  /** Avatar URL. */
  avatarUrl: string;
  /** Current OAuth access token. Used for GitHub API calls. */
  githubAccessToken: string;
  /** When the user first signed in (ms epoch). */
  createdAt: number;
  /** When the user last used the app (ms epoch). */
  lastSeenAt: number;
  // ---- Streak cache (Phase 2.6+) ----
  /** Current streak. 0 for new users. */
  streak?: number;
  /** When the user last shipped a commit (ms epoch). null if never. */
  lastShippedAt?: number | null;
  /** Cached full streak result. null for new users. */
  streakData?: StreakSnapshot | null;
  /** When streakData was last refreshed from GitHub (ms epoch). */
  streakUpdatedAt?: number | null;
}

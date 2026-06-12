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
 */
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
}

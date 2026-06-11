/**
 * Types for the multi-account / linked GitHub accounts model.
 *
 * See BRIEF.md decision log (2026-06-11) and skill `oauth-with-linked-accounts`
 * for the full design rationale.
 *
 * ## Data model
 * - `users/{uid}/linkedAccounts/{githubId}`: one doc per linked GitHub account.
 *   The `githubId` is GitHub's stable numeric user ID (NOT the login).
 *   Login can change; ID cannot.
 * - `githubAccounts/{githubId}`: PUBLIC lookup index. Maps a GitHub ID to
 *   the Firebase UID that owns it. Used during sign-in to detect
 *   "this GitHub account is already linked to someone."
 *
 * ## `description` and `language` are optional
 * GitHub's API returns `null` for missing optional fields. Firestore
 * rejects `null` in writes, so `firebase-repos.ts` and
 * `firebase-accounts.ts` both strip them before writing. On read-back,
 * the field will be `undefined` (not present in the doc).
 */
import type { GitHubUser } from './github-api';

/**
 * A GitHub account linked to a CodeTrail user.
 *
 * Stored at `users/{uid}/linkedAccounts/{githubId}`.
 * The `githubId` is the doc ID.
 */
export interface LinkedAccount {
  /** GitHub's stable user ID. The doc ID in Firestore. */
  githubId: number;
  /** GitHub login (e.g., "davephoenix360"). NOT stable — user can rename. */
  login: string;
  /** Current OAuth access token (server-persisted; we read it for API calls). */
  accessToken: string;
  /** Avatar URL. */
  avatarUrl: string;
  /** Whether this is the primary account (mirrors users/{uid}.primaryGithubId). */
  isPrimary: boolean;
  /** When the user first linked this account. */
  linkedAt: number; // ms epoch
}

/**
 * The shape of `users/{uid}` — the app-level user profile.
 *
 * For Phase 2.5, this just has the primaryGitHubId. We'll add more fields
 * (displayName preferences, notification settings, etc.) as we go.
 */
export interface UserProfile {
  uid: string;
  /** The GitHub account that is the default for new actions. */
  primaryGithubId: number;
  createdAt: number; // ms epoch
  lastSeenAt: number; // ms epoch
}

/**
 * The PUBLIC lookup doc at `githubAccounts/{githubId}`.
 *
 * The `uid` field is the only thing that maps a GitHub ID to a Firebase
 * UID. This is the data the security tradeoff in BRIEF.md is about.
 */
export interface GitHubAccountLookup {
  /** The Firebase UID that owns this GitHub account. */
  uid: string;
  /** GitHub login (public info, also on github.com). */
  login: string;
  /** Avatar URL (public info). */
  avatarUrl: string;
  /** When the link was created. */
  linkedAt: number; // ms epoch
}

/**
 * The 4-case sign-in result.
 *
 * Used by the auth callback handler to decide what to do after OAuth.
 * See skill `oauth-with-linked-accounts` for the full description of each
 * case.
 */
export type SignInCase =
  /** Not yet linked, not signed in → first-time signup. Create everything. */
  | { kind: 'newUser'; githubProfile: GitHubUser }
  /** Already linked to an existing user, not signed in → block sign-in. */
  | { kind: 'alreadyLinkedToOtherUser'; existingUid: string; existingLogin: string; githubProfile: GitHubUser }
  /** Already linked, currently signed in to that user → normal sign-in. */
  | { kind: 'existingUser'; uid: string; githubProfile: GitHubUser }
  /** Not yet linked, but the user is signed in to a different account → link it. */
  | { kind: 'linkToCurrentUser'; currentUid: string; githubProfile: GitHubUser };

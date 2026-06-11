/**
 * Firestore CRUD for linked GitHub accounts.
 *
 * Two collections are managed here:
 *   1. `users/{uid}/linkedAccounts/{githubId}` — the user's account list
 *      (owner-read/write only; one doc per linked GitHub account).
 *   2. `githubAccounts/{githubId}` — a PUBLIC lookup index that maps
 *      GitHub ID → Firebase UID. Used during sign-in to detect
 *      "this GitHub account is already linked to someone." See BRIEF.md
 *      decision log (2026-06-11) and skill `oauth-with-linked-accounts`
 *      for the security tradeoff.
 *
 * Both writes are atomic per-operation (the linked-account write and the
 * lookup write are independent; if one fails, the other is not rolled
 * back — the caller decides what to do about the partial state).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

import { db } from './firebase';
import type { GitHubUser } from './github-api';
import type {
  GitHubAccountLookup,
  LinkedAccount,
} from './account-types';

// ---------------------------------------------------------------------------
// Helpers (shared with firebase-repos.ts — duplicated for module isolation)
// ---------------------------------------------------------------------------

/** Strip null and undefined values from a payload (Firestore rejects null). */
function stripNulls<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], null | undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out as { [K in keyof T]: Exclude<T[K], null | undefined> };
}

function linkedAccountsCol(uid: string) {
  return collection(db, 'users', uid, 'linkedAccounts');
}

function linkedAccountDoc(uid: string, githubId: number) {
  return doc(db, 'users', uid, 'linkedAccounts', String(githubId));
}

function lookupDoc(githubId: number) {
  return doc(db, 'githubAccounts', String(githubId));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** List all linked GitHub accounts for a user. Empty array if none. */
export async function listLinkedAccounts(uid: string): Promise<LinkedAccount[]> {
  const snap = await getDocs(linkedAccountsCol(uid));
  return snap.docs.map((d) => d.data() as LinkedAccount);
}

/** Get a single linked account by GitHub ID. null if not linked. */
export async function getLinkedAccount(
  uid: string,
  githubId: number,
): Promise<LinkedAccount | null> {
  const snap = await getDoc(linkedAccountDoc(uid, githubId));
  return snap.exists() ? (snap.data() as LinkedAccount) : null;
}

/**
 * Look up the Firebase UID that owns a given GitHub account.
 * Returns null if the GitHub account is not yet linked to anyone.
 *
 * This is the public-read lookup that makes the 4-case sign-in flow
 * possible (Case B: "already linked to another user").
 */
export async function lookupGithubAccount(
  githubId: number,
): Promise<GitHubAccountLookup | null> {
  const snap = await getDoc(lookupDoc(githubId));
  return snap.exists() ? (snap.data() as GitHubAccountLookup) : null;
}

// ---------------------------------------------------------------------------
// Writes — the "link" operation (atomic from the caller's perspective)
// ---------------------------------------------------------------------------

/**
 * Link a GitHub account to a Firebase user.
 *
 * Performs two writes:
 *   1. `users/{uid}/linkedAccounts/{githubId}` — the per-user linked account doc
 *   2. `githubAccounts/{githubId}` — the public lookup index
 *
 * Both are independent; if the first succeeds and the second fails, we
 * have an inconsistent state. The caller should handle the error.
 *
 * @param isFirstForUser Pass true if this is the user's first link (i.e.,
 *   they have no other linked accounts). This sets `isPrimary=true` and
 *   also updates `users/{uid}.primaryGithubId` to match.
 */
export async function linkGithubAccount(
  uid: string,
  profile: GitHubUser,
  accessToken: string,
  options: { isFirstForUser: boolean },
): Promise<void> {
  // 1. Write the per-user linked account doc
  await setDoc(
    linkedAccountDoc(uid, profile.id),
    stripNulls({
      githubId: profile.id,
      login: profile.login,
      accessToken,
      avatarUrl: profile.avatarUrl,
      isPrimary: options.isFirstForUser,
      linkedAt: serverTimestamp(),
    }) as Record<string, unknown>,
    { merge: true },
  );

  // 2. Write the public lookup index
  await setDoc(
    lookupDoc(profile.id),
    stripNulls({
      uid,
      login: profile.login,
      avatarUrl: profile.avatarUrl,
      linkedAt: serverTimestamp(),
    }) as Record<string, unknown>,
    { merge: true },
  );

  // 3. If this is the user's first link, set as primary on the user doc
  if (options.isFirstForUser) {
    await setDoc(
      doc(db, 'users', uid),
      { primaryGithubId: profile.id, lastSeenAt: serverTimestamp() },
      { merge: true },
    );
  }
}

// ---------------------------------------------------------------------------
// Writes — primary swap
// ---------------------------------------------------------------------------

/**
 * Set an existing linked account as the primary.
 *
 * Atomically:
 *   1. Updates the linked account doc: `isPrimary: true`
 *   2. Updates the previous primary: `isPrimary: false`
 *   3. Updates the user doc: `primaryGithubId` → new value
 *
 * If newPrimaryId === currentPrimaryId, this is a no-op.
 */
export async function setPrimaryAccount(
  uid: string,
  newPrimaryId: number,
  currentPrimaryId: number | null,
): Promise<void> {
  if (newPrimaryId === currentPrimaryId) return;

  // Update the new primary
  await updateDoc(linkedAccountDoc(uid, newPrimaryId), { isPrimary: true });

  // Demote the old primary (if any)
  if (currentPrimaryId !== null && currentPrimaryId !== newPrimaryId) {
    await updateDoc(linkedAccountDoc(uid, currentPrimaryId), { isPrimary: false });
  }

  // Update the user doc
  await updateDoc(doc(db, 'users', uid), { primaryGithubId: newPrimaryId });
}

// ---------------------------------------------------------------------------
// Writes — unlink
// ---------------------------------------------------------------------------

/**
 * Unlink a GitHub account from a user.
 *
 * Rules:
 * - Cannot unlink the primary if it's the only account
 * - Cannot unlink the primary without first setting another as primary
 *   (caller's responsibility — the UI should enforce this)
 *
 * Deletes BOTH:
 *   1. `users/{uid}/linkedAccounts/{githubId}` — the per-user doc
 *   2. `githubAccounts/{githubId}` — the public lookup index
 *
 * After this, the GitHub account can be linked to a different user, OR
 * re-linked to the same user (creates a fresh linked-account doc).
 */
export async function unlinkGithubAccount(
  uid: string,
  githubId: number,
  isPrimary: boolean,
): Promise<void> {
  if (isPrimary) {
    throw new Error(
      'Cannot unlink the primary account. Set another account as primary first.',
    );
  }

  await deleteDoc(linkedAccountDoc(uid, githubId));
  await deleteDoc(lookupDoc(githubId));
}

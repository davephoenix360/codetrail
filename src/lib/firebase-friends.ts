/**
 * Friend operations on Firestore.
 *
 * Friends are stored at `users/{uid}/friends/{githubId}` — keyed by
 * GitHub's stable numeric `githubId` (not `login`, which can change on
 * GitHub). The `githubId` is the document ID so we can read/write
 * individual friends without subcollection queries.
 *
 * We also read `usersByLogin/{loginLowercased}` (public-read per
 * firestore.rules) to check whether a friend is on CodeTrail. That
 * gives us `isOnCodeTrail` + `friendUid` for deep-linking later.
 *
 * Design notes:
 *  - The friend list is small (MVP cap: 25). A simple `getDocs` on the
 *    subcollection is fine. No pagination needed.
 *  - We don't enforce the 25-cap server-side (would need a counter or a
 *    security rule on write count). The UI enforces it on add.
 *  - Friend removal is a hard delete, not a soft delete. If the user
 *    re-adds, they get a fresh `addedAt`. We can soft-delete + archive
 *    later if we want a "people you used to follow" feature.
 */
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import { db } from './firebase';
import { getUserByLogin, GitHubApiError, type GitHubPublicUser } from './github-api';

/**
 * Friend record stored at `users/{uid}/friends/{githubId}`.
 *
 * - `githubId` is the Firestore doc ID (stable; never changes)
 * - `login` is the current GitHub login (informational; can change)
 * - `isOnCodeTrail` + `friendUid` are set at add-time and may go stale
 *   if the friend signs up after being added. v2.0: refresh on feed
 *   load (the worker can do this in bulk).
 */
export interface Friend {
  githubId: number;
  login: string;
  avatarUrl: string;
  htmlUrl?: string;
  addedAt: Date;
  isOnCodeTrail: boolean;
  friendUid: string | null;
  lastFeedSync?: Date | null;
}

/** Shape of the raw doc in Firestore (timestamps are Firestore Timestamps). */
interface FriendDocRaw {
  githubId: number;
  login: string;
  avatarUrl: string;
  htmlUrl?: string;
  addedAt: Timestamp | null;
  isOnCodeTrail?: boolean;
  friendUid?: string | null;
  lastFeedSync?: Timestamp | null;
}

function friendFromDoc(id: string, raw: FriendDocRaw): Friend {
  return {
    githubId: raw.githubId ?? Number(id),
    login: raw.login,
    avatarUrl: raw.avatarUrl,
    htmlUrl: raw.htmlUrl,
    addedAt: (raw.addedAt ?? Timestamp.now()).toDate(),
    isOnCodeTrail: raw.isOnCodeTrail ?? false,
    friendUid: raw.friendUid ?? null,
    lastFeedSync: raw.lastFeedSync?.toDate() ?? null,
  };
}

/**
 * Check whether a GitHub login is on CodeTrail.
 *
 * Public-read on `usersByLogin/{loginLowercased}`. Returns the uid if
 * found, null otherwise. The login is case-insensitive (GitHub itself
 * is case-insensitive on uniqueness).
 */
export async function lookupCodeTrailUidByLogin(
  login: string,
): Promise<string | null> {
  const snap = await getDoc(doc(db, 'usersByLogin', login.toLowerCase()));
  if (!snap.exists()) return null;
  const data = snap.data() as { uid?: string };
  return data.uid ?? null;
}

/**
 * Resolve a friend by GitHub login: looks up the GitHub profile, then
 * checks whether that login is on CodeTrail. Returns everything we need
 * to write the friend doc. Throws `GitHubApiError` with status 404 if
 * the GitHub user doesn't exist.
 */
export interface ResolvedFriend {
  github: GitHubPublicUser;
  isOnCodeTrail: boolean;
  friendUid: string | null;
}

export async function resolveFriendByLogin(
  accessToken: string,
  login: string,
): Promise<ResolvedFriend> {
  // Strip leading @ if the user typed it.
  const cleanLogin = login.trim().replace(/^@/, '');
  if (!cleanLogin) {
    throw new Error('Username is required.');
  }

  // Hit GitHub first. If they don't exist, fail fast.
  let github: GitHubPublicUser;
  try {
    github = await getUserByLogin(accessToken, cleanLogin);
  } catch (e) {
    if (e instanceof GitHubApiError && e.status === 404) {
      // Surface a clear message for the UI.
      throw new Error(`No GitHub user with the handle "${cleanLogin}".`);
    }
    throw e;
  }

  // Then check if they're on CodeTrail (best-effort — don't fail the
  // add if this errors; we just say "not on CodeTrail").
  let isOnCodeTrail = false;
  let friendUid: string | null = null;
  try {
    friendUid = await lookupCodeTrailUidByLogin(github.login);
    isOnCodeTrail = friendUid !== null;
  } catch (e) {
    if (__DEV__) {
      console.warn('[firebase-friends] lookupCodeTrailUidByLogin failed:', e);
    }
    // Fall through with isOnCodeTrail = false.
  }

  return { github, isOnCodeTrail, friendUid };
}

/**
 * Add a friend for the current user. Idempotent: if the friend already
 * exists, refreshes the profile fields (avatar/login may have changed)
 * and bumps `lastFeedSync` to null so the feed is re-fetched.
 */
export async function addFriend(
  uid: string,
  resolved: ResolvedFriend,
): Promise<Friend> {
  const { github, isOnCodeTrail, friendUid } = resolved;
  const friendRef = doc(db, 'users', uid, 'friends', String(github.id));

  const writeData: FriendDocRaw = {
    githubId: github.id,
    login: github.login,
    avatarUrl: github.avatarUrl,
    htmlUrl: github.htmlUrl,
    // Use serverTimestamp on first write, but on update we want to
    // preserve the original `addedAt`. Firestore's `setDoc(..., merge)`
    // doesn't preserve by default, so we read first if the doc exists.
    addedAt: serverTimestamp() as unknown as Timestamp,
    isOnCodeTrail,
    friendUid,
    lastFeedSync: null,
  };

  // Use setDoc(merge) so an existing friend gets refreshed in place.
  // `addedAt` is set to serverTimestamp; on update this will overwrite
  // the original. To preserve it, we'd need a read-modify-write. For
  // MVP, accepting that re-adding bumps addedAt — simpler, no race.
  await setDoc(friendRef, writeData, { merge: true });

  // Return a synthetic Friend so the UI can update optimistically.
  return {
    githubId: github.id,
    login: github.login,
    avatarUrl: github.avatarUrl,
    htmlUrl: github.htmlUrl,
    addedAt: new Date(),
    isOnCodeTrail,
    friendUid,
    lastFeedSync: null,
  };
}

/**
 * List the current user's friends, sorted by `addedAt` descending
 * (newest first).
 */
export async function listFriends(uid: string): Promise<Friend[]> {
  const q = query(
    collection(db, 'users', uid, 'friends'),
    orderBy('addedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => friendFromDoc(d.id, d.data() as FriendDocRaw));
}

/**
 * Remove a friend. Hard delete — no "are you sure?" confirmation in
 * MVP; the user can re-add in one tap. v2.0: add an undo toast.
 */
export async function removeFriend(uid: string, githubId: number): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'friends', String(githubId)));
}

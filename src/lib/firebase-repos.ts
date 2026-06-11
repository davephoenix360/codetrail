/**
 * Firestore CRUD for a user's tracked repos.
 *
 * Collection: users/{uid}/trackedRepos/{repoFullName}
 *   - Document ID = GitHub repo full name (e.g., "davephoenix360/codetrail")
 *     so uniqueness is natural and reads are O(1) per repo
 *   - The document itself stores a snapshot of repo metadata so we can
 *     render the list without re-fetching from GitHub on every screen
 *     mount. (A background sync is the v2.0 approach.)
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';

import { db } from './firebase';
import type { GitHubRepo } from './github-api';

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/**
 * A repo the user has chosen to track. Stored in Firestore.
 *
 * - `repoFullName` is the doc ID and the canonical identifier
 * - The rest is a snapshot of GitHub data at the time the user added it
 *   (we don't auto-refresh; v2.0 has a background sync)
 * - `description` and `language` may be `undefined` when read back from
 *   Firestore (we strip null values on write; the absence of a field is
 *   the canonical "no value" state)
 */
export interface TrackedRepo {
  repoId: number;
  repoFullName: string;
  name: string;
  description?: string | null;
  language?: string | null;
  stars: number;
  updatedAt: string;
  trackedAt: number; // ms epoch; set by the server timestamp on first write
  lastFetchedAt: number; // ms epoch; when we last refreshed from GitHub
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the Firestore collection reference for a user's tracked repos. */
function trackedReposCol(uid: string) {
  return collection(db, 'users', uid, 'trackedRepos');
}

/** Build the Firestore document reference for a single tracked repo. */
function trackedRepoDoc(uid: string, repoFullName: string) {
  return doc(db, 'users', uid, 'trackedRepos', repoFullName);
}

/**
 * Strip null and undefined values from a payload.
 *
 * Firestore rejects writes that contain a field with value `null` (e.g.,
 * "Unsupported field value: null"). GitHub's API returns `null` for repos
 * without a description or a primary language — so we have to scrub these
 * before calling setDoc. Missing fields are fine; the absence of a field
 * is what Firestore expects for "no value."
 */
function stripNulls<T extends Record<string, unknown>>(
  obj: T,
): { [K in keyof T]: Exclude<T[K], null | undefined> } {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  if (__DEV__) {
    // Diagnostic: show what was filtered. Cheap to log; only in dev.
    const filtered = Object.keys(obj).filter(
      (k) => obj[k] === null || obj[k] === undefined,
    );
    if (filtered.length > 0) {
      console.log(`[firebase-repos] stripNulls removed: ${filtered.join(', ')}`);
    }
  }
  return out as { [K in keyof T]: Exclude<T[K], null | undefined> };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** List all tracked repos for a user. Returns an empty array if none. */
export async function listTrackedRepos(uid: string): Promise<TrackedRepo[]> {
  const snap = await getDocs(trackedReposCol(uid));
  return snap.docs.map((d) => d.data() as TrackedRepo);
}

/** Check whether a specific repo is tracked by a user. */
export function isTracked(
  trackedRepos: TrackedRepo[],
  repoFullName: string,
): boolean {
  return trackedRepos.some((r) => r.repoFullName === repoFullName);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** Add (or update) a tracked repo. The repoFullName is the doc ID. */
export async function trackRepo(uid: string, repo: GitHubRepo): Promise<void> {
  const path = `users/${uid}/trackedRepos/${repo.fullName}`;
  const rawPayload = {
    repoId: repo.id,
    repoFullName: repo.fullName,
    name: repo.name,
    description: repo.description,
    language: repo.language,
    stars: repo.stars,
    updatedAt: repo.updatedAt,
    trackedAt: serverTimestamp(),
    lastFetchedAt: Date.now(),
  };
  const cleaned = stripNulls(rawPayload);

  if (__DEV__) {
    console.log(`[firebase-repos] trackRepo → ${path}`);
    console.log('[firebase-repos] raw payload:', JSON.stringify(rawPayload, null, 2));
    console.log('[firebase-repos] cleaned payload:', JSON.stringify(cleaned, null, 2));
  }

  try {
    await setDoc(trackedRepoDoc(uid, repo.fullName), cleaned, { merge: true });
    if (__DEV__) console.log(`[firebase-repos] trackRepo OK for ${repo.fullName}`);
  } catch (e) {
    // Re-throw with all error details. The caller in repos.tsx will
    // surface the message via Alert.
    if (__DEV__) {
      console.error(`[firebase-repos] trackRepo FAILED for ${repo.fullName}`);
      console.error('[firebase-repos] path:', path);
      console.error('[firebase-repos] cleaned payload (failing):', JSON.stringify(cleaned, null, 2));
      console.error('[firebase-repos] full error object:', e);
      console.error('[firebase-repos] error stack:', e instanceof Error ? e.stack : '<no stack>');
    }
    throw e;
  }
}

/** Remove a tracked repo. No-op if it wasn't tracked. */
export async function untrackRepo(uid: string, repoFullName: string): Promise<void> {
  await deleteDoc(trackedRepoDoc(uid, repoFullName));
}

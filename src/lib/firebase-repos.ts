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
 */
export interface TrackedRepo {
  repoId: number;
  repoFullName: string;
  name: string;
  description: string | null;
  language: string | null;
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
  await setDoc(
    trackedRepoDoc(uid, repo.fullName),
    {
      repoId: repo.id,
      repoFullName: repo.fullName,
      name: repo.name,
      description: repo.description,
      language: repo.language,
      stars: repo.stars,
      updatedAt: repo.updatedAt,
      trackedAt: serverTimestamp(),
      lastFetchedAt: Date.now(),
    },
    { merge: true },
  );
}

/** Remove a tracked repo. No-op if it wasn't tracked. */
export async function untrackRepo(uid: string, repoFullName: string): Promise<void> {
  await deleteDoc(trackedRepoDoc(uid, repoFullName));
}

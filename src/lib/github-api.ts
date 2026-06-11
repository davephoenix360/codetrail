/**
 * GitHub API client (proxied through the CodeTrail Cloudflare Worker).
 *
 * We never call api.github.com directly from the app. All calls go through
 * the worker at EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL so:
 *   - The access token never leaves our infra boundary
 *   - We get one place to handle rate limiting, error mapping, and logging
 *   - We can swap the GitHub API for a cached version later without
 *     touching the app
 */

const EXCHANGE_URL = process.env.EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL ?? '';

if (__DEV__ && !EXCHANGE_URL) {
  console.warn(
    '[github-api] EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL is not set — all API calls will fail',
  );
}

// ---------------------------------------------------------------------------
// Types (mirror the worker's response shapes — kept in sync manually for now)
// ---------------------------------------------------------------------------

export interface GitHubUser {
  /** Stable, unique GitHub user ID. Used as the Firestore doc ID everywhere. */
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
  bio: string | null;
  publicRepos: number;
  followers: number;
  following: number;
}

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  language: string | null;
  stars: number;
  updatedAt: string; // ISO 8601
  isPrivate: boolean;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when the worker returns a non-2xx or the network call fails. */
export class GitHubApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

// ---------------------------------------------------------------------------
// Core fetch helper
// ---------------------------------------------------------------------------

async function postToWorker<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!EXCHANGE_URL) {
    throw new GitHubApiError('Worker URL is not configured (EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL)');
  }

  let response: Response;
  try {
    response = await fetch(EXCHANGE_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // Network error (offline, DNS, etc.)
    const msg = e instanceof Error ? e.message : 'Unknown network error';
    throw new GitHubApiError(`Network error reaching worker: ${msg}`);
  }

  if (!response.ok) {
    // Worker returns { error: "..." } on non-2xx. Try to surface that.
    let workerMessage: string | undefined;
    try {
      const errBody = (await response.json()) as { error?: string };
      workerMessage = errBody.error;
    } catch {
      // body wasn't JSON
    }
    throw new GitHubApiError(
      workerMessage ?? `Worker returned HTTP ${response.status}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch the authenticated GitHub user's profile. */
export async function getCurrentUser(accessToken: string): Promise<GitHubUser> {
  return postToWorker<GitHubUser>('/user', { accessToken });
}

/**
 * List the authenticated user's public repos, sorted by most recently updated.
 * Returns up to 100 — for users with more, we'd need to paginate.
 */
export async function listMyRepos(accessToken: string): Promise<GitHubRepo[]> {
  return postToWorker<GitHubRepo[]>('/user/repos', { accessToken });
}

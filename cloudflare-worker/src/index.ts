/**
 * CodeTrail — Cloudflare Worker
 *
 * Endpoints:
 *   POST /                — Exchange a GitHub OAuth code for an access token.
 *                            The access token is returned to the client, which
 *                            uses it with signInWithCredential to sign in to
 *                            Firebase Auth.
 *   POST /user            — Get the authenticated GitHub user's profile
 *                            (login, name, avatar, bio, public repo count,
 *                            follower/following counts).
 *   POST /user/lookup     — Look up a public GitHub user by login. Used by
 *                            the add-friend flow. Returns 404 if no such
 *                            GitHub user.
 *   POST /user/repos      — List the authenticated user's public repos
 *                            (sorted by most recently updated, max 100).
 *   POST /repos/commits   — List a repo's commits by author since a date.
 *                            Returns trimmed { sha, date } array. Used by
 *                            the streak computation in lib/streak.ts.
 *   POST /friends/feed    — Aggregate a friends list's recent commits
 *                            (Phase 3). For each friend, fetches their
 *                            recently-pushed public repos, then commits
 *                            in each repo, and aggregates per-friend
 *                            per-day. Returns a sorted feed (newest first,
 *                            top 100).
 *
 * Secrets (set via `wrangler secret put`):
 *   GITHUB_OAUTH_CLIENT_ID       — OAuth app's public client_id
 *   GITHUB_OAUTH_CLIENT_SECRET   — OAuth app's private client_secret
 *                                  (NEVER expose to the client)
 *
 * Why a Worker, not Cloud Functions?
 *   Workers' free tier is 100k req/day with no credit card. Cloud Functions
 *   requires the Blaze (pay-as-you-go) plan to make outbound HTTPS calls
 *   (which we need, to reach api.github.com).
 */
export interface Env {
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
}

// CORS headers — we allow any origin since this is a public proxy endpoint.
// (The GitHub access tokens the app exchanges are short-lived, scoped to
// public_repo, and useless to an attacker who intercepts them in flight
// because they're bound to the user's own GitHub account.)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

const GITHUB_API_BASE = 'https://api.github.com';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  extra?: Record<string, unknown>,
): void {
  const entry = { level, message, timestamp: new Date().toISOString(), ...extra };
  // Workers' console.log is captured in the Cloudflare dashboard logs.
  console.log(JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

/**
 * Make an authenticated call to the GitHub REST API on behalf of a user.
 * Returns the parsed JSON body. Throws a descriptive Error on non-2xx.
 *
 * We use the user's own OAuth access token (sent from the app), not a
 * server-side GitHub App token. This way:
 *   - Each user is rate-limited on their own quota (5,000 req/hr)
 *   - We see the same repos the user owns (no extra scope negotiations)
 *   - The user can revoke the token from their GitHub settings at any time
 */
async function callGitHub<T = unknown>(
  accessToken: string,
  path: string,
): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'CodeTrail-Worker',
    },
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '<no body>');
    log('warn', 'GitHub API error', {
      path,
      status: response.status,
      body: errBody.slice(0, 500),
    });

    if (response.status === 401) {
      throw new Error(
        'GitHub token expired or revoked. Please sign in again.',
      );
    }
    if (response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      const resetAt = response.headers.get('x-ratelimit-reset');
      if (remaining === '0' && resetAt) {
        const resetDate = new Date(parseInt(resetAt, 10) * 1000);
        throw new Error(
          `GitHub rate limit hit. Try again after ${resetDate.toISOString()}.`,
        );
      }
      throw new Error('GitHub returned 403 (forbidden).');
    }
    throw new Error(`GitHub API returned HTTP ${response.status}.`);
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

/** Exchange a GitHub OAuth authorization code for an access token. */
async function handleCodeExchange(
  body: { code: string; redirectUri: string },
  env: Env,
): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) {
    log('error', 'GitHub OAuth secrets are not configured', {
      hasClientId: !!env.GITHUB_OAUTH_CLIENT_ID,
      hasClientSecret: !!env.GITHUB_OAUTH_CLIENT_SECRET,
    });
    return jsonResponse(
      {
        error:
          'Server is missing GitHub OAuth credentials. Set via `wrangler secret put`.',
      },
      500,
    );
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_OAUTH_CLIENT_ID,
          client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
          code: body.code,
          redirect_uri: body.redirectUri,
        }),
      },
    );
  } catch (err) {
    log('error', 'Failed to reach GitHub token endpoint', { error: String(err) });
    return jsonResponse(
      { error: 'Could not reach GitHub token endpoint' },
      503,
    );
  }

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text().catch(() => '<no body>');
    log('error', 'GitHub token endpoint returned non-OK', {
      status: tokenResponse.status,
      body: errorText.slice(0, 500),
    });
    return jsonResponse(
      { error: `GitHub token exchange failed (HTTP ${tokenResponse.status})` },
      502,
    );
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    scope?: string;
    token_type?: string;
    error?: string;
    error_description?: string;
  };

  if (tokenData.error) {
    log('error', 'GitHub returned an error in the token response', {
      error: tokenData.error,
      description: tokenData.error_description,
    });
    return jsonResponse(
      {
        error: `GitHub error: ${tokenData.error_description ?? tokenData.error}`,
      },
      400,
    );
  }

  if (!tokenData.access_token) {
    log('error', 'No access_token in GitHub response', { response: tokenData });
    return jsonResponse({ error: 'GitHub response missing access_token' }, 500);
  }

  log('info', 'Successfully exchanged GitHub code for access token', {
    scope: tokenData.scope,
    tokenType: tokenData.token_type,
  });

  return jsonResponse({
    accessToken: tokenData.access_token,
    scope: tokenData.scope ?? '',
    tokenType: tokenData.token_type ?? 'bearer',
  });
}

/** Shape we return to the client for a GitHub user profile. */
interface GitHubUserResponse {
  // `id` is the stable, unique GitHub user ID. We use it as the Firestore
  // doc ID for both the lookup index (`githubAccounts/{id}`) and the linked
  // account subcollection (`users/{uid}/linkedAccounts/{id}`). It's a
  // 64-bit integer, but currently well under Number.MAX_SAFE_INTEGER
  // (~9×10^15), so JSON number is safe. If GitHub ever exceeds 2^53, we'd
  // need to switch to a string.
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
}

/** Get the authenticated GitHub user's profile. */
async function handleGetCurrentUser(
  body: { accessToken: string },
): Promise<Response> {
  const data = await callGitHub<GitHubUserResponse>(body.accessToken, '/user');
  return jsonResponse({
    id: data.id,
    login: data.login,
    name: data.name,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    publicRepos: data.public_repos,
    followers: data.followers,
    following: data.following,
  });
}

/**
 * Trimmed shape for a public GitHub user (e.g. someone you're adding as a
 * friend). `GET /users/{login}` returns a subset of the authenticated-user
 * fields. We just need the stable bits.
 */
interface GitHubPublicUserResponse {
  id: number;
  login: string;
  avatar_url: string;
  html_url: string;
  name: string | null;
}

/**
 * Look up a public GitHub user by login. Used by the add-friend flow.
 *
 * The endpoint is unauthenticated on GitHub's side (60 req/hr) but we
 * pass the caller's access token anyway so they get 5,000 req/hr from
 * their own quota. This is a defensive choice: if 60 unauth requests
 * become a bottleneck, we don't have to change the client.
 *
 * Returns 404 if GitHub has no such user.
 */
async function handleLookupGitHubUser(
  body: { accessToken: string; login: string },
): Promise<Response> {
  const data = await callGitHub<GitHubPublicUserResponse>(
    body.accessToken,
    `/users/${encodeURIComponent(body.login)}`,
  );
  return jsonResponse({
    id: data.id,
    login: data.login,
    avatarUrl: data.avatar_url,
    htmlUrl: data.html_url,
    name: data.name,
  });
}

// ---------------------------------------------------------------------------
// /friends/feed — aggregate a friends list's recent commits (Phase 3)
// ---------------------------------------------------------------------------

/** Shape of a friend as passed in the request body. */
interface FriendRequest {
  githubId: number;
  login: string;
  isOnCodeTrail?: boolean;
  friendUid?: string | null;
  avatarUrl?: string;
  htmlUrl?: string;
}

/**
 * Raw shape of a repo from `GET /users/{login}/repos`.
 * We only need name, full_name, and pushed_at.
 */
interface GitHubRepoListItemRaw {
  id: number;
  name: string;
  full_name: string;
  pushed_at: string | null;
  private: boolean;
}

/** Raw shape of a commit from `GET /repos/{owner}/{repo}/commits`. */
interface GitHubCommitListItemRaw {
  sha: string;
  commit: {
    message: string;
    author: { date: string } | null;
    committer: { date: string } | null;
  };
}

/** Single feed entry as returned to the client. */
interface FeedEntry {
  friend: {
    githubId: number;
    login: string;
    avatarUrl: string;
    htmlUrl?: string;
    isOnCodeTrail: boolean;
    friendUid: string | null;
  };
  repo: {
    fullName: string;
    commitCount: number; // commits in the busiest repo
    totalCommits: number; // total across ALL repos for this friend-day
    latestSha: string;
    latestMessage: string;
  };
  date: string; // YYYY-MM-DD (UTC for MVP)
}

/**
 * Aggregate a friends list's recent commits into a feed.
 *
 * For each friend:
 *   1. Fetch their recently-pushed public repos: `GET /users/{login}/repos
 *      ?per_page=100&sort=pushed&type=public&since={daysAgo}`.
 *   2. For each repo, fetch commits: `GET /repos/{owner}/{repo}/commits
 *      ?author={login}&since={daysAgo}&per_page=100`.
 *   3. Aggregate by friend+date, sum commit counts, pick busiest repo
 *      per (friend, date).
 *
 * For 25 friends × 5 active repos = ~150 GitHub calls per feed load.
 * Well under the 5,000/hr quota.
 *
 * Failed friends (rate limit, network) are added to `failedFriends` and
 * skipped. The rest of the feed still returns.
 */
async function handleGetFriendFeed(
  body: {
    accessToken: string;
    days?: number;
    maxFriends?: number;
    friends: FriendRequest[];
  },
): Promise<Response> {
  const days = body.days ?? 7;
  const maxFriends = body.maxFriends ?? 25;
  const friends = body.friends.slice(0, maxFriends);
  if (friends.length === 0) {
    return jsonResponse({
      fetchedAt: new Date().toISOString(),
      entries: [],
      rateLimited: false,
      failedFriends: [],
    });
  }

  // `since` for the repos list: pushed_at filter, to skip dormant repos.
  // `since` for commits: filter to the window.
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const sinceIso = sinceDate.toISOString();

  const entries: FeedEntry[] = [];
  const failedFriends: number[] = [];
  let rateLimited = false;

  // Process friends serially to be polite to the rate limiter. With
  // 25 friends × 5 repos = 125 calls, even serial is < 10 sec.
  // Parallelizing would be faster but could trip the secondary rate
  // limiter (abuse detection).
  //
  // REPO CAP: We previously used per_page=100 which caused timeouts
  // for users with many active repos (e.g. @sindresorhus has 100+).
  // The top 20 most-recently-pushed repos captures essentially all of
  // a friend's recent activity (anything pushed > 7 days ago is
  // outside the feed window anyway).
  //
  // NOTE: `/users/{login}/repos` does NOT accept the `since` param
  // (it silently ignores it). We filter by `pushed_at` client-side.
  const MAX_REPOS_PER_FRIEND = 20;
  for (const friend of friends) {
    try {
      // 1. List recently-pushed public repos (top 20, sorted by pushed).
      const reposPath =
        `/users/${encodeURIComponent(friend.login)}/repos` +
        `?per_page=${MAX_REPOS_PER_FRIEND}&sort=pushed&type=public`;
      const repos = await callGitHub<GitHubRepoListItemRaw[]>(
        body.accessToken,
        reposPath,
      );

      // Client-side filter: skip repos not pushed to in the window.
      // (The `since` query param on this endpoint is ignored by GitHub.)
      const activeRepos = repos.filter(
        (r) => r.pushed_at && r.pushed_at >= sinceIso,
      );

      // 2. For each repo, get commits by this friend in the window.
      //    Skip repos with 0 commits.
      interface PerRepoCommits {
        repo: { fullName: string; commitCount: number; latestSha: string; latestMessage: string };
        date: string;
      }
      const perRepoCommits: PerRepoCommits[] = [];

      for (const repo of activeRepos) {
        if (repo.private) continue; // Shouldn't happen with type=public, but defensive.
        const [owner, repoName] = repo.full_name.split('/');
        if (!owner || !repoName) continue;

        const commitsPath =
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/commits` +
          `?author=${encodeURIComponent(friend.login)}` +
          `&since=${encodeURIComponent(sinceIso)}&per_page=100`;
        const commits = await callGitHub<GitHubCommitListItemRaw[]>(
          body.accessToken,
          commitsPath,
        );
        if (commits.length === 0) continue;

        // Use the first (most recent) commit's date as the entry's date.
        // `commits` is newest-first.
        const latest = commits[0];
        const dateStr =
          latest.commit.author?.date ?? latest.commit.committer?.date ?? '';
        if (!dateStr) continue;
        const date = dateStr.slice(0, 10); // YYYY-MM-DD (UTC)

        perRepoCommits.push({
          repo: {
            fullName: repo.full_name,
            commitCount: commits.length,
            latestSha: latest.sha,
            latestMessage: latest.commit.message.split('\n')[0].slice(0, 200), // truncate
          },
          date,
        });
      }

      // 3. Aggregate per-day: pick the busiest repo for that day, and
      //    sum total commits across all repos for the "+ N more" copy.
      interface DayBucket {
        busiest: PerRepoCommits;
        totalCommits: number;
      }
      const byDate = new Map<string, DayBucket>();
      for (const c of perRepoCommits) {
        const existing = byDate.get(c.date);
        if (existing) {
          existing.totalCommits += c.repo.commitCount;
          if (c.repo.commitCount > existing.busiest.repo.commitCount) {
            existing.busiest = c;
          }
        } else {
          byDate.set(c.date, { busiest: c, totalCommits: c.repo.commitCount });
        }
      }

      for (const [, c] of byDate) {
        entries.push({
          friend: {
            githubId: friend.githubId,
            login: friend.login,
            avatarUrl: friend.avatarUrl ?? '',
            htmlUrl: friend.htmlUrl,
            isOnCodeTrail: friend.isOnCodeTrail ?? false,
            friendUid: friend.friendUid ?? null,
          },
          repo: {
            fullName: c.busiest.repo.fullName,
            commitCount: c.busiest.repo.commitCount,
            totalCommits: c.totalCommits,
            latestSha: c.busiest.repo.latestSha,
            latestMessage: c.busiest.repo.latestMessage,
          },
          date: c.busiest.date,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown';
      log('warn', 'Failed to load feed for friend', {
        friend: friend.login,
        error: msg,
      });
      if (msg.includes('rate limit')) rateLimited = true;
      failedFriends.push(friend.githubId);
      // Continue with the next friend.
    }
  }

  // 4. Sort entries by date desc (most recent first), then by commit count
  //    desc as a tiebreaker.
  entries.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.repo.commitCount - a.repo.commitCount;
  });

  return jsonResponse({
    fetchedAt: new Date().toISOString(),
    entries: entries.slice(0, 100), // hard cap on response size
    rateLimited,
    failedFriends,
  });
}

/**
 * Trimmed commit shape we return. We only need the date for the streak
 * computation; the SHA is for debugging if GitHub ever returns a weird
 * commit (e.g., a co-authored commit that should count but doesn't).
 */
interface GitHubCommitDate {
  sha: string;
  date: string; // ISO 8601 from commit.author.date (or commit.committer.date as fallback)
}

/**
 * List a repo's commits authored by the given user, since the given date.
 *
 * We pass `author={login}` so GitHub filters server-side. This returns
 * the user's commits only — no co-authored noise.
 *
 * `per_page=100` is the GitHub max. If a user has more than 100 commits
 * in the window, we get the most recent 100 (GitHub returns them
 * newest-first). For our streak window (30 days), this is plenty.
 */
async function handleListRepoCommits(
  body: {
    accessToken: string;
    owner: string;
    repo: string;
    author: string;
    since: string; // ISO 8601
  },
): Promise<Response> {
  const path = `/repos/${encodeURIComponent(body.owner)}/${encodeURIComponent(body.repo)}/commits?author=${encodeURIComponent(body.author)}&since=${encodeURIComponent(body.since)}&per_page=100`;
  const data = await callGitHub<Array<{
    sha: string;
    commit: { author: { date: string } | null; committer: { date: string } | null };
  }>>(body.accessToken, path);

  // Fall back to committer date if author date is null (rare; happens for
  // commits authored by a deleted GitHub user).
  const commits: GitHubCommitDate[] = data.map((c) => ({
    sha: c.sha,
    date: c.commit.author?.date ?? c.commit.committer?.date ?? '',
  })).filter((c) => c.date !== '');

  return jsonResponse(commits);
}

/**
 * Shape we trim each repo down to (saves bandwidth; app doesn't need the full body).
 */
interface GitHubRepoRaw {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  private: boolean;
}

/**
 * List the authenticated user's public repos, sorted by most recently updated.
 *
 * We use `type=public` (not `type=owner`) because:
 *   - Brief locks "public repos only" for MVP — public is exactly the scope we want
 *   - `type=owner` returns an empty array for OAuth tokens issued by `gh auth login`
 *     in some scopes (GitHub quirk; GitHub App tokens work, but OAuth user tokens
 *     through the CLI don't always populate `type=owner`)
 */
async function handleListMyRepos(
  body: { accessToken: string },
): Promise<Response> {
  const data = await callGitHub<GitHubRepoRaw[]>(
    body.accessToken,
    '/user/repos?per_page=100&sort=updated&type=public',
  );
  return jsonResponse(
    data.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      updatedAt: r.updated_at,
      isPrivate: r.private,
    })),
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/** Parse a JSON body and require a string field. */
function requireString(
  body: Record<string, unknown>,
  field: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const v = body[field];
  if (typeof v !== 'string' || !v) {
    return { ok: false, error: `Missing or invalid "${field}"` };
  }
  return { ok: true, value: v };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return jsonResponse(
        { error: 'Method not allowed; use POST' },
        405,
      );
    }

    // Parse JSON body once at the top
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    // Route on path. Worker URL is the *.workers.dev root, so we use path
    // segments to dispatch (Workers don't have built-in routing).
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // POST / — OAuth code exchange
      if (path === '/') {
        const code = requireString(body, 'code');
        if (!code.ok) return jsonResponse({ error: code.error }, 400);
        const redirectUri = requireString(body, 'redirectUri');
        if (!redirectUri.ok) return jsonResponse({ error: redirectUri.error }, 400);
        return await handleCodeExchange(
          { code: code.value, redirectUri: redirectUri.value },
          env,
        );
      }

      // POST /user — get the GitHub user profile
      if (path === '/user') {
        const accessToken = requireString(body, 'accessToken');
        if (!accessToken.ok) {
          return jsonResponse({ error: accessToken.error }, 400);
        }
        return await handleGetCurrentUser({ accessToken: accessToken.value });
      }

      // POST /user/lookup — look up a public GitHub user by login
      if (path === '/user/lookup') {
        const accessToken = requireString(body, 'accessToken');
        if (!accessToken.ok) {
          return jsonResponse({ error: accessToken.error }, 400);
        }
        const login = requireString(body, 'login');
        if (!login.ok) return jsonResponse({ error: login.error }, 400);
        return await handleLookupGitHubUser({
          accessToken: accessToken.value,
          login: login.value,
        });
      }

      // POST /user/repos — list the user's public repos
      if (path === '/user/repos') {
        const accessToken = requireString(body, 'accessToken');
        if (!accessToken.ok) {
          return jsonResponse({ error: accessToken.error }, 400);
        }
        return await handleListMyRepos({ accessToken: accessToken.value });
      }

      // POST /repos/commits — list a repo's commits by author since a date
      if (path === '/repos/commits') {
        const accessToken = requireString(body, 'accessToken');
        if (!accessToken.ok) return jsonResponse({ error: accessToken.error }, 400);
        const owner = requireString(body, 'owner');
        if (!owner.ok) return jsonResponse({ error: owner.error }, 400);
        const repo = requireString(body, 'repo');
        if (!repo.ok) return jsonResponse({ error: repo.error }, 400);
        const author = requireString(body, 'author');
        if (!author.ok) return jsonResponse({ error: author.error }, 400);
        const since = requireString(body, 'since');
        if (!since.ok) return jsonResponse({ error: since.error }, 400);
        return await handleListRepoCommits({
          accessToken: accessToken.value,
          owner: owner.value,
          repo: repo.value,
          author: author.value,
          since: since.value,
        });
      }

      // POST /friends/feed — aggregate a friends list's recent commits
      if (path === '/friends/feed') {
        const accessToken = requireString(body, 'accessToken');
        if (!accessToken.ok) return jsonResponse({ error: accessToken.error }, 400);
        const friends = body.friends;
        if (!Array.isArray(friends)) {
          return jsonResponse({ error: 'Missing or invalid "friends" (expected array)' }, 400);
        }
        return await handleGetFriendFeed({
          accessToken: accessToken.value,
          ...(typeof body.days === 'number' ? { days: body.days } : {}),
          ...(typeof body.maxFriends === 'number' ? { maxFriends: body.maxFriends } : {}),
          friends: friends as FriendRequest[],
        });
      }

      return jsonResponse({ error: `Unknown path: ${path}` }, 404);
    } catch (err) {
      // Any error from a handler (e.g., callGitHub throwing) lands here.
      const message = err instanceof Error ? err.message : 'Unknown error';
      log('error', 'Handler error', { path, message });
      return jsonResponse({ error: message }, 500);
    }
  },
};

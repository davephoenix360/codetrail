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

      return jsonResponse({ error: `Unknown path: ${path}` }, 404);
    } catch (err) {
      // Any error from a handler (e.g., callGitHub throwing) lands here.
      const message = err instanceof Error ? err.message : 'Unknown error';
      log('error', 'Handler error', { path, message });
      return jsonResponse({ error: message }, 500);
    }
  },
};

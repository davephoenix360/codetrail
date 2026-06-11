/**
 * CodeTrail — Cloudflare Worker
 *
 * Exchanges a GitHub OAuth authorization code for an access token, then
 * returns the access token to the client. The client uses the access
 * token with `signInWithCredential` to sign in to Firebase Auth.
 *
 * This is a port of `functions/src/index.ts` (the Firebase Cloud Function
 * version) to Cloudflare Workers. We use Workers because they have a
 * generous free tier (100k requests/day, no credit card) while Cloud
 * Functions require the Firebase Blaze plan.
 *
 * Flow:
 *   [RN app]  →  GitHub authorize URL (via expo-web-browser)
 *   [RN app]  ←  exp://<dev-server>:<port>/--/auth/callback?code=X&state=Y
 *   [RN app]  →  THIS worker (POST with { code, redirectUri })
 *   [worker]  →  GitHub token endpoint (with client_secret)
 *   [RN app]  ←  { accessToken, scope, tokenType }
 *   [RN app]  →  signInWithCredential(GithubAuthProvider.credential(token))
 *
 * Endpoints:
 *   POST /  with JSON body { code: string, redirectUri: string }
 *          returns { accessToken, scope, tokenType }
 *
 * Secrets (set via `wrangler secret put`):
 *   GITHUB_OAUTH_CLIENT_ID       — OAuth app's public client_id
 *   GITHUB_OAUTH_CLIENT_SECRET   — OAuth app's private client_secret
 *                                  (NEVER expose to the client)
 */
export interface Env {
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
}

// CORS headers — we allow any origin since this is a public token-exchange
// endpoint. (The client validates the GitHub state param, and the access
// token is only useful when paired with the corresponding GitHub code.)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

function log(level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>): void {
  const entry = { level, message, timestamp: new Date().toISOString(), ...extra };
  // Workers' console.log is captured in the Cloudflare dashboard logs.
  console.log(JSON.stringify(entry));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight — return early with just the headers
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed; use POST' }, 405);
    }

    // Parse JSON body
    let body: { code?: unknown; redirectUri?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const { code, redirectUri } = body;
    if (typeof code !== 'string' || !code) {
      return jsonResponse({ error: 'Missing or invalid "code"' }, 400);
    }
    if (typeof redirectUri !== 'string' || !redirectUri) {
      return jsonResponse({ error: 'Missing or invalid "redirectUri"' }, 400);
    }

    if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET) {
      log('error', 'GitHub OAuth secrets are not configured', {
        hasClientId: !!env.GITHUB_OAUTH_CLIENT_ID,
        hasClientSecret: !!env.GITHUB_OAUTH_CLIENT_SECRET,
      });
      return jsonResponse(
        { error: 'Server is missing GitHub OAuth credentials. Set via `wrangler secret put`.' },
        500,
      );
    }

    // Exchange the code for an access token
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_OAUTH_CLIENT_ID,
          client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
        }),
      });
    } catch (err) {
      log('error', 'Failed to reach GitHub token endpoint', { error: String(err) });
      return jsonResponse({ error: 'Could not reach GitHub token endpoint' }, 503);
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
        { error: `GitHub error: ${tokenData.error_description ?? tokenData.error}` },
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
  },
};

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
 *   [RN app]  ←  codetrail://auth/callback?code=X&state=Y
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

/**
 * Static HTML page served at GET /auth/callback.
 *
 * Why this exists: when running in Expo Go on Android, the system browser
 * (Chrome Custom Tab) sometimes fails to dispatch `exp+<slug>://` deep
 * links back to the app. It just shows GitHub's "You are being redirected"
 * page indefinitely.
 *
 * The reliable fix: use an HTTPS callback URL, serve a tiny HTML page
 * that does the cross-scheme redirect via JavaScript. The browser is
 * comfortable navigating to HTTPS, executes our JS, and only then
 * attempts the `exp+codetrail://` deep link. The OS dispatches it
 * reliably because we came from a normal page navigation, not a
 * 302 redirect from a Cross-site redirector.
 *
 * The page also has a manual <a> link as a fallback in case JS is
 * disabled or the auto-redirect is blocked.
 */
const REDIRECT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeTrail — Sign in</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      padding: 24px 20px;
      max-width: 420px;
      margin: 0 auto;
      text-align: center;
      color: #24292f;
      background: #ffffff;
    }
    h1 { font-size: 1.4em; margin: 0 0 16px; }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid #e1e4e8;
      border-top-color: #208AEF;
      border-radius: 50%;
      animation: ctrail-spin 1s linear infinite;
      margin: 16px auto;
    }
    @keyframes ctrail-spin { to { transform: rotate(360deg); } }
    a { color: #208AEF; }
    .hidden { display: none; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1 id="title">Completing sign-in…</h1>
  <div id="spinner" class="spinner"></div>
  <p id="message" class="hidden"></p>
  <script>
    (function () {
      var params = new URLSearchParams(window.location.search);
      var code = params.get('code');
      var state = params.get('state');
      var error = params.get('error');
      var errorDescription = params.get('error_description');

      var title = document.getElementById('title');
      var spinner = document.getElementById('spinner');
      var message = document.getElementById('message');

      function showError(label) {
        title.textContent = 'Sign-in failed';
        spinner.classList.add('hidden');
        message.classList.remove('hidden');
        message.innerHTML = label;
      }

      if (error) {
        showError(
          'GitHub error: ' + (errorDescription || error) + '<br><br>' +
          '<a href="exp+codetrail://auth/callback?error=' +
            encodeURIComponent(error) + '&error_description=' +
            encodeURIComponent(errorDescription || '') +
          '">Tap to return to the app</a>'
        );
        return;
      }
      if (!code) {
        showError('No authorization code returned from GitHub.');
        return;
      }

      // Two URLs:
      //   1. deepLink  = 'exp+codetrail://...'         — the standard deep link
      //                  (works on iOS, and on Android when the browser
      //                  auto-dispatches to the installed app)
      //   2. intentUrl = 'intent://...#Intent;...'     — Android-specific.
      //                  Chrome Custom Tabs sometimes silently drop
      //                  navigations to unknown custom schemes. The
      //                  intent:// URL explicitly invokes the target app
      //                  (Expo Go, package host.exp.exponent) so the OS
      //                  dispatches the deep link regardless of the
      //                  browser's policy.
      // We try intent:// first on Android, with the standard custom
      // scheme as a fallback. iOS will simply ignore the intent:// URL.
      var deepLink = 'exp+codetrail://auth/callback?code=' + encodeURIComponent(code) +
        (state ? '&state=' + encodeURIComponent(state) : '');
      var intentUrl = 'intent://auth/callback?code=' + encodeURIComponent(code) +
        (state ? '&state=' + encodeURIComponent(state) : '') +
        '#Intent;scheme=exp+codetrail;package=host.exp.exponent;S.browser_fallback_url=' +
        encodeURIComponent(deepLink) + ';end';

      // Detect Android (the user-agent of Chrome Custom Tabs contains "Android")
      var isAndroid = /Android/i.test(navigator.userAgent);

      // Show fallback manual link
      message.classList.remove('hidden');
      message.innerHTML = 'If nothing happens, <a href="' + deepLink + '">tap here to open the app</a>.';

      // Auto-redirect: prefer intent:// on Android, plain custom scheme elsewhere
      window.location.href = isAndroid ? intentUrl : deepLink;
    })();
  </script>
</body>
</html>`;

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
    const url = new URL(request.url);

    // CORS preflight — return early with just the headers
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // GET /auth/callback: serve the cross-scheme redirect HTML page.
    // This is the entry point for the GitHub OAuth flow when running in
    // Expo Go on Android. See the REDIRECT_HTML constant for details.
    if (request.method === 'GET' && url.pathname === '/auth/callback') {
      return new Response(REDIRECT_HTML, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
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

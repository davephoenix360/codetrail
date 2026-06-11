/**
 * CodeTrail Cloud Functions
 *
 * exchangeGitHubCode — exchanges a GitHub OAuth authorization code for an
 *                     access token, then returns the access token to the
 *                     client. The client uses the access token with
 *                     `signInWithCredential` to sign in to Firebase Auth.
 *
 * Why a Cloud Function is needed:
 * - GitHub's OAuth flow uses a `client_secret` to exchange the code, and
 *   that secret must never be embedded in a mobile app (anyone could
 *   extract it and impersonate our OAuth app).
 * - The Cloud Function holds the secret in a secure env var and acts as
 *   a trusted exchange proxy.
 *
 * Flow:
 *   [RN client]  -> [GitHub authorize URL] -> [user authorizes]
 *   [RN client]  <- [codetrail://auth/callback?code=X&state=Y]  (via expo-web-browser)
 *   [RN client]  -> [this Cloud Function] -> [GitHub token endpoint] -> [access_token]
 *   [RN client]  <- [access_token] -> [signInWithCredential]
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

const githubClientId = defineSecret('GITHUB_OAUTH_CLIENT_ID');
const githubClientSecret = defineSecret('GITHUB_OAUTH_CLIENT_SECRET');

/**
 * Callable HTTPS function. Exchange a GitHub OAuth code for an access token.
 *
 * Request data:
 *   code: string          - the `code` query param from the GitHub callback
 *   redirectUri: string   - the redirect_uri used in the authorize URL (must
 *                           match exactly what was sent to GitHub)
 *
 * Returns:
 *   accessToken: string   - the GitHub access token
 *   scope: string         - the scopes granted by the user
 *   tokenType: string     - typically "bearer"
 */
export const exchangeGitHubCode = onCall(
  {
    cors: true,
    secrets: [githubClientId, githubClientSecret],
    // 30s timeout should be plenty — GitHub's token endpoint is fast
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    const { code, redirectUri } = (request.data ?? {}) as {
      code?: unknown;
      redirectUri?: unknown;
    };

    if (typeof code !== 'string' || !code) {
      throw new HttpsError('invalid-argument', 'Missing or invalid "code"');
    }
    if (typeof redirectUri !== 'string' || !redirectUri) {
      throw new HttpsError('invalid-argument', 'Missing or invalid "redirectUri"');
    }

    const clientId = githubClientId.value();
    const clientSecret = githubClientSecret.value();

    if (!clientId || !clientSecret) {
      // Server-side config error — surface clearly so we can diagnose
      logger.error('GitHub OAuth secrets are not configured', {
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      });
      throw new HttpsError(
        'failed-precondition',
        'Server is missing GitHub OAuth credentials. Check firebase functions:secrets.',
      );
    }

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
    } catch (err) {
      logger.error('Failed to reach GitHub token endpoint', err);
      throw new HttpsError('unavailable', 'Could not reach GitHub token endpoint');
    }

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text().catch(() => '<no body>');
      logger.error('GitHub token endpoint returned non-OK', {
        status: tokenResponse.status,
        body: errorText.slice(0, 500),
      });
      throw new HttpsError('internal', `GitHub token exchange failed (HTTP ${tokenResponse.status})`);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
      token_type?: string;
      error?: string;
      error_description?: string;
    };

    if (tokenData.error) {
      logger.error('GitHub returned an error in the token response', {
        error: tokenData.error,
        description: tokenData.error_description,
      });
      throw new HttpsError(
        'invalid-argument',
        `GitHub error: ${tokenData.error_description ?? tokenData.error}`,
      );
    }

    if (!tokenData.access_token) {
      logger.error('No access_token in GitHub response', { response: tokenData });
      throw new HttpsError('internal', 'GitHub response missing access_token');
    }

    logger.info('Successfully exchanged GitHub code for access token', {
      scope: tokenData.scope,
      tokenType: tokenData.token_type,
    });

    return {
      accessToken: tokenData.access_token,
      scope: tokenData.scope ?? '',
      tokenType: tokenData.token_type ?? 'bearer',
    };
  },
);

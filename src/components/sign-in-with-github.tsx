/**
 * Sign in with GitHub via WebBrowser + Cloudflare Worker.
 *
 * Why this is more complex than `signInWithRedirect`:
 * - Firebase v12's React Native build intentionally omits
 *   `signInWithRedirect` from its public exports (it lives in
 *   `@firebase/auth/internal` only). It also requires a custom
 *   popup/redirect resolver that uses `expo-web-browser` — Firebase
 *   doesn't ship one out of the box.
 * - The proper RN pattern is: open the GitHub OAuth URL in
 *   `expo-web-browser`, capture the `code` from the deep-link callback,
 *   exchange that code for an access token via a Cloudflare Worker (which
 *   holds the `client_secret` securely), then use the access token with
 *   `signInWithCredential`.
 *
 * Flow:
 *   1. Build `https://github.com/login/oauth/authorize?...` URL with
 *      client_id, redirect_uri, state (CSRF), and scope.
 *   2. Open it via `WebBrowser.openAuthSessionAsync`. This will:
 *      - Switch to the system browser (or in-app browser on iOS)
 *      - User authorizes on GitHub
 *      - GitHub redirects to our `redirect_uri` (`codetrail://auth/callback?code=...&state=...`)
 *      - WebBrowser detects the redirect_uri match and returns the URL
 *   3. Parse the `code` and `state` from the callback URL.
 *   4. Verify `state` matches what we generated (CSRF protection).
 *   5. POST to the Cloudflare Worker with `{ code, redirectUri }`.
 *   6. Worker returns `{ accessToken }`.
 *   7. Use `GithubAuthProvider.credential(accessToken)` with
 *      `signInWithCredential` to sign the user in to Firebase.
 *
 * Required env vars (in .env):
 *   EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID   - the GitHub OAuth app's client_id
 *                                           (safe to embed — public)
 *   EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL   - the Cloudflare Worker URL, e.g.
 *                                           https://codetrail-exchange.<subdomain>.workers.dev
 *
 * Required secrets (set via `wrangler secret put`):
 *   GITHUB_OAUTH_CLIENT_ID               - same value as above (server-side)
 *   GITHUB_OAUTH_CLIENT_SECRET           - the GitHub OAuth app's client_secret
 *                                           (NEVER embed in the app)
 *
 * Required GitHub OAuth app config:
 *   Authorization callback URL = codetrail://auth/callback
 */
import { useState } from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { GithubAuthProvider, signInWithCredential } from 'firebase/auth';

import { auth } from '@/lib/firebase';

const GITHUB_OAUTH_CLIENT_ID = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID ?? '';
const EXCHANGE_URL = process.env.EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL ?? '';
const REDIRECT_URI = 'codetrail://auth/callback';
// Same scopes we asked for originally. `read:user` + `user:email` for identity,
// `public_repo` so we can later list the user's repos to track.
const GITHUB_SCOPES = ['read:user', 'user:email', 'public_repo'];

// Ensure WebBrowser is ready to complete the auth session handoff.
// This is safe to call multiple times.
WebBrowser.maybeCompleteAuthSession();

function generateState(): string {
  // 32 random bytes → base64url. Good enough for CSRF protection.
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function SignInWithGitHub() {
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (loading) return;
    setLoading(true);

    if (!GITHUB_OAUTH_CLIENT_ID) {
      console.warn(
        '[codetrail] EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID is missing. Add it to .env and reload.',
      );
      setLoading(false);
      return;
    }
    if (!EXCHANGE_URL) {
      console.warn(
        '[codetrail] EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL is missing. Deploy the Cloudflare Worker and add its URL to .env.',
      );
      setLoading(false);
      return;
    }

    // Generate CSRF state — will be verified against the callback's state param.
    const state = generateState();

    // 1. Build the GitHub OAuth URL
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', GITHUB_OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', GITHUB_SCOPES.join(' '));
    authUrl.searchParams.set('allow_signup', 'true');

    let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    try {
      // 2. Open the system browser. This blocks until the user authorizes
      // and GitHub redirects to REDIRECT_URI.
      result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), REDIRECT_URI);
    } catch (e) {
      console.warn('[codetrail] openAuthSessionAsync threw:', e);
      setLoading(false);
      return;
    }

    if (result.type !== 'success' || !result.url) {
      // User cancelled or browser returned a non-success result. Not an error.
      if (__DEV__) console.log('[codetrail] auth session ended:', result.type);
      setLoading(false);
      return;
    }

    // 3. Parse the callback URL
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(result.url);
    } catch (e) {
      console.warn('[codetrail] invalid callback URL:', result.url, e);
      setLoading(false);
      return;
    }

    const code = callbackUrl.searchParams.get('code');
    const returnedState = callbackUrl.searchParams.get('state');
    const error = callbackUrl.searchParams.get('error');
    const errorDescription = callbackUrl.searchParams.get('error_description');

    if (error) {
      // User denied the OAuth grant, or GitHub returned an error.
      console.warn(`[codetrail] GitHub OAuth error: ${error} (${errorDescription})`);
      setLoading(false);
      return;
    }

    if (!code) {
      console.warn('[codetrail] no code in callback URL:', result.url);
      setLoading(false);
      return;
    }

    // 4. CSRF check
    if (returnedState !== state) {
      console.warn('[codetrail] state mismatch — possible CSRF attack');
      setLoading(false);
      return;
    }

    // 5. Exchange the code for an access token via Cloudflare Worker
    let accessToken: string;
    try {
      const response = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri: REDIRECT_URI }),
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '<no body>');
        console.warn(`[codetrail] exchange worker returned ${response.status}:`, errBody);
        setLoading(false);
        return;
      }
      const data = (await response.json()) as { accessToken: string; scope: string; tokenType: string };
      accessToken = data.accessToken;
    } catch (e: unknown) {
      console.warn('[codetrail] exchange worker call failed:', e);
      setLoading(false);
      return;
    }

    // 6. Sign in to Firebase with the GitHub access token
    try {
      const credential = GithubAuthProvider.credential(accessToken);
      await signInWithCredential(auth, credential);
      // Don't setLoading(false) here — the app is signing in and the
      // useAuth hook's onAuthStateChanged will update the UI. If sign-in
      // fails, the catch block will reset loading.
    } catch (e: unknown) {
      console.warn('[codetrail] signInWithCredential failed:', e);
      setLoading(false);
    }
  }

  return (
    <Pressable
      onPress={handleSignIn}
      disabled={loading}
      style={[styles.button, loading && styles.buttonDisabled]}
      accessibilityRole="button"
      accessibilityLabel="Sign in with GitHub"
    >
      {loading ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.buttonText}>Sign in with GitHub</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#24292f',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

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
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { GithubAuthProvider, signInWithCredential } from 'firebase/auth';

import { auth } from '@/lib/firebase';

const GITHUB_OAUTH_CLIENT_ID = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID ?? '';
const EXCHANGE_URL = process.env.EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL ?? '';

// GitHub OAuth App callback URL — points at our Cloudflare Worker, which
// serves a tiny HTML page that auto-redirects to the deep link. We use
// HTTPS (not the bare `exp+codetrail://` scheme) because Chrome Custom
// Tabs on Android sometimes fail to dispatch `exp+<slug>://` URLs back
// to the app. The static HTML approach is rock-solid: the browser is
// happy with HTTPS, executes the JS, and the OS reliably hands the
// `exp+codetrail://` URL off to Expo Go.
const REDIRECT_URI = 'https://codetrail-oauth.davediepreye05.workers.dev/auth/callback';
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

/**
 * Module-level helper that processes an OAuth callback URL.
 * Used by both the WebBrowser result path and the Linking event path.
 * Resets `loading` on every exit so the button is never stuck disabled.
 */
async function processAuthCallback(
  url: string,
  state: string,
  setLoading: (v: boolean) => void,
): Promise<void> {
  // 1. Parse the callback URL
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(url);
  } catch (e) {
    console.warn('[codetrail] invalid callback URL:', url, e);
    setLoading(false);
    return;
  }

  const code = callbackUrl.searchParams.get('code');
  const returnedState = callbackUrl.searchParams.get('state');
  const error = callbackUrl.searchParams.get('error');
  const errorDescription = callbackUrl.searchParams.get('error_description');

  if (error) {
    console.warn(`[codetrail] GitHub OAuth error: ${error} (${errorDescription})`);
    setLoading(false);
    return;
  }
  if (!code) {
    console.warn('[codetrail] no code in callback URL:', url);
    setLoading(false);
    return;
  }
  if (returnedState !== state) {
    console.warn('[codetrail] state mismatch — possible CSRF attack');
    setLoading(false);
    return;
  }

  // 2. Exchange the code for an access token via the Cloudflare Worker
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
    const data = (await response.json()) as {
      accessToken: string;
      scope: string;
      tokenType: string;
    };
    accessToken = data.accessToken;
  } catch (e: unknown) {
    console.warn('[codetrail] exchange worker call failed:', e);
    setLoading(false);
    return;
  }

  // 3. Sign in to Firebase with the GitHub access token
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

export function SignInWithGitHub() {
  const [loading, setLoading] = useState(false);
  // Holds the in-flight auth handler so the global Linking listener can
  // dispatch the deep-link URL to it. When the URL arrives via either
  // (a) WebBrowser's auto-resolve, or (b) the Linking event, we clear the
  // ref so the second path becomes a no-op. This makes the deep-link
  // handoff robust against Chrome Custom Tab quirks.
  const authHandlerRef = useRef<{
    state: string;
    processUrl: (url: string) => Promise<void>;
  } | null>(null);

  // Global Linking listener — catches the deep link even if WebBrowser
  // doesn't auto-close the Chrome Custom Tab. The browser gets dismissed
  // manually, and the URL is processed by the current handler.
  useEffect(() => {
    const sub = Linking.addEventListener('url', async ({ url }) => {
      if (!url.startsWith(REDIRECT_URI)) return;
      const handler = authHandlerRef.current;
      if (!handler) return; // No in-flight sign-in, ignore stray deep links
      authHandlerRef.current = null;
      try {
        await WebBrowser.dismissBrowser();
      } catch (e) {
        if (__DEV__) console.log('[codetrail] dismissBrowser failed (ok if no browser open):', e);
      }
      await handler.processUrl(url);
    });
    return () => sub.remove();
  }, []);

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

    // Set up the handler that the Linking listener will call if the
    // WebBrowser promise never resolves (e.g., Chrome Custom Tab stays
    // stuck on the redirect page).
    authHandlerRef.current = {
      state,
      processUrl: async (url: string) => {
        if (__DEV__) console.log('[codetrail] Linking event fired, processing URL:', url);
        await processAuthCallback(url, state, setLoading);
      },
    };
    if (__DEV__) console.log('[codetrail] starting WebBrowser.openAuthSessionAsync');

    let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    try {
      // 2. Open the system browser. This blocks until the user authorizes
      // and GitHub redirects to REDIRECT_URI.
      result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), REDIRECT_URI);
      if (__DEV__) console.log('[codetrail] WebBrowser.openAuthSessionAsync resolved:', result.type, result.url ?? '(no url)');
    } catch (e) {
      console.warn('[codetrail] openAuthSessionAsync threw:', e);
      authHandlerRef.current = null;
      setLoading(false);
      return;
    }

    // If the Linking listener already handled the URL, we're done.
    if (authHandlerRef.current === null) {
      setLoading(false);
      return;
    }

    if (result.type === 'success' && result.url) {
      // Take ownership before processing so the listener can't double-fire.
      const handler = authHandlerRef.current;
      authHandlerRef.current = null;
      await handler.processUrl(result.url);
    } else {
      // User cancelled or browser returned a non-success result. Not an error.
      if (__DEV__) console.log('[codetrail] auth session ended:', result.type);
      authHandlerRef.current = null;
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

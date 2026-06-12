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

import {
  AUTH_CONSTANTS,
  generateAndStoreState,
  processAuthCallback,
} from '@/lib/auth-callback';

const { GITHUB_OAUTH_CLIENT_ID, EXCHANGE_URL, REDIRECT_URI } = AUTH_CONSTANTS;
// Same scopes we asked for originally. `read:user` + `user:email` for identity,
// `public_repo` so we can later list the user's repos to track.
const GITHUB_SCOPES = ['read:user', 'user:email', 'public_repo'];

// Ensure WebBrowser is ready to complete the auth session handoff.
// This is safe to call multiple times.
WebBrowser.maybeCompleteAuthSession();

export function SignInWithGitHub() {
  const [loading, setLoading] = useState(false);
  // Holds the in-flight auth handler so the global Linking listener can
  // dispatch the deep-link URL to it. When the URL arrives via either
  // (a) WebBrowser's auto-resolve, or (b) the Linking event, we clear the
  // ref so the second path becomes a no-op. This makes the deep-link
  // handoff robust against Chrome Custom Tab quirks.
  //
  // The CSRF state itself is no longer stored here — it's persisted in
  // AsyncStorage by `generateAndStoreState` so the cold-start route
  // (`app/auth/callback.tsx`) can verify it.
  const authHandlerRef = useRef<{
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

    // Generate CSRF state — persisted in AsyncStorage so it survives
    // cold-start callbacks (where the original component tree is gone).
    const state = await generateAndStoreState();

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
      processUrl: async (url: string) => {
        if (__DEV__) console.log('[codetrail] Linking event fired, processing URL:', url);
        await processAuthCallback(url, { setLoading });
      },
    };
    if (__DEV__) console.log('[codetrail] starting WebBrowser.openAuthSessionAsync');

    let result: Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    try {
      // 2. Open the system browser. This blocks until the user authorizes
      // and GitHub redirects to REDIRECT_URI.
      result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), REDIRECT_URI);
      if (__DEV__) {
        const url = result.type === 'success' ? result.url : '(no url)';
        console.log('[codetrail] WebBrowser.openAuthSessionAsync resolved:', result.type, url);
      }
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

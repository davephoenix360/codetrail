/**
 * Sign in with GitHub via Firebase's `signInWithRedirect`.
 *
 * Why this works in React Native + Expo:
 * - Firebase's `signInWithRedirect` requires a "popup redirect resolver"
 *   that knows how to open the browser and capture the result. The web
 *   default (`browserPopupRedirectResolver`) uses `window.location` and
 *   `window.localStorage`, neither of which exist in RN.
 * - We pass `cordovaPopupRedirectResolver` (from `@firebase/auth/cordova`)
 *   to `initializeAuth` in `firebase.ts`. The cordova resolver expects
 *   Cordova plugins on `window` — we polyfill those in
 *   `cordova-auth-polyfill.ts`, which is imported as a side effect
 *   before `initializeAuth` runs.
 * - After the user authorizes on GitHub, GitHub redirects to Firebase's
 *   own auth handler (`https://<project>.firebaseapp.com/__/auth/handler`).
 *   Firebase processes the OAuth response, then redirects back to the app
 *   via the `codetrail://` scheme. The polyfill's universalLinks listener
 *   catches it, the resolver stores the result, and
 *   `onAuthStateChanged` in `useAuth` updates the UI.
 *
 * Why we DON'T need a custom callback route:
 * - We don't have a `redirect_uri` in our app at all. GitHub's OAuth app
 *   is configured with Firebase's auth handler URL as its callback.
 *   The app's `codetrail://` scheme is registered in `app.json` so the
 *   OS knows to route the post-handler redirect back to us.
 *
 * Required env vars (in .env):
 *   EXPO_PUBLIC_FITHUB_OAUTH_CLIENT_ID   - NOT used here. The GitHub
 *                                           client_id is configured on
 *                                           the Firebase side (in
 *                                           Firebase Console → Auth →
 *                                           Sign-in method → GitHub).
 *                                           Kept in .env.example for
 *                                           documentation only.
 *   EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL   - NOT used here. The Cloudflare
 *                                           Worker that held the
 *                                           client_secret is no longer
 *                                           needed — Firebase stores
 *                                           the secret server-side.
 *                                           Kept in .env.example for
 *                                           documentation only.
 *
 * Required Firebase Console config:
 *   Auth → Sign-in method → GitHub → Enable
 *     - Client ID:     <GitHub OAuth app's client_id>
 *     - Client secret: <GitHub OAuth app's client_secret>
 *
 * Required GitHub OAuth app config:
 *   Authorization callback URL =
 *     https://<firebase-project-id>.firebaseapp.com/__/auth/handler
 *     (NOT the app's codetrail:// scheme — Firebase handles the redirect)
 */
import { useState } from 'react';
import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { GithubAuthProvider, signInWithRedirect } from 'firebase/auth';
import * as WebBrowser from 'expo-web-browser';

import { auth } from '@/lib/firebase';

WebBrowser.maybeCompleteAuthSession();

// Scopes we request. `read:user` + `user:email` for identity, `public_repo`
// so we can later list the user's repos to track.
const GITHUB_SCOPES = ['read:user', 'user:email', 'public_repo'];

export function SignInWithGitHub() {
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (loading) return;
    setLoading(true);

    try {
      const provider = new GithubAuthProvider();
      for (const scope of GITHUB_SCOPES) {
        provider.addScope(scope);
      }
      // opens the browser, returns when the browser is closed
      // (the user has authorized and Firebase has processed the result)
      await signInWithRedirect(auth, provider);
      // When the promise resolves, the browser is closed and the auth
      // state is being updated. onAuthStateChanged (in useAuth) will
      // re-render the home screen. We don't need to do anything else.
    } catch (e) {
      console.warn('[codetrail] signInWithRedirect failed:', e);
    } finally {
      // The button might unmount before this runs (we navigate away on
      // success), but keep it idempotent in case we stay on the screen.
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

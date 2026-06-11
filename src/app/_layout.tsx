/**
 * Root layout.
 *
 * - Calls `WebBrowser.maybeCompleteAuthSession()` to handle the OAuth redirect
 *   handoff from the in-app browser back to the app.
 * - On cold start (app launched from a deep link), calls
 *   `getRedirectResult(auth)` to claim the auth result that
 *   `signInWithRedirect` stored. Without this, signing in and then having
 *   the OS kill the app before the auth state propagates would lose the
 *   result.
 *
 * We DON'T need `getRedirectResult` like we would on web — wait, actually
 * we DO need it. The difference is: on web, the redirect always blows away
 * the page state, so a fresh page load can synchronously call
 * `getRedirectResult` from a top-level effect. In RN, the app may stay
 * alive across the redirect, OR the OS may kill it. `getRedirectResult`
 * handles both cases: it returns the pending result if one exists, and
 * null otherwise.
 *
 * Uses Expo Router's <Stack> instead of native tabs. CodeTrail is a
 * single-screen app (just the sign-in / "you shipped" greeting); tabs aren't
 * needed.
 */
import { useEffect } from 'react';
import { getRedirectResult } from 'firebase/auth';
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';

import { auth } from '@/lib/firebase';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  useEffect(() => {
    // Cold-start handler: if the app was launched by Firebase's auth
    // handler returning us the auth result, claim it now. Safe to call
    // on every cold start — returns null if there's nothing to claim.
    getRedirectResult(auth).catch((e) => {
      console.warn('[codetrail] getRedirectResult failed:', e);
    });
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}

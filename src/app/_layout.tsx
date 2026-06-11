/**
 * Root layout.
 *
 * - Calls `WebBrowser.maybeCompleteAuthSession()` to handle the OAuth redirect
 *   handoff from the in-app browser back to the app.
 * - Calls `getRedirectResult(auth)` on mount to capture the result of a
 *   signInWithRedirect that completed while the app was backgrounded.
 *
 * Uses Expo Router's <Stack> instead of native tabs. CodeTrail is a single-screen
 * app (just the sign-in / "you shipped" greeting); tabs aren't needed.
 */
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { getRedirectResult } from 'firebase/auth';

import { auth } from '@/lib/firebase';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  useEffect(() => {
    // When the app reopens after a Firebase auth redirect, this resolves with
    // the auth credential. We don't need to do anything with it — onAuthStateChanged
    // in the useAuth hook will pick up the signed-in user.
    getRedirectResult(auth).catch((err) => {
      console.warn('[codetrail] getRedirectResult error:', err);
    });
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}

/**
 * Root layout.
 *
 * - Calls `WebBrowser.maybeCompleteAuthSession()` to handle the OAuth redirect
 *   handoff from the in-app browser back to the app.
 * - Calls `getRedirectResult(auth)` on mount to capture the result of a
 *   signInWithRedirect that completed while the app was backgrounded.
 */
import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useColorScheme } from 'react-native';
import { getRedirectResult } from 'firebase/auth';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { auth } from '@/lib/firebase';

WebBrowser.maybeCompleteAuthSession();

export default function TabLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // When the app reopens after a Firebase auth redirect, this resolves with
    // the auth credential. We don't need to do anything with it — onAuthStateChanged
    // in the useAuth hook will pick up the signed-in user.
    getRedirectResult(auth).catch((err) => {
      console.warn('[codetrail] getRedirectResult error:', err);
    });
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <AppTabs />
    </ThemeProvider>
  );
}

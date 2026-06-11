/**
 * Root layout.
 *
 * - Calls `WebBrowser.maybeCompleteAuthSession()` to handle the OAuth redirect
 *   handoff from the in-app browser back to the app.
 *
 * In React Native, the OAuth flow works differently than on web:
 * - `signInWithRedirect` opens the in-app browser
 * - User authorizes on GitHub
 * - Browser hands control back to the app
 * - The persisted auth state (via `initializeAuth` + `getReactNativePersistence`
 *   in src/lib/firebase.ts) restores the signed-in user
 * - `onAuthStateChanged` in src/hooks/use-auth.ts fires and updates the UI
 *
 * We DON'T need `getRedirectResult` like we would on web. That function only
 * exists to clean up `window.location` after a web redirect — it has no
 * meaningful behavior in RN. Importing it from `firebase/auth` was actually
 * returning `undefined` at runtime (RN build doesn't export it).
 *
 * Uses Expo Router's <Stack> instead of native tabs. CodeTrail is a
 * single-screen app (just the sign-in / "you shipped" greeting); tabs aren't
 * needed.
 */
import * as WebBrowser from 'expo-web-browser';
import { Stack } from 'expo-router';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

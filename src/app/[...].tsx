/**
 * Catch-all route.
 *
 * This handles deep links whose path doesn't match any other route. The
 * primary use case is Firebase Auth's `signInWithRedirect` flow: when the
 * OAuth handshake completes, Firebase redirects back to the app via the
 * `codetrail://` scheme with an opaque internal path (e.g.
 * `codetrail://auth/callback?...`) that we don't actually need to render.
 *
 * By the time this component mounts, the auth result has already been
 * delivered to Firebase's cordova resolver (via the
 * `cordova-auth-polyfill.ts` universalLinks listener). We just need to
 * make sure the user isn't stuck on Expo Router's default 404 screen —
 * send them home.
 */
import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function CatchAll() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return null;
}

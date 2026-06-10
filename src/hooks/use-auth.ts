/**
 * Auth state hook.
 *
 * Subscribes to Firebase Auth state changes. Returns the current user (or
 * null when signed out), a loading flag, an error, and a signOut helper.
 *
 * Has a 10-second "fail-open" timeout: if `onAuthStateChanged` never resolves
 * (e.g., bad Firebase config, network down, persistence hung), we set
 * `loading: false` and surface an error so the user can at least see the
 * sign-in screen instead of a perpetual spinner.
 */
import { useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';

const LOADING_TIMEOUT_MS = 10_000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let resolved = false;

    if (__DEV__) {
      console.log('[useAuth] subscribing to Firebase auth state');
    }

    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        if (__DEV__) {
          console.log(
            '[useAuth] state:',
            u ? `signed in (uid=${u.uid}, email=${u.email ?? 'n/a'})` : 'signed out'
          );
        }
        if (resolved) return;
        resolved = true;
        setUser(u);
        setLoading(false);
      },
      (err) => {
        if (__DEV__) {
          console.error('[useAuth] auth state error:', err);
        }
        if (resolved) return;
        resolved = true;
        setError(err);
        setLoading(false);
      }
    );

    const timeout = setTimeout(() => {
      if (!resolved) {
        if (__DEV__) {
          console.warn(
            `[useAuth] auth state did not resolve in ${LOADING_TIMEOUT_MS}ms — forcing "signed out" so the sign-in screen renders`
          );
        }
        resolved = true;
        setError(new Error(`Auth state timed out after ${LOADING_TIMEOUT_MS}ms`));
        setLoading(false);
      }
    }, LOADING_TIMEOUT_MS);

    return () => {
      unsub();
      clearTimeout(timeout);
    };
  }, []);

  return {
    user,
    loading,
    error,
    isSignedIn: !!user,
    signOut: () => fbSignOut(auth),
  };
}

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
    if (__DEV__) {
      console.log('[useAuth] subscribing to Firebase auth state');
    }

    // The "fail-open" timer: if Firebase takes too long to report the initial
    // auth state, give up and show the sign-in screen. The ref lets the
    // onAuthStateChanged callback cancel the timer once we get a real update.
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (__DEV__) {
        console.warn(
          `[useAuth] auth state did not resolve in ${LOADING_TIMEOUT_MS}ms — forcing "signed out" so the sign-in screen renders`
        );
      }
      setError(new Error(`Auth state timed out after ${LOADING_TIMEOUT_MS}ms`));
      setLoading(false);
      timer = null;
    }, LOADING_TIMEOUT_MS);

    const cancelTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const unsub = onAuthStateChanged(
      auth,
      (u) => {
        cancelTimer();
        if (__DEV__) {
          console.log(
            '[useAuth] state:',
            u ? `signed in (uid=${u.uid}, email=${u.email ?? 'n/a'})` : 'signed out'
          );
        }
        setUser(u);
        setLoading(false);
      },
      (err) => {
        cancelTimer();
        if (__DEV__) {
          console.error('[useAuth] auth state error:', err);
        }
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      unsub();
      cancelTimer();
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

/**
 * Auth state + user profile.
 *
 * Subscribes to Firebase Auth and loads the user's profile doc from
 * Firestore. Exposes a unified view of "the currently signed-in user
 * and their GitHub account, including the access token for API calls."
 *
 * Single-account MVP. Multi-account will come in v2.0 — at that point,
 * this hook will grow linkedAccounts / primaryAccount / activeAccount
 * and the access token will move to a per-account subcollection.
 *
 * Has a 10-second "fail-open" timeout: if Firebase or Firestore never
 * reports the initial state, we set `loading: false` and surface an
 * error so the user can at least see the sign-in screen instead of a
 * perpetual spinner.
 */
import { useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from '@/lib/firebase';
import type { UserProfile } from '@/lib/account-types';

const LOADING_TIMEOUT_MS = 10_000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // Subscribe to Firebase Auth state.
  useEffect(() => {
    if (__DEV__) {
      console.log('[useAuth] subscribing to Firebase auth state');
    }

    // 10s fail-open timer.
    let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      if (__DEV__) {
        console.warn(
          `[useAuth] auth state did not resolve in ${LOADING_TIMEOUT_MS}ms — forcing "signed out"`,
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
            u ? `signed in (uid=${u.uid}, email=${u.email ?? 'n/a'})` : 'signed out',
          );
        }
        if (!u) {
          // Signed out — clear profile state.
          setUserProfile(null);
          setProfileLoaded(false);
        }
        setUser(u);
        setLoading(false);
      },
      (err) => {
        cancelTimer();
        if (__DEV__) console.error('[useAuth] auth state error:', err);
        setError(err);
        setLoading(false);
      },
    );

    return () => {
      unsub();
      cancelTimer();
    };
  }, []);

  // When the Firebase user changes, load the user profile doc.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setProfileLoaded(false);

    void (async () => {
      try {
        const profileSnap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;

        if (profileSnap.exists()) {
          setUserProfile(profileSnap.data() as UserProfile);
        } else {
          // First sign-in: profile doesn't exist yet. The auth-callback
          // handler is responsible for writing it. For now, leave it null
          // and the consumer can render a "setting up" state.
          if (__DEV__) {
            console.log('[useAuth] no profile doc yet for uid', user.uid);
          }
          setUserProfile(null);
        }
        setProfileLoaded(true);
      } catch (e) {
        if (__DEV__) console.error('[useAuth] failed to load user profile:', e);
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setProfileLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  /**
   * Reload the user profile from Firestore. Call after any profile
   * mutation (sign-in that wrote the profile, sign-out, etc.) to keep
   * state in sync.
   */
  const reloadProfile = async (): Promise<void> => {
    if (!user) return;
    const profileSnap = await getDoc(doc(db, 'users', user.uid));
    if (profileSnap.exists()) {
      setUserProfile(profileSnap.data() as UserProfile);
    } else {
      setUserProfile(null);
    }
  };

  /**
   * Persist "last seen" timestamp. Called on app start and on significant
   * user actions. Best-effort — failures are silent.
   */
  const touchLastSeen = async (): Promise<void> => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { lastSeenAt: serverTimestamp() },
        { merge: true },
      );
    } catch {
      // Best-effort.
    }
  };

  return {
    // Core auth
    user,
    loading,
    error,
    isSignedIn: !!user,

    // Profile
    userProfile,
    profileLoaded,

    // Token of the signed-in user's GitHub account (for GitHub API calls).
    // null until the profile is loaded, or if the user has no profile doc
    // (e.g., first sign-in that hasn't completed writing it).
    githubAccessToken: userProfile?.githubAccessToken ?? null,

    // Actions
    reloadProfile,
    touchLastSeen,
    signOut: () => fbSignOut(auth),
  };
}

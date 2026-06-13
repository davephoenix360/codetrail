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
import { UserProfile, StreakSnapshot } from '@/lib/account-types';

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

  // Self-heal the public usersByLogin index. The auth-callback writes
  // this doc on sign-in, but users who signed in BEFORE that write was
  // added (commit 58efcf2) never got one. Without it, the add-friend
  // flow can't resolve "is @davephoenix360 on CodeTrail?" and the
  // friend's `isOnCodeTrail` flag gets set to false.
  //
  // This effect runs after the profile loads and writes the doc if
  // it's missing. Idempotent: setDoc with merge:true is a no-op when
  // the doc already exists. Best-effort: errors are swallowed so a
  // non-critical index never breaks the app.
  //
  // The dep is keyed on `login` so a Firestore update that changes
  // other fields (streak data, last seen, etc.) doesn't re-trigger
  // the write. Login only changes on actual account switch.
  useEffect(() => {
    const profile = userProfile;
    if (!profile?.login || !profile?.uid || !profile?.avatarUrl) return;

    let cancelled = false;
    void (async () => {
      try {
        await setDoc(
          doc(db, 'usersByLogin', profile.login.toLowerCase()),
          {
            uid: profile.uid,
            login: profile.login,
            avatarUrl: profile.avatarUrl,
            addedAt: serverTimestamp(),
          },
          { merge: true },
        );
        if (!cancelled && __DEV__) {
          console.log('[useAuth] usersByLogin ensured for', profile.login);
        }
      } catch (e) {
        // Non-fatal. A missing or stale index just means the add-friend
        // lookup returns "not on CodeTrail" for us. The user can sign
        // out and back in to retry, or an admin can repair manually.
        if (__DEV__) {
          console.warn('[useAuth] self-heal usersByLogin failed (non-fatal):', e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userProfile?.login, userProfile?.uid, userProfile?.avatarUrl]);

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

  /**
   * Write a fresh streak snapshot back to the user profile. Called by
   * useStreak after a successful loadStreak() so the next /repos mount
   * can render the dashboard instantly from cache.
   *
   * Best-effort: a failed write doesn't surface to the user. The next
   * /repos visit will just re-compute.
   */
  const updateStreak = async (snapshot: StreakSnapshot): Promise<void> => {
    if (!user) return;
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        {
          streak: snapshot.streak,
          lastShippedAt: snapshot.lastShippedAt
            ? new Date(snapshot.lastShippedAt).getTime()
            : null,
          streakData: snapshot,
          streakUpdatedAt: Date.now(),
        },
        { merge: true },
      );
    } catch (e) {
      if (__DEV__) {
        console.warn('[useAuth] updateStreak failed:', e);
      }
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
    updateStreak,
  };
}

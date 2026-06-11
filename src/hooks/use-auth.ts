/**
 * Auth state + linked GitHub accounts.
 *
 * Subscribes to Firebase Auth, loads the user's linkedAccounts
 * subcollection + userProfile doc from Firestore, and exposes a unified
 * view of "the currently signed-in user, their linked GitHub accounts,
 * and the active one (defaults to primary)."
 *
 * For Phase 2.5, "active" === "primary". The user picks a primary from
 * Settings; that's the one whose access token we use for GitHub API
 * calls. In v2.0 we may add a separate "active" (temporary switch
 * without changing primary) — for now the model is the same.
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
import {
  clearActiveGithubId,
  loadActiveGithubId,
  setActiveGithubId,
} from '@/lib/active-account-store';
import { listLinkedAccounts } from '@/lib/firebase-accounts';
import type { LinkedAccount, UserProfile } from '@/lib/account-types';

const LOADING_TIMEOUT_MS = 10_000;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Linked-accounts state. Loaded after the Firebase user resolves.
  const [linkedAccounts, setLinkedAccounts] = useState<LinkedAccount[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [activeGithubId, setActiveGithubIdState] = useState<number | null>(null);

  // Initial mount: read active id from AsyncStorage, subscribe to auth.
  useEffect(() => {
    void loadActiveGithubId().then((id) => {
      if (id !== null) setActiveGithubIdState(id);
    });

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
          // Signed out — clear all linked-account state.
          clearActiveGithubId();
          setActiveGithubIdState(null);
          setLinkedAccounts([]);
          setUserProfile(null);
          setAccountsLoaded(false);
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

  // When the Firebase user changes, load the linked accounts.
  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setAccountsLoaded(false);

    void (async () => {
      try {
        // 1. Load (or create) the user profile doc.
        const profileSnap = await getDoc(doc(db, 'users', user.uid));
        if (cancelled) return;

        let profile: UserProfile;
        if (profileSnap.exists()) {
          profile = profileSnap.data() as UserProfile;
        } else {
          // First sign-in: profile doesn't exist yet. Caller is responsible
          // for writing it (the auth-callback handler does this when it
          // links the first GitHub account). For now, return null and
          // retry on the next effect cycle.
          setUserProfile(null);
          setAccountsLoaded(true);
          return;
        }
        setUserProfile(profile);

        // 2. Load linked accounts.
        const accounts = await listLinkedAccounts(user.uid);
        if (cancelled) return;
        setLinkedAccounts(accounts);
        setAccountsLoaded(true);

        // 3. If no active id is set, default to primary.
        if (activeGithubId === null && profile.primaryGithubId) {
          setActiveGithubId(profile.primaryGithubId);
          setActiveGithubIdState(profile.primaryGithubId);
        }
      } catch (e) {
        if (__DEV__) console.error('[useAuth] failed to load account data:', e);
        if (!cancelled) setError(e instanceof Error ? e : new Error(String(e)));
        if (!cancelled) setAccountsLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, activeGithubId]);

  // ---- Derived values ----

  const primaryAccount = linkedAccounts.find((a) => a.isPrimary) ?? null;
  const activeAccount =
    linkedAccounts.find((a) => a.githubId === activeGithubId) ??
    primaryAccount ??
    null;

  // ---- Actions ----

  /**
   * Reload linked accounts from Firestore. Call after any account mutation
   * (link / unlink / setPrimary) to keep state in sync.
   */
  const reloadAccounts = async (): Promise<void> => {
    if (!user) return;
    const accounts = await listLinkedAccounts(user.uid);
    setLinkedAccounts(accounts);
    const profileSnap = await getDoc(doc(db, 'users', user.uid));
    if (profileSnap.exists()) {
      setUserProfile(profileSnap.data() as UserProfile);
    }
  };

  /**
   * Switch the active account. Updates the AsyncStorage cache and
   * re-reads the LinkedAccount (so the new token takes effect).
   */
  const switchActiveAccount = (githubId: number): void => {
    setActiveGithubId(githubId);
    setActiveGithubIdState(githubId);
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

    // Multi-account state
    userProfile,
    linkedAccounts,
    accountsLoaded,
    primaryAccount,
    activeAccount,
    activeGithubId,

    // Token of the active account (for GitHub API calls). null if not loaded
    // or no active account exists.
    githubAccessToken: activeAccount?.accessToken ?? null,

    // Actions
    reloadAccounts,
    switchActiveAccount,
    touchLastSeen,
    signOut: () =>
      fbSignOut(auth).then(() => {
        clearActiveGithubId();
      }),
  };
}

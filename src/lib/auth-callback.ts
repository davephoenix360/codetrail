/**
 * Shared auth-callback processing logic (single-account MVP).
 *
 * Used by:
 *  - `components/sign-in-with-github.tsx` (in-flight: WebBrowser result or
 *    Linking event while the user is mid-sign-in)
 *  - `app/auth/callback.tsx` (cold-start: app opened directly at
 *    /--/auth/callback via deep link)
 *
 * The single-account flow is:
 *  1. Parse and validate the OAuth callback URL
 *  2. Verify CSRF state
 *  3. Exchange the code for an access token via the Cloudflare Worker
 *  4. Fetch the GitHub profile (id, login, avatar)
 *  5. `signInWithCredential` to sign the user in to Firebase
 *  6. Read the existing user profile (if any)
 *  7. Write the user profile:
 *     - First time: full profile with the fresh access token
 *     - Returning: refresh `githubAccessToken`, `login`, `avatarUrl`, bump `lastSeenAt`
 *
 * CRITICAL: We ALWAYS refresh the access token, even for returning users.
 * `signInWithCredential` proves the fresh token is valid for the current
 * GitHub user; storing it keeps `useAuth().githubAccessToken` working
 * without forcing the user to re-link. (See skill `oauth-with-linked-accounts`
 * for the full rationale.)
 *
 * The CSRF `state` is persisted in AsyncStorage when generated (in
 * `generateAndStoreState`) and cleared when consumed. This lets the
 * state survive the cold-start case where the original React component
 * tree is gone.
 *
 * See skill `react-native-expo-oauth` for the deep-link / WebBrowser
 * handoff details.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { GithubAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from './firebase';
import { getCurrentUser, GitHubApiError, type GitHubUser } from './github-api';

const GITHUB_OAUTH_CLIENT_ID = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID ?? '';
const EXCHANGE_URL = process.env.EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL ?? '';

/**
 * Deep-link URL that GitHub will redirect to after the user authorizes.
 *
 * `Linking.createURL()` returns the right URL for the current runtime:
 *   - In Expo Go (dev):  `exp://<lan-ip>:<metro-port>/--/auth/callback`
 *   - In a standalone build: `codetrail://auth/callback`
 *     (matches the `scheme: "codetrail"` field in `app.json`)
 */
export const REDIRECT_URI = Linking.createURL('/auth/callback');

const STATE_STORAGE_KEY = '@codetrail/oauth-state';

// Dedup: a single OAuth round-trip produces one code. If both the
// WebBrowser result path AND the Linking event path (or the route path)
// fire for the same URL, only the first one should process. Subsequent
// callers return immediately.
const recentlyProcessed = new Set<string>();
const DEDUP_TTL_MS = 60_000;

function markProcessed(url: string): boolean {
  if (recentlyProcessed.has(url)) return false;
  recentlyProcessed.add(url);
  setTimeout(() => recentlyProcessed.delete(url), DEDUP_TTL_MS);
  return true;
}

/** 32 random bytes → base64url. Good enough for CSRF protection. */
export function generateState(): string {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Persist the state in AsyncStorage so cold-start callbacks can verify it. */
export async function generateAndStoreState(): Promise<string> {
  const state = generateState();
  await AsyncStorage.setItem(STATE_STORAGE_KEY, state);
  return state;
}

/** Read the persisted state and clear it (one-shot). */
export async function consumeStoredState(): Promise<string | null> {
  const state = await AsyncStorage.getItem(STATE_STORAGE_KEY);
  if (state !== null) await AsyncStorage.removeItem(STATE_STORAGE_KEY);
  return state;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * What `processAuthCallback` returns. The caller uses this to navigate
 * and (for error) show an Alert.
 */
export type ProcessAuthResult =
  /** Brand new user; profile created. → go to /repos */
  | { kind: 'newUser'; githubLogin: string; githubId: number }
  /** Existing user re-authenticating. → go to /repos */
  | { kind: 'returning'; githubLogin: string; githubId: number }
  /** Something went wrong. → show error, go home */
  | { kind: 'error'; message: string };

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export interface ProcessAuthOptions {
  /** If provided, called with true at start and false at end. */
  setLoading?: (loading: boolean) => void;
}

export async function processAuthCallback(
  rawUrl: string,
  options: ProcessAuthOptions = {},
): Promise<ProcessAuthResult> {
  const { setLoading } = options;
  setLoading?.(true);

  try {
    if (!markProcessed(rawUrl)) {
      // Another path already handled this URL. Return a benign result so
      // the caller can navigate normally.
      return { kind: 'returning', githubLogin: 'unknown', githubId: 0 };
    }

    // 1. Parse the callback URL
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(rawUrl);
    } catch (e) {
      console.warn('[codetrail] invalid callback URL:', rawUrl, e);
      return { kind: 'error', message: 'Invalid callback URL.' };
    }

    const code = callbackUrl.searchParams.get('code');
    const returnedState = callbackUrl.searchParams.get('state');
    const error = callbackUrl.searchParams.get('error');
    const errorDescription = callbackUrl.searchParams.get('error_description');

    if (error) {
      console.warn(`[codetrail] GitHub OAuth error: ${error} (${errorDescription})`);
      return {
        kind: 'error',
        message: errorDescription ?? error ?? 'GitHub sign-in was cancelled.',
      };
    }
    if (!code) {
      console.warn('[codetrail] no code in callback URL:', rawUrl);
      return { kind: 'error', message: 'No authorization code from GitHub.' };
    }

    // 2. CSRF check
    const expectedState = await consumeStoredState();
    if (returnedState !== expectedState) {
      console.warn(
        '[codetrail] state mismatch — possible CSRF, or cold-start with no prior sign-in',
        { returned: returnedState, expected: expectedState },
      );
      return { kind: 'error', message: 'Security check failed. Please try signing in again.' };
    }

    // 3. Exchange code → access token
    let accessToken: string;
    try {
      const response = await fetch(EXCHANGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri: REDIRECT_URI }),
      });
      if (!response.ok) {
        const errBody = await response.text().catch(() => '<no body>');
        console.warn(`[codetrail] exchange worker returned ${response.status}:`, errBody);
        return {
          kind: 'error',
          message: `Could not reach the auth server (HTTP ${response.status}).`,
        };
      }
      const data = (await response.json()) as { accessToken: string };
      accessToken = data.accessToken;
    } catch (e) {
      console.warn('[codetrail] exchange worker call failed:', e);
      return { kind: 'error', message: 'Network error. Check your connection and try again.' };
    }

    // 4. Get the GitHub profile
    let profile: GitHubUser;
    try {
      profile = await getCurrentUser(accessToken);
    } catch (e) {
      const msg = e instanceof GitHubApiError ? e.message : 'Could not load your GitHub profile.';
      console.warn('[codetrail] getCurrentUser failed:', msg);
      return { kind: 'error', message: msg };
    }

    // 5. Sign in to Firebase with the GitHub credential
    try {
      const credential = GithubAuthProvider.credential(accessToken);
      await signInWithCredential(auth, credential);
    } catch (e) {
      console.warn('[codetrail] signInWithCredential failed:', e);
      return { kind: 'error', message: 'Could not sign in. Please try again.' };
    }

    const uid = auth.currentUser?.uid;
    if (!uid) {
      return { kind: 'error', message: 'Sign-in succeeded but no user is set.' };
    }

    // 6. Check if a user profile already exists
    const profileSnap = await getDoc(doc(db, 'users', uid));
    const isNewUser = !profileSnap.exists();

    // 7. Write the user profile. ALWAYS refresh the access token + login +
    //    avatarUrl. The fresh token has been proven valid (we just used it
    //    for signInWithCredential). Bump lastSeenAt in both branches.
    try {
      await setDoc(
        doc(db, 'users', uid),
        {
          uid,
          githubId: profile.id,
          login: profile.login,
          avatarUrl: profile.avatarUrl,
          githubAccessToken: accessToken,
          ...(isNewUser ? { createdAt: serverTimestamp() } : {}),
          lastSeenAt: serverTimestamp(),
          // Streak cache: new users start at 0. Returning users keep
          // whatever was stored (or get the defaults below if they
          // predate the streak fields and sign in fresh).
          ...(isNewUser
            ? {
                streak: 0,
                lastShippedAt: null,
                streakData: null,
                streakUpdatedAt: null,
              }
            : {}),
        },
        { merge: true },
      );
    } catch (e) {
      console.warn('[codetrail] failed to write user profile:', e);
      return {
        kind: 'error',
        message: 'Signed in but could not save your profile. Please try again.',
      };
    }

    // 8. Maintain the public reverse-lookup index. Maps `githubLogin` →
    //    `uid` so the add-friend flow can ask "is @X on CodeTrail?"
    //    without a server-side hop. Public-read (per firestore.rules).
    //    Only the owning user can create their own entry. Doc ID is
    //    lowercased so lookups are case-insensitive (GitHub logins are
    //    case-insensitive on the platform).
    try {
      await setDoc(
        doc(db, 'usersByLogin', profile.login.toLowerCase()),
        {
          uid,
          login: profile.login,
          avatarUrl: profile.avatarUrl,
          addedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (e) {
      // Non-fatal — the user can still sign in and use the app. The lookup
      // just won't be able to find them. Log it for diagnosis.
      console.warn(
        '[codetrail] failed to write usersByLogin index (non-fatal):',
        e,
      );
    }

    return isNewUser
      ? { kind: 'newUser', githubLogin: profile.login, githubId: profile.id }
      : { kind: 'returning', githubLogin: profile.login, githubId: profile.id };
  } finally {
    setLoading?.(false);
  }
}

// Re-export so callers don't need to import the env var directly.
export const AUTH_CONSTANTS = {
  GITHUB_OAUTH_CLIENT_ID,
  EXCHANGE_URL,
  REDIRECT_URI,
} as const;

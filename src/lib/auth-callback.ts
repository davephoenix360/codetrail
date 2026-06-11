/**
 * Shared auth-callback processing logic.
 *
 * Used by:
 *  - `components/sign-in-with-github.tsx` (in-flight: WebBrowser result or
 *    Linking event while the user is mid-sign-in)
 *  - `app/auth/callback.tsx` (cold-start: app opened directly at
 *    /--/auth/callback via deep link)
 *
 * Handles the full multi-account flow:
 *  1. Parse and validate the OAuth callback URL
 *  2. Verify CSRF state
 *  3. Exchange the code for an access token via the Cloudflare Worker
 *  4. Fetch the GitHub profile (id, login, avatar)
 *  5. Read the auth intent (signin vs link) from AsyncStorage
 *  6. Read the public lookup index for this GitHub account
 *  7. Branch on (intent × lookup):
 *     - intent=signin, no lookup:     Case A → new user, create everything
 *     - intent=signin, lookup ours:   Case C → re-auth, refresh session
 *     - intent=signin, lookup other:  Case B → block, return error
 *     - intent=link, no lookup:       Case D → link to current user
 *     - intent=link, lookup ours:     Case D' → already linked, no-op
 *     - intent=link, lookup other:    Case D'' → block, return error
 *
 * The CSRF `state` is persisted in AsyncStorage when generated (in
 * `generateAndStoreState`) and cleared when consumed. This lets the
 * state survive the cold-start case where the original React component
 * tree is gone.
 *
 * See skill `oauth-with-linked-accounts` and BRIEF.md decision log
 * (2026-06-11) for the full design.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { GithubAuthProvider, signInWithCredential } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db } from './firebase';
import { getCurrentUser, GitHubApiError, type GitHubUser } from './github-api';
import { linkGithubAccount, lookupGithubAccount } from './firebase-accounts';

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
const INTENT_STORAGE_KEY = '@codetrail/auth-intent';

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
// Auth intent (signin vs link)
// ---------------------------------------------------------------------------

export type AuthIntent = 'signin' | 'link';

/** Persist the intent before opening the OAuth browser. The callback reads + clears it. */
export async function setAuthIntent(intent: AuthIntent): Promise<void> {
  await AsyncStorage.setItem(INTENT_STORAGE_KEY, intent);
}

/** Read the intent (one-shot — clears it). Defaults to 'signin' if not set. */
export async function consumeAuthIntent(): Promise<AuthIntent> {
  const raw = await AsyncStorage.getItem(INTENT_STORAGE_KEY);
  if (raw !== null) await AsyncStorage.removeItem(INTENT_STORAGE_KEY);
  return raw === 'link' ? 'link' : 'signin';
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * What `processAuthCallback` returns. The caller uses this to navigate
 * and (for error) show an Alert.
 */
export type ProcessAuthResult =
  /** Brand new user; primary account created. → go to /repos */
  | { kind: 'newUser'; githubLogin: string; githubId: number }
  /** Existing user re-authenticating. → go to /repos */
  | { kind: 'reAuth'; githubLogin: string; githubId: number }
  /** Additional account linked to the current user. → go to /settings/accounts */
  | { kind: 'linked'; githubLogin: string; githubId: number }
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
      return { kind: 'reAuth', githubLogin: 'unknown', githubId: 0 };
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

    // 5. Read the auth intent
    const intent = await consumeAuthIntent();

    // 6. Read the lookup index
    const lookup = await lookupGithubAccount(profile.id);

    // 7. Branch on (intent × lookup × current user)
    const currentUid = auth.currentUser?.uid ?? null;

    // --- Link intent (linking an additional account while signed in) ---
    if (intent === 'link') {
      if (!currentUid) {
        return {
          kind: 'error',
          message: 'You need to be signed in to link another GitHub account.',
        };
      }
      if (lookup && lookup.uid !== currentUid) {
        return {
          kind: 'error',
          message: `This GitHub account (${profile.login}) is already linked to a different CodeTrail user. Sign in with your primary GitHub to add it.`,
        };
      }
      if (lookup && lookup.uid === currentUid) {
        // Already linked — treat as a no-op success
        return { kind: 'linked', githubLogin: profile.login, githubId: profile.id };
      }
      // No existing link — write the linked account (NOT primary)
      try {
        await linkGithubAccount(currentUid, profile, accessToken, { isFirstForUser: false });
      } catch (e) {
        console.warn('[codetrail] linkGithubAccount failed:', e);
        return { kind: 'error', message: 'Could not link that GitHub account. Try again in a moment.' };
      }
      return { kind: 'linked', githubLogin: profile.login, githubId: profile.id };
    }

    // --- Sign-in intent (default) ---

    if (lookup && lookup.uid !== currentUid) {
      // CASE B: already linked to a different user → block
      return {
        kind: 'error',
        message: `This GitHub account (${profile.login}) is already linked to a CodeTrail user. Sign in with your primary GitHub account instead.`,
      };
    }

    // We're doing signInWithCredential. This either signs in a brand new
    // user, or refreshes the session for an existing one.
    try {
      const credential = GithubAuthProvider.credential(accessToken);
      await signInWithCredential(auth, credential);
    } catch (e) {
      console.warn('[codetrail] signInWithCredential failed:', e);
      return { kind: 'error', message: 'Could not sign in. Please try again.' };
    }

    // After signIn, the auth state has updated. Re-read the current user.
    const newUid = auth.currentUser?.uid;
    if (!newUid) {
      return { kind: 'error', message: 'Sign-in succeeded but no user is set.' };
    }

    if (lookup && lookup.uid === newUid) {
      // CASE C: re-auth. Just touch lastSeen.
      await setDoc(
        doc(db, 'users', newUid),
        { lastSeenAt: serverTimestamp() },
        { merge: true },
      );
      return { kind: 'reAuth', githubLogin: profile.login, githubId: newUid as unknown as number };
    }

    // CASE A: new user. Write the user profile + linked account + lookup.
    try {
      await setDoc(
        doc(db, 'users', newUid),
        {
          uid: newUid,
          primaryGithubId: profile.id,
          createdAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        },
        { merge: true },
      );
      await linkGithubAccount(newUid, profile, accessToken, { isFirstForUser: true });
    } catch (e) {
      console.warn('[codetrail] failed to write user profile on first sign-in:', e);
      // The Firebase user is created, but the Firestore docs aren't.
      return {
        kind: 'error',
        message: 'Signed in but could not save your profile. Please try again.',
      };
    }
    return { kind: 'newUser', githubLogin: profile.login, githubId: profile.id };
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

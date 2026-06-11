/**
 * Shared auth-callback processing logic.
 *
 * Used by:
 *  - `components/sign-in-with-github.tsx`  (in-flight case: WebBrowser result
 *    or Linking event while the user is mid-sign-in)
 *  - `app/auth/callback.tsx`                (cold-start case: app opened
 *    directly at /--/auth/callback via deep link)
 *
 * The CSRF `state` is persisted in AsyncStorage when generated (in
 * `generateAndStoreState`) and cleared when consumed (inside
 * `processAuthCallback`). This lets the state survive the cold-start
 * case where the original React component tree is gone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GithubAuthProvider, signInWithCredential } from 'firebase/auth';

import { auth } from './firebase';

const GITHUB_OAUTH_CLIENT_ID = process.env.EXPO_PUBLIC_GITHUB_OAUTH_CLIENT_ID ?? '';
const EXCHANGE_URL = process.env.EXPO_PUBLIC_CODETRAIL_EXCHANGE_URL ?? '';
// Must match REDIRECT_URI in components/sign-in-with-github.tsx and the
// GitHub OAuth App's "Authorization callback URL" field.
export const REDIRECT_URI = 'exp://100.109.146.124:8081/--/auth/callback';

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

export interface ProcessAuthOptions {
  /** If provided, called with true at start and false at end. */
  setLoading?: (loading: boolean) => void;
}

/**
 * Process an OAuth callback URL end-to-end:
 *  1. Parse and validate the code/state
 *  2. POST the code to the Cloudflare Worker for exchange
 *  3. Use the returned access token with `signInWithCredential`
 *
 * Returns silently on any failure (with a console.warn). The caller is
 * responsible for showing user-facing errors or navigation.
 */
export async function processAuthCallback(
  rawUrl: string,
  options: ProcessAuthOptions = {},
): Promise<void> {
  const { setLoading } = options;
  setLoading?.(true);

  try {
    if (!markProcessed(rawUrl)) {
      // Another path already handled this URL.
      return;
    }

    // 1. Parse the callback URL
    let callbackUrl: URL;
    try {
      callbackUrl = new URL(rawUrl);
    } catch (e) {
      console.warn('[codetrail] invalid callback URL:', rawUrl, e);
      return;
    }

    const code = callbackUrl.searchParams.get('code');
    const returnedState = callbackUrl.searchParams.get('state');
    const error = callbackUrl.searchParams.get('error');
    const errorDescription = callbackUrl.searchParams.get('error_description');

    if (error) {
      console.warn(`[codetrail] GitHub OAuth error: ${error} (${errorDescription})`);
      return;
    }
    if (!code) {
      console.warn('[codetrail] no code in callback URL:', rawUrl);
      return;
    }

    // 2. CSRF check — compare against the state we persisted when the
    //    user tapped "Sign in". consumeStoredState() also clears it.
    const expectedState = await consumeStoredState();
    if (returnedState !== expectedState) {
      console.warn(
        '[codetrail] state mismatch — possible CSRF attack, or cold-start with no prior sign-in',
        { returned: returnedState, expected: expectedState },
      );
      return;
    }

    // 3. Exchange the code for an access token via the Cloudflare Worker
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
        return;
      }
      const data = (await response.json()) as {
        accessToken: string;
        scope: string;
        tokenType: string;
      };
      accessToken = data.accessToken;
    } catch (e) {
      console.warn('[codetrail] exchange worker call failed:', e);
      return;
    }

    // 4. Sign in to Firebase with the GitHub access token
    try {
      const credential = GithubAuthProvider.credential(accessToken);
      await signInWithCredential(auth, credential);
      // The useAuth hook's onAuthStateChanged will update the UI. No
      // setLoading(false) here — the app is signing in.
    } catch (e) {
      console.warn('[codetrail] signInWithCredential failed:', e);
    }
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

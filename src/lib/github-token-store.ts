/**
 * GitHub access token store.
 *
 * After `signInWithCredential(auth, GithubAuthProvider.credential(token))`,
 * Firebase Auth consumes the token and does NOT expose it back to us. We
 * keep our own copy so we can call GitHub's REST API on the user's behalf
 * (via the Cloudflare Worker proxy).
 *
 * The token is persisted to AsyncStorage so it survives app restarts as
 * long as the user stays signed in. Cleared on sign-out.
 *
 * Why not store it in Firestore? For a single-account MVP, AsyncStorage
 * is fine and keeps the read path sync. For multi-account (Phase 2.5),
 * we'll move this to Firestore so it can sync across devices.
 *
 * Why not store it on the Firebase user object? The Firebase JS SDK
 * doesn't expose the OAuth provider's access token on the User after
 * signInWithCredential — the token is consumed during the credential
 * exchange. The `stsTokenManager` only holds the Firebase ID token.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@codetrail/github-access-token';

// Module-level state. The auth hook reads from here; components that need
// the token get it through the hook. (We avoid a global pub-sub for now
// because the token only changes at sign-in / sign-out — easy to handle
// via a re-render triggered by the auth state change.)
let currentToken: string | null = null;
let loaded = false;

/** Load the persisted token from AsyncStorage into module memory. Call once on app start. */
export async function loadGitHubToken(): Promise<string | null> {
  if (loaded) return currentToken;
  try {
    currentToken = await AsyncStorage.getItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[codetrail] failed to load GitHub token from AsyncStorage:', e);
    currentToken = null;
  }
  loaded = true;
  return currentToken;
}

/** Set the token in memory and persist it. Called right after a successful GitHub sign-in. */
export function setGitHubToken(token: string): void {
  currentToken = token;
  loaded = true;
  AsyncStorage.setItem(STORAGE_KEY, token).catch((e) => {
    console.warn('[codetrail] failed to persist GitHub token:', e);
  });
}

/** Clear the token from memory and AsyncStorage. Called on sign-out. */
export function clearGitHubToken(): void {
  currentToken = null;
  loaded = true;
  AsyncStorage.removeItem(STORAGE_KEY).catch((e) => {
    console.warn('[codetrail] failed to clear persisted GitHub token:', e);
  });
}

/** Synchronous read. Returns null if the token hasn't been loaded yet. */
export function getGitHubToken(): string | null {
  return currentToken;
}

/** True after the initial load from AsyncStorage has completed (success or failure). */
export function isGitHubTokenLoaded(): boolean {
  return loaded;
}

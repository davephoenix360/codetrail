/**
 * Persistent state for the active GitHub account.
 *
 * In Phase 2.5, "active" is the same as "primary" — the user picks one
 * linked account as primary from Settings, and that's the one we use for
 * GitHub API calls. We store just the `githubId` here (not the token);
 * the token lives in the `users/{uid}/linkedAccounts/{githubId}` Firestore
 * doc (see lib/firebase-accounts.ts).
 *
 * AsyncStorage here is just a cache of "which ID is the user currently
 * using." On app start, `useAuth` reads this, then finds the matching
 * LinkedAccount in Firestore to get the token.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@codetrail/active-github-id';

let activeGithubId: number | null = null;
let loaded = false;

export async function loadActiveGithubId(): Promise<number | null> {
  if (loaded) return activeGithubId;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = parseInt(raw, 10);
      if (!Number.isNaN(parsed)) activeGithubId = parsed;
    }
  } catch (e) {
    console.warn('[codetrail] failed to load active GitHub id:', e);
  }
  loaded = true;
  return activeGithubId;
}

export function setActiveGithubId(githubId: number): void {
  activeGithubId = githubId;
  loaded = true;
  AsyncStorage.setItem(STORAGE_KEY, String(githubId)).catch((e) => {
    console.warn('[codetrail] failed to persist active GitHub id:', e);
  });
}

export function getActiveGithubId(): number | null {
  return activeGithubId;
}

export function clearActiveGithubId(): void {
  activeGithubId = null;
  loaded = true;
  AsyncStorage.removeItem(STORAGE_KEY).catch((e) => {
    console.warn('[codetrail] failed to clear active GitHub id:', e);
  });
}

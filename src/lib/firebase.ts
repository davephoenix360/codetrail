/**
 * Firebase v12 initialization for React Native.
 *
 * Two key things happening here:
 *
 * 1. `initializeAuth` (not `getAuth`) with `getReactNativePersistence`:
 *    - On web, Firebase defaults to `inMemoryPersistence` or `indexedDBPersistence`
 *      depending on the platform.
 *    - On React Native, the web persistence doesn't work — we need AsyncStorage.
 *    - `getReactNativePersistence` is exported by `@firebase/auth`'s RN build
 *      (via its `react-native` package.json field), but TypeScript's resolution
 *      doesn't honor that field. So we use `@ts-expect-error` to bypass tsc
 *      while Metro (the bundler) resolves it correctly at bundle time.
 *
 * 2. Fallback to `getAuth(app)`:
 *    - If `initializeAuth` throws (e.g., it was already called once), we fall
 *      back to `getAuth(app)`. This can happen with hot reload.
 */
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
// @ts-expect-error - getReactNativePersistence is exported by @firebase/auth's RN build, but tsc doesn't resolve the "react-native" package.json field
import { getReactNativePersistence } from '@firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// Sanity check: surface config errors early (in dev console) so we don't get
// a silent "stuck on loading" state from invalid config.
const present = Object.entries(firebaseConfig).filter(([_, v]) => v).map(([k]) => k);
if (__DEV__) {
  console.log(`[firebase] config: ${present.length} present (${present.join(', ')})`);
}

const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;

let _auth: Auth;
try {
  _auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} catch (err) {
  // initializeAuth throws if called more than once (e.g., on hot reload).
  // Fall back to getAuth, which returns the existing instance.
  if (__DEV__) {
    console.warn('[firebase] initializeAuth failed, falling back to getAuth:', err);
  }
  _auth = getAuth(app);
}

export const auth = _auth;

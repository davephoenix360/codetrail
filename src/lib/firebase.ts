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
 * 2. `popupRedirectResolver: cordovaPopupRedirectResolver`:
 *    - Lets us use the standard `signInWithRedirect` / `getRedirectResult`
 *      API in React Native + Expo, instead of writing a custom
 *      OAuth-code-exchange flow.
 *    - The cordova resolver expects `window.cordova.plugins.browsertab`,
 *      `window.universalLinks`, and `window.BuildInfo` — all of which we
 *      polyfill in `cordova-auth-polyfill.ts`. The polyfill must be imported
 *      BEFORE `initializeAuth` so the resolver sees the polyfilled window
 *      on its first call.
 *
 * 3. Fallback to `getAuth(app)`:
 *    - If `initializeAuth` throws (e.g., it was already called once), we fall
 *      back to `getAuth(app)`. This can happen with hot reload.
 */
import { FirebaseApp, getApps, initializeApp } from 'firebase/app';
import { Auth, getAuth, initializeAuth } from 'firebase/auth';
// @ts-expect-error - getReactNativePersistence is exported by @firebase/auth's RN build, but tsc doesn't resolve the "react-native" package.json field
import { getReactNativePersistence } from '@firebase/auth';
import { cordovaPopupRedirectResolver } from '@firebase/auth/cordova';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

// Side-effect import: installs the window.cordova / universalLinks / BuildInfo
// polyfills that cordovaPopupRedirectResolver expects to find. MUST come
// before `initializeAuth` below.
import './cordova-auth-polyfill';

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

const firebaseApp: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]!;

let _auth: Auth;
try {
  _auth = initializeAuth(firebaseApp, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    popupRedirectResolver: cordovaPopupRedirectResolver,
  });
} catch (err) {
  // initializeAuth throws if called more than once (e.g., on hot reload).
  // Fall back to getAuth, which returns the existing instance.
  if (__DEV__) {
    console.warn('[firebase] initializeAuth failed, falling back to getAuth:', err);
  }
  _auth = getAuth(firebaseApp);
}

export const app = firebaseApp;
export const auth = _auth;

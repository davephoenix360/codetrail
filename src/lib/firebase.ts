/**
 * Firebase initialization (React Native).
 *
 * Firebase v12 splits the public `firebase/auth` (browser-first exports)
 * from the lower-level `@firebase/auth` (which has a `react-native`
 * package.json field pointing to a build that re-exports
 * `getReactNativePersistence`). tsc doesn't honor the `react-native` field
 * for type resolution, so we use `@ts-expect-error` for that one import.
 * Metro (the RN bundler) resolves the import to the correct RN build at
 * bundle time, so it works at runtime even though tsc complains.
 */
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeAuth, getAuth, Auth } from 'firebase/auth';
// @ts-expect-error -- exported by @firebase/auth's RN build; tsc doesn't know
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

if (__DEV__) {
  const present = Object.entries(firebaseConfig).filter(([, v]) => v).map(([k]) => k);
  const missing = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k);
  console.log(
    `[firebase] config: ${present.length} present (${present.join(', ')})${missing.length ? `, ${missing.length} MISSING (${missing.join(', ')})` : ''}`
  );
}

export const app: FirebaseApp = getApps().length
  ? getApps()[0]!
  : initializeApp(firebaseConfig);

let _auth: Auth;
try {
  _auth = initializeAuth(app, {
    persistence: getReactNativePersistence(ReactNativeAsyncStorage),
  });
} catch (err) {
  // initializeAuth can only be called once per app. Hot-reload in dev re-runs
  // the module; in that case we fall back to the default auth instance.
  if (__DEV__) {
    console.warn('[firebase] initializeAuth already called, falling back:', err);
  }
  _auth = getAuth(app);
}

export const auth = _auth;

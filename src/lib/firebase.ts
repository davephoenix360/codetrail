/**
 * Firebase initialization.
 *
 * Firebase v12 auto-detects the platform: in React Native, it uses
 * AsyncStorage (which we installed as @react-native-async-storage/async-storage)
 * for auth persistence. No explicit `getReactNativePersistence` call needed
 * (that helper was removed in v12).
 */
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const app: FirebaseApp = getApps().length
  ? getApps()[0]!
  : initializeApp(firebaseConfig);

export const auth: Auth = getAuth(app);

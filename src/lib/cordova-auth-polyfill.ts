/**
 * Polyfill for the Cordova plugins that Firebase's `cordovaPopupRedirectResolver`
 * expects on `window`. This lets us use the standard `signInWithRedirect` /
 * `getRedirectResult` API in React Native + Expo without writing a custom
 * OAuth code-exchange flow.
 *
 * The polyfill is installed as a side effect when this module is imported.
 * Import it from `firebase.ts` BEFORE `initializeAuth` so the resolver sees
 * the polyfilled `window` on its first call.
 *
 * What we provide (matching the Cordova plugin surface Firebase checks for):
 *
 *   window.cordova.plugins.browsertab.{isAvailable, openUrl}
 *     → backed by `expo-web-browser.openAuthSessionAsync`
 *     → opens the Firebase-generated auth URL in the system browser, returns
 *        when the browser detects a redirect to our app's deep link
 *
 *   window.universalLinks.subscribe
 *     → forwards `Linking` 'url' events to subscribers, with replay for
 *        late subscribers (the cold-start case where the deep link arrives
 *        before Firebase's resolver has registered its listener)
 *     → also calls `Linking.getInitialURL()` to cover the case where the app
 *        was launched by the deep link (no subsequent 'url' event fires)
 *
 *   window.BuildInfo.{packageName, displayName}
 *     → from `expo-constants`; Firebase's auth handler uses these to
 *        construct the return URL (it adds `apn=` / `ibi=` query params so
 *        the resulting redirect goes back to this specific app)
 */
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';

const APP_PACKAGE =
  Constants.expoConfig?.android?.package ??
  Constants.expoConfig?.ios?.bundleIdentifier ??
  'com.davephoenix360.codetrail';
const APP_DISPLAY_NAME =
  (Constants.expoConfig?.name as string | undefined) ?? 'CodeTrail';

// The deep-link URL that Firebase's auth handler will redirect to after
// processing the OAuth response. We use the same scheme registered in
// `app.json`. The "auth/firebase-callback" path is arbitrary — with
// `signInWithRedirect`, no app-side route is actually rendered; Firebase's
// resolver consumes the result internally and surfaces it via
// `getRedirectResult` / `onAuthStateChanged`.
const APP_DEEP_LINK = Linking.createURL('auth/firebase-callback');

// In React Native builds, `window` is not declared (it's a browser-only
// global). The expo/tsconfig.base doesn't include the DOM lib. We polyfill
// it onto `globalThis`, which IS always defined.
const w: any = (globalThis as any).window ?? ((globalThis as any).window = {});

function install(): void {
  // No-op on SSR / non-browser environments
  if (typeof w === 'undefined') return;
  // Idempotent — re-importing during hot reload shouldn't double-install
  if (w.cordova?.plugins?.browsertab) return;

  // 1) cordova.plugins.browsertab — opens the auth URL in a browser and
  //    resolves when the browser detects a redirect to our deep link.
  w.cordova = w.cordova ?? {};
  w.cordova.plugins = w.cordova.plugins ?? {};
  w.cordova.plugins.browsertab = {
    isAvailable: async () => true,
    openUrl: async (url: string) => {
      // openAuthSessionAsync blocks until either:
      //   - the user authorizes and the OAuth provider redirects to APP_DEEP_LINK
      //   - the user dismisses the browser
      //   - the request fails
      // Firebase's resolver consumes the result via the universalLinks
      // listener below — openAuthSessionAsync's return value is not used by
      // the resolver, but we await it so this promise chain resolves cleanly.
      await WebBrowser.openAuthSessionAsync(url, APP_DEEP_LINK);
    },
  };

  // 2) universalLinks — forwards `Linking` 'url' events to all subscribers,
  //    with buffering for late subscribers (cold-start race). Firebase's
  //    resolver subscribes lazily, the first time `signInWithRedirect` or
  //    `getRedirectResult` is called — which may be AFTER the OS has
  //    already delivered the deep link.
  const subscribers: ((event: { url: string }) => void)[] = [];
  const pendingUrls: string[] = [];

  const dispatch = (url: string) => {
    if (subscribers.length === 0) {
      pendingUrls.push(url);
    } else {
      for (const cb of subscribers) cb({ url });
    }
  };

  Linking.addEventListener('url', ({ url }) => {
    dispatch(url);
  });
  // Cold-start: app was launched by the deep link, no 'url' event will fire.
  Linking.getInitialURL().then((url) => {
    if (url) dispatch(url);
  });

  w.universalLinks = {
    subscribe: (
      _eventName: string | null,
      cb: (event: { url: string }) => void,
    ) => {
      subscribers.push(cb);
      // Replay URLs that arrived before this subscriber registered
      while (pendingUrls.length > 0) {
        const url = pendingUrls.shift()!;
        cb({ url });
      }
    },
  };

  // 3) BuildInfo — Firebase's auth handler uses these to construct the
  //    return URL (it adds `apn=` / `ibi=` query params).
  w.BuildInfo = {
    packageName: APP_PACKAGE,
    displayName: APP_DISPLAY_NAME,
  };

  if (__DEV__) {
    console.log(
      `[cordova-polyfill] installed. packageName=${APP_PACKAGE} deepLink=${APP_DEEP_LINK}`
    );
  }
}

install();

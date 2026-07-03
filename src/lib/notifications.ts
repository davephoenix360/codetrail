/**
 * Push notification registration + handlers (Phase 2.7 foundation).
 *
 * What this module does:
 *   1. Registers the device with Expo's Push service and returns a token.
 *   2. Sets up listeners for incoming notifications + taps.
 *   3. Persists the token + the device's IANA timezone to the user
 *      profile doc so the server-side scheduler (future Cloudflare
 *      Worker cron) can target the user.
 *
 * What this module does NOT do (yet):
 *   - Send notifications. The server-side scheduler lives in a separate
 *     Cloudflare Worker and reads the token + prefs from Firestore.
 *   - Schedule local notifications. The server handles all scheduling
 *     because (a) iOS purges local notifications when the app is closed,
 *     and (b) we need timezone-aware send times ("8 PM in Edmonton").
 *
 * ## Expo Go compatibility
 *
 * Starting with Expo SDK 53, `expo-notifications` was REMOVED from
 * Expo Go (the module throws on import). The `require()` below is
 * wrapped in try/catch so the app stays usable in Expo Go for UI
 * iteration — push just becomes a no-op. Real push delivery still
 * requires a development build (EAS Build).
 *
 * Why the lazy require (instead of a regular import): a static
 * `import * as Notifications from 'expo-notifications'` runs at
 * module-evaluation time and triggers the Expo Go removal error,
 * which crashes the whole app before any component can render. The
 * `require()` runs lazily, after module load, so a failure is
 * recoverable.
 *
 * Reference: https://docs.expo.dev/develop/development-builds/introduction/
 */
import { useEffect, useRef } from 'react';
import * as Device from 'expo-device';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from './firebase';

// Lazy-load expo-notifications. Fails silently in Expo Go (SDK 53+).
// `typeof import(...)` gives us the module's type without triggering
// the import at type-check time.
type NotificationsModule = typeof import('expo-notifications');
let _Notifications: NotificationsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _Notifications = require('expo-notifications') as NotificationsModule;
} catch (e) {
  if (__DEV__) {
    console.warn(
      '[notifications] expo-notifications not loaded (Expo Go SDK 53+ removed it). ' +
        'Push will be a no-op. Use a development build to test real push.',
    );
  }
}

const pushAvailable = (): boolean => _Notifications !== null;

// How the app should behave when a notification arrives while the
// app is foregrounded. We want them to show (not silently swallow) but
// not play a sound (the user is already looking at the app). This is
// the Expo-recommended pattern for non-intrusive in-app banners.
//
// Only set up if the module loaded (real build or dev build). In
// Expo Go this is a no-op.
if (_Notifications) {
  _Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Register the device with Expo Push. Returns the Expo Push token, or
 * null if registration isn't possible.
 *
 * Possible null cases:
 *   - expo-notifications failed to load (Expo Go SDK 53+)
 *   - Running on a simulator (Device.isDevice is false)
 *   - User denied the permission prompt
 *   - The runtime / device doesn't support push
 *
 * Always returns a real token in production. In Expo Go, returns a
 * fake `ExponentPushToken[...]` string — harmless for persistence but
 * not deliverable.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!pushAvailable() || !_Notifications) {
    if (__DEV__) {
      console.log('[notifications] push module unavailable — skipping registration');
    }
    return null;
  }

  // Push tokens only work on real physical devices. On simulators/Emu,
  // `Device.isDevice` is false. We don't try to register in that case.
  if (!Device.isDevice) {
    if (__DEV__) {
      console.log('[notifications] not a physical device — skipping push registration');
    }
    return null;
  }

  // Android 13+ requires POST_NOTIFICATIONS permission at runtime.
  // iOS asks on the first `getPermissionsAsync` call.
  //
  // The returned shape has both `granted` (boolean) and `status`
  // ('granted' | 'denied' | 'undetermined'). We read `granted` because
  // it's the simpler boolean. TSC's `NotificationPermissionsStatus`
  // type is supposed to extend `PermissionResponse` which has `granted`,
  // but in this version of @types the chain doesn't fully resolve —
  // the field is present at runtime, so we cast to the known shape.
  type PermsResponse = { granted: boolean; canAskAgain?: boolean };
  const existing = (await _Notifications.getPermissionsAsync()) as unknown as PermsResponse;
  let granted = existing.granted;
  if (!granted) {
    const next = (await _Notifications.requestPermissionsAsync()) as unknown as PermsResponse;
    granted = next.granted;
  }
  if (!granted) {
    if (__DEV__) {
      console.log('[notifications] permission not granted — skipping push registration');
    }
    return null;
  }

  // Get the Expo push token. In a real build this is the token the
  // server-side Worker will send notifications to.
  // `projectId` is required for FCM on Android; in Expo it's read from
  // app.json's `extra.eas.projectId`.
  const tokenResponse = await _Notifications.getExpoPushTokenAsync();
  if (__DEV__) {
    console.log('[notifications] got Expo push token:', tokenResponse.data);
  }
  return tokenResponse.data;
}

/**
 * Get the device's IANA timezone (e.g. "America/Edmonton"). Used by
 * the server-side scheduler to compute "what time is it for the user
 * right now" for daily check-in notifications.
 *
 * `Intl.DateTimeFormat` is the most reliable way to get this — it's
 * built into JS, no native module needed, and matches the device's
 * actual timezone setting (including DST).
 */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback if the runtime doesn't support timezone resolution.
    return 'UTC';
  }
}

/**
 * Persist the push token + timezone to the user profile doc. The
 * server-side scheduler reads these fields to know who to send to
 * and when.
 *
 * Best-effort: a failed write doesn't throw — the user can still use
 * the app, they just won't get push notifications.
 */
export async function persistPushRegistration(
  uid: string,
  token: string,
  timezone: string,
): Promise<void> {
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        expoPushToken: token,
        timezone,
        pushRegisteredAt: serverTimestamp(),
      },
      { merge: true },
    );
    if (__DEV__) {
      console.log('[notifications] persisted push token + timezone for', uid);
    }
  } catch (e) {
    if (__DEV__) {
      console.warn('[notifications] failed to persist push registration:', e);
    }
  }
}

/**
 * Type for the Subscription handle from expo-notifications, with a
 * fallback when the module isn't loaded. The Subscription is always
 * `{ remove(): void }` shape in practice; we narrow it loosely here.
 */
type RemoveSubscription = { remove: () => void };

/**
 * React hook: register for push on mount, set up tap + receive
 * listeners for the lifetime of the component.
 *
 * Call this once at the root (e.g. in the authenticated screen) so
 * listeners stay active for the whole app session. The token
 * registration is idempotent — running it twice just re-writes the
 * same token.
 *
 * In Expo Go (push module unavailable): the hook is a complete no-op.
 * Registration functions return null, no listeners get added.
 */
export function usePushNotifications(uid: string | null): void {
  // Use refs for the listener subscriptions so cleanup is correct
  // even if the hook re-runs.
  const notificationListener = useRef<RemoveSubscription | null>(null);
  const responseListener = useRef<RemoveSubscription | null>(null);

  useEffect(() => {
    if (!uid) return;
    if (!pushAvailable() || !_Notifications) {
      if (__DEV__) {
        console.log('[usePushNotifications] push module unavailable — skipping');
      }
      return;
    }

    const Notifications = _Notifications;

    // Register the device for push. Fire-and-forget — registration
    // is best-effort; if it fails (permission denied, no device), the
    // user can still use the app.
    void (async () => {
      const token = await registerForPushNotificationsAsync();
      if (token) {
        const timezone = getDeviceTimezone();
        await persistPushRegistration(uid, token, timezone);
      }
    })();

    // Listener: a notification was received while the app was
    // foregrounded. Currently we just log it — the global
    // setNotificationHandler above controls display. Future: dispatch
    // to a toast or update badge count.
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        if (__DEV__) {
          console.log('[notifications] received:', notification.request.content.title);
        }
      },
    );

    // Listener: the user tapped a notification. Currently we just log
    // the data — the deep-link-to-screen behavior will be wired up
    // when the server-side scheduler is built (next session).
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        if (__DEV__) {
          console.log(
            '[notifications] tapped:',
            response.notification.request.content.data,
          );
        }
      },
    );

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
      notificationListener.current = null;
      responseListener.current = null;
    };
  }, [uid]);
}

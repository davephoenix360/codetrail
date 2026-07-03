/**
 * Notification preferences — the user's settings for which push
 * notifications they want to receive (Phase 2.7).
 *
 * Defaults are tuned for the hype-man voice:
 *   - Daily check-in: ON. The whole point of the app is the daily
 *     reminder. If you turn this off, the streak is still visible in
 *     the app, but the app stops "showing up" in your day.
 *   - Streak milestones: ON. The hype-man celebration. "🔥 7-day
 *     streak!" is the moment the product feels alive.
 *   - Streak broken: ON. The "we all hit resets" message is the
 *     anti-guilt-trip notification. Critical for the brand.
 *   - Welcome back: ON. If you disappear for a week, we want to say
 *     "your projects missed you" — not "you failed."
 *   - Friend activity: OFF. Per the BRIEF: "low-noise by default. No
 *     FOMO design." Opt-in only.
 *   - Low-noise mode: OFF. When ON, only milestones fire (no daily
 *     check-in, no broken/welcome-back). For the user who wants the
 *     celebration but not the cadence.
 *   - Check-in time: 8 PM local. Late enough that you've had a workday
 *     to ship, early enough that you can still ship before midnight.
 */
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';

import { db } from './firebase';

export const DEFAULT_CHECK_IN_TIME = '20:00';

export interface NotificationPrefs {
  /** Daily reminder: "you haven't shipped today, X hours until streak rollover." */
  dailyCheckIn: boolean;
  /** Streak milestone celebration (7, 14, 30, 60, 100). */
  streakMilestones: boolean;
  /** "Streak's at 0. The next one starts when you ship." */
  streakBroken: boolean;
  /** "Welcome back. Your projects missed you." (7+ days off) */
  welcomeBack: boolean;
  /** "Tino just shipped X." Opt-in. Default off (low-noise per BRIEF). */
  friendActivity: boolean;
  /** When true, suppress daily + broken + welcome-back. Milestones still fire. */
  lowNoiseMode: boolean;
  /** "HH:MM" 24h in the user's local timezone. */
  checkInTime: string;
  /** IANA timezone, set at registration time (e.g. "America/Edmonton"). */
  timezone: string;
  /** When prefs were last updated (ms epoch). */
  updatedAt: number;
}

/**
 * Returns the default prefs, with the timezone replaced by the
 * supplied value if provided (the device's IANA tz is captured at
 * registration; we don't want to default to anything arbitrary).
 */
export function defaultNotificationPrefs(timezone?: string): NotificationPrefs {
  return {
    dailyCheckIn: true,
    streakMilestones: true,
    streakBroken: true,
    welcomeBack: true,
    friendActivity: false,
    lowNoiseMode: false,
    checkInTime: DEFAULT_CHECK_IN_TIME,
    timezone: timezone ?? 'UTC',
    updatedAt: Date.now(),
  };
}

/**
 * Read the user's notification prefs from Firestore. Returns the
 * default prefs (with the device's current timezone) if the doc
 * doesn't have any prefs yet.
 *
 * The user's profile doc is the source of truth — we don't store
 * prefs in a separate sub-collection because they're small (8 fields)
 * and always read together with the profile.
 */
export async function getNotificationPrefs(
  uid: string,
  fallbackTimezone?: string,
): Promise<NotificationPrefs> {
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) {
      return defaultNotificationPrefs(fallbackTimezone);
    }
    const data = snap.data() as { notificationPrefs?: Partial<NotificationPrefs> };
    if (!data.notificationPrefs) {
      return defaultNotificationPrefs(fallbackTimezone);
    }
    // Merge with defaults so newly added fields get sensible values
    // when an old prefs doc is read.
    return {
      ...defaultNotificationPrefs(fallbackTimezone),
      ...data.notificationPrefs,
    };
  } catch (e) {
    if (__DEV__) {
      console.warn('[notification-prefs] failed to read prefs:', e);
    }
    return defaultNotificationPrefs(fallbackTimezone);
  }
}

/**
 * Persist updated notification prefs. Uses `merge: true` so we don't
 * clobber other fields on the user profile doc.
 *
 * The server-side scheduler will read these prefs (along with the
 * push token) to decide what to send and when.
 */
export async function updateNotificationPrefs(
  uid: string,
  partial: Partial<NotificationPrefs>,
): Promise<void> {
  // Strip the `updatedAt` from the partial — we set it server-side
  // so all clients see the same timestamp.
  const { updatedAt: _ignored, ...rest } = partial;
  await setDoc(
    doc(db, 'users', uid),
    {
      notificationPrefs: {
        ...rest,
        updatedAt: Date.now(),
      },
      notificationPrefsUpdatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  if (__DEV__) {
    console.log('[notification-prefs] updated for', uid, partial);
  }
}

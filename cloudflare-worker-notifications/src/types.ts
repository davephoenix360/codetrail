/**
 * Shared types for the notifications scheduler.
 *
 * Mirrors src/lib/notification-prefs.ts on the client side. Keep in sync
 * when adding prefs — both files describe the same Firestore sub-doc
 * (users/{uid}/settings/notifications).
 */

export interface NotificationPrefs {
  dailyCheckIn: boolean;
  streakMilestones: boolean;
  streakBroken: boolean;
  welcomeBack: boolean;
  /** Deferred to v1.1 — kept here for forward compat. */
  friendActivity: boolean;
  /** Pauses everything except broken + welcome-back. */
  lowNoiseMode: boolean;
}

export interface NotificationSettings {
  prefs: NotificationPrefs;
  /** "HH:MM" 24h, default "20:00". */
  checkInTime: string;
  /** IANA timezone, e.g. "America/Edmonton". */
  timezone: string;
  /** Expo push token; null if registration failed or user denied. */
  expoPushToken: string | null;
  lastSentAt: {
    dailyCheckIn?: number;
    broken?: number;
    milestone?: number;
    welcomeBack?: number;
  };
  /** Streak milestone values that have already been celebrated. */
  milestonesCelebrated: number[];
  /** ms epoch — last time the app was foregrounded. */
  lastSeenAt: number;
  /** "YYYY-MM-DD" user-local — last day a tracked repo had a commit. */
  lastShipDate: string | null;
  /** Mirrors lib/streak.ts streakCurrent. */
  streakCurrent: number;
}

/** A rendered notification ready to send. */
export interface RenderedNotification {
  type: 'dailyCheckIn' | 'broken' | 'milestone' | 'welcomeBack';
  title: string;
  body: string;
  /** Custom key for analytics + deep link routing. */
  data: Record<string, string>;
}

/** Result of evaluating one notification type for one user. */
export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  notification?: RenderedNotification;
}

/** Service account JSON structure (from Firebase console → Project Settings → Service Accounts). */
export interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

export interface Env {
  /** Set via `wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON`. */
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  /** Set via `wrangler secret put EXPO_ACCESS_TOKEN` (optional). */
  EXPO_ACCESS_TOKEN?: string;
  /** Plain vars from wrangler.toml [vars]. */
  LOG_LEVEL: string;
  FIRESTORE_PROJECT_ID: string;
}

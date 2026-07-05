/**
 * Firestore REST API access for Cloudflare Workers.
 *
 * Why REST not the SDK: the official @google-cloud/firestore SDK doesn't
 * run in Workers (relies on node:http, gRPC internals). The REST API is
 * a thin wrapper over HTTPS + a Google OAuth2 token.
 *
 * Auth: service account JSON → RS256 JWT → OAuth2 access token (cached
 * per isolate for ~55 min). See the "Firestore access" section of the
 * design doc for the full rationale.
 *
 * ## Schema (v1, matches the live app)
 *
 * Notification state lives on the PARENT user doc, NOT a sub-doc:
 *   users/{uid}
 *     - expoPushToken: string | null        ← set by notifications.ts on registration
 *     - timezone: string                   ← IANA, set on registration
 *     - streak: number                     ← current streak (days)
 *     - lastShippedAt: number | null       ← ms epoch
 *     - lastSeenAt: number                 ← ms epoch
 *     - notificationPrefs: { ... }         ← all the toggles + checkInTime
 *
 * The Worker also writes back its own state into the parent doc:
 *     - lastSentAt: { dailyCheckIn?, broken?, milestone?, welcomeBack? }
 *     - milestonesCelebrated: number[]     ← streak values already announced
 *
 * The first version of this module assumed a `users/{uid}/settings/notifications`
 * sub-doc. That was wrong — the app has always written to the parent doc.
 * Mismatch caught when the first /test request 404'd. See
 * `notes/codetrail/worker-schema-mismatch.md` for the full story.
 */

import * as jose from 'jose';
import type { ServiceAccount, NotificationSettings } from './types';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_TTL_MS = 55 * 60 * 1000; // Google's tokens last 60 min; refresh at 55.

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/**
 * Mint a Google OAuth2 access token from a service account. Caches in
 * module scope (Workers reuse module state across invocations within
 * the same isolate — perfect for token caching).
 */
export async function getFirestoreAccessToken(
  serviceAccountJson: string,
): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const sa: ServiceAccount = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new jose.SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience(GOOGLE_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await jose.importPKCS8(sa.private_key, 'RS256'));

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token mint failed: ${res.status} ${body}`);
  }

  const { access_token } = (await res.json()) as { access_token: string };
  cachedToken = {
    token: access_token,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  return access_token;
}

/**
 * List all users with notifications effectively enabled.
 *
 * Signal: `expoPushToken != null`. The app only writes the token after
 * the user grants notification permission, and `notificationPrefs` is
 * written alongside it (with sensible defaults). So a non-null token
 * means "user opted in" — exactly the set we want to iterate.
 *
 * We can't filter on `expoPushToken != null` directly in Firestore's
 * REST query (no inequality-on-string + null-check), so we filter on
 * `notificationPrefs.dailyCheckIn == true` and post-filter for token
 * presence.
 *
 * In production, this should be paginated. For the MVP (under 1k users),
 * one page is fine.
 */
export async function listAllUsersWithNotifications(
  projectId: string,
  accessToken: string,
): Promise<Array<{ uid: string; settings: NotificationSettings }>> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'users' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'notificationPrefs.dailyCheckIn' },
            op: 'EQUAL',
            value: { booleanValue: true },
          },
        },
        limit: 1000,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Firestore list users failed: ${res.status} ${await res.text()}`);
  }

  const docs = (await res.json()) as Array<{
    document?: { name: string; fields: Record<string, unknown> };
  }>;

  return docs
    .filter(d => d.document)
    .map(d => {
      // Doc name: projects/{p}/databases/(default)/documents/users/{uid}
      const uid = d.document!.name.split('/').pop()!;
      const settings = parseUserDocForSettings(d.document!.fields);
      // Post-filter: skip users without a push token.
      if (!settings.expoPushToken) return null;
      return { uid, settings };
    })
    .filter((x): x is { uid: string; settings: NotificationSettings } => x !== null);
}

/**
 * Fetch one user's notification settings by reading the parent user doc
 * and mapping it to the Worker's NotificationSettings shape.
 */
export async function getNotificationSettings(
  projectId: string,
  uid: string,
  accessToken: string,
): Promise<NotificationSettings | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Firestore get user failed: ${res.status} ${await res.text()}`);
  }

  const doc = (await res.json()) as { fields?: Record<string, unknown> };
  if (!doc.fields) return null;
  return parseUserDocForSettings(doc.fields);
}

/**
 * Update the lastSentAt timestamp for one notification type on the
 * PARENT user doc. Uses a patch (POST with updateMask) to avoid
 * clobbering other fields.
 */
export async function markNotificationSent(
  projectId: string,
  uid: string,
  type: 'dailyCheckIn' | 'broken' | 'milestone' | 'welcomeBack',
  accessToken: string,
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=lastSentAt.${type}`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        lastSentAt: {
          mapValue: {
            fields: {
              [type]: { integerValue: String(Date.now()) },
            },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Firestore mark sent failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Append a milestone value to the celebrated array on the parent user
 * doc (idempotency for streak milestones — each value is sent exactly once).
 */
export async function recordMilestoneCelebrated(
  projectId: string,
  uid: string,
  milestone: number,
  accessToken: string,
): Promise<void> {
  // Read-modify-write. Under heavy contention, switch to
  // FieldValue.arrayUnion via a Cloud Function.
  const settings = await getNotificationSettings(projectId, uid, accessToken);
  if (!settings) return;

  if (settings.milestonesCelebrated.includes(milestone)) return;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=milestonesCelebrated`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        milestonesCelebrated: {
          arrayValue: {
            values: [...settings.milestonesCelebrated, milestone].map(n => ({
              integerValue: String(n),
            })),
          },
        },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Firestore record milestone failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Clear an invalid push token (called when Expo returns
 * DeviceNotRegistered). Prevents the Worker from retrying on every run.
 */
export async function clearPushToken(
  projectId: string,
  uid: string,
  accessToken: string,
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}?updateMask.fieldPaths=expoPushToken`;

  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: { expoPushToken: { nullValue: null } },
    }),
  });

  if (!res.ok) {
    throw new Error(`Firestore clear token failed: ${res.status} ${await res.text()}`);
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
//
// Firestore REST returns a deeply nested { stringValue, integerValue,
// booleanValue, mapValue, arrayValue, nullValue, timestampValue } envelope.
// These helpers flatten that into the TypeScript shape.

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { timestampValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values: FirestoreValue[] } };

function parseValue<T>(v: FirestoreValue | undefined, fallback: T): T {
  if (!v) return fallback;
  if ('stringValue' in v) return v.stringValue as unknown as T;
  if ('integerValue' in v) return Number(v.integerValue) as unknown as T;
  if ('booleanValue' in v) return v.booleanValue as unknown as T;
  if ('nullValue' in v) return null as unknown as T;
  if ('timestampValue' in v) return v.timestampValue as unknown as T;
  if ('mapValue' in v) return v.mapValue.fields as unknown as T;
  if ('arrayValue' in v) return v.arrayValue.values as unknown as T;
  return fallback;
}

function parseMap<T extends object>(v: FirestoreValue | undefined): T {
  if (!v || !('mapValue' in v)) return {} as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v.mapValue.fields)) {
    out[k] = parseValue(val, null);
  }
  return out as T;
}

function parseArray<T>(v: FirestoreValue | undefined, itemParse: (item: FirestoreValue) => T): T[] {
  if (!v || !('arrayValue' in v)) return [];
  return (v.arrayValue.values ?? []).map(itemParse);
}

/**
 * Map the live app's `users/{uid}` doc to the Worker's
 * NotificationSettings shape.
 *
 * App → Worker field mapping:
 *   user.expoPushToken          → settings.expoPushToken
 *   user.timezone               → settings.timezone
 *   user.streak                 → settings.streakCurrent
 *   user.lastSeenAt             → settings.lastSeenAt
 *   user.lastShippedAt (ms)     → settings.lastShipDate (YYYY-MM-DD, user-local)
 *   user.notificationPrefs.*    → settings.prefs.* + settings.checkInTime
 *   user.lastSentAt (Worker)    → settings.lastSentAt
 *   user.milestonesCelebrated   → settings.milestonesCelebrated
 */
function parseUserDocForSettings(
  fields: Record<string, unknown>,
): NotificationSettings {
  const f = fields as Record<string, FirestoreValue>;

  // notificationPrefs is a nested map; pull the bool toggles out of it.
  const prefsMap = parseMap<Record<string, FirestoreValue>>(
    f['notificationPrefs'] as FirestoreValue | undefined,
  );
  const prefs = {
    dailyCheckIn: parseValue<boolean>(prefsMap['dailyCheckIn'], true),
    streakMilestones: parseValue<boolean>(prefsMap['streakMilestones'], true),
    streakBroken: parseValue<boolean>(prefsMap['streakBroken'], true),
    welcomeBack: parseValue<boolean>(prefsMap['welcomeBack'], true),
    friendActivity: parseValue<boolean>(prefsMap['friendActivity'], false),
    lowNoiseMode: parseValue<boolean>(prefsMap['lowNoiseMode'], false),
  };

  // checkInTime lives in notificationPrefs (per the app's contract).
  // Default to 20:00 if missing.
  const checkInTime = parseValue<string>(prefsMap['checkInTime'] as FirestoreValue, '20:00');

  // Expo push token: app writes either a string or nullValue.
  const tokenField = f['expoPushToken'];
  const expoPushToken =
    tokenField && 'stringValue' in tokenField ? (tokenField.stringValue as string) : null;

  // Timezone: top-level on the user doc; fall back to the prefs value,
  // then UTC.
  const timezone = parseValue<string>(
    f['timezone'] as FirestoreValue,
    parseValue<string>(prefsMap['timezone'] as FirestoreValue, 'UTC'),
  );

  // Streak: top-level, default 0.
  const streakCurrent = parseValue<number>(f['streak'] as FirestoreValue, 0);

  // lastSeenAt: top-level, default 0.
  const lastSeenAt = parseValue<number>(f['lastSeenAt'] as FirestoreValue, 0);

  // lastShippedAt: top-level ms epoch. Convert to YYYY-MM-DD (user-local).
  const lastShippedMs = parseValue<number | null>(
    f['lastShippedAt'] as FirestoreValue,
    null,
  );
  let lastShipDate: string | null = null;
  if (lastShippedMs) {
    const d = new Date(lastShippedMs);
    // Use the user's timezone for the date string.
    lastShipDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d); // en-CA gives YYYY-MM-DD
  }

  // Worker-only state: lastSentAt (per-type timestamps).
  const lastSentAt = parseMap<NotificationSettings['lastSentAt']>(
    f['lastSentAt'] as FirestoreValue,
  );

  // Worker-only state: milestonesCelebrated (array of ints).
  const milestonesCelebrated = parseArray<number>(
    f['milestonesCelebrated'] as FirestoreValue,
    (item) => parseValue<number>(item, 0),
  );

  return {
    prefs,
    checkInTime,
    timezone,
    expoPushToken,
    lastSentAt,
    milestonesCelebrated,
    lastSeenAt,
    lastShipDate,
    streakCurrent,
  };
}

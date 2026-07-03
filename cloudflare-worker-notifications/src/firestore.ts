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
 * List all users with notification settings (i.e., anyone who has
 * saved prefs). Uses a structured query — we don't enumerate the
 * whole users collection, only those with the notifications sub-doc.
 *
 * In production, this should be paginated (Firestore REST returns
 * `nextPageToken`). For the MVP (under 1k users), we assume one page.
 */
export async function listAllUsersWithNotifications(
  projectId: string,
  accessToken: string,
): Promise<Array<{ uid: string; settings: NotificationSettings }>> {
  // Firestore structured query via REST:
  // POST /v1/projects/{project}/databases/(default)/documents:runQuery
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
            field: { fieldPath: 'notificationsEnabled' },
            op: 'EQUAL',
            value: { booleanValue: true },
          },
        },
        // Limit to a sane number; iterate via startAt if more.
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
      const settings = parseNotificationSettings(d.document!.fields);
      return { uid, settings };
    });
}

/**
 * Fetch one user's notification settings sub-doc.
 */
export async function getNotificationSettings(
  projectId: string,
  uid: string,
  accessToken: string,
): Promise<NotificationSettings | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/settings/notifications`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Firestore get settings failed: ${res.status} ${await res.text()}`);
  }

  const doc = (await res.json()) as { fields: Record<string, unknown> };
  return parseNotificationSettings(doc.fields);
}

/**
 * Update the lastSentAt timestamp for one notification type. Uses a
 * patch (POST with updateMask) to avoid clobbering other fields.
 */
export async function markNotificationSent(
  projectId: string,
  uid: string,
  type: 'dailyCheckIn' | 'broken' | 'milestone' | 'welcomeBack',
  accessToken: string,
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/settings/notifications?updateMask.fieldPaths=lastSentAt.${type}`;

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
 * Append a milestone value to the celebrated array (idempotency for
 * streak milestones — each value is sent exactly once).
 */
export async function recordMilestoneCelebrated(
  projectId: string,
  uid: string,
  milestone: number,
  accessToken: string,
): Promise<void> {
  // For MVP: read-modify-write. Under heavy contention, switch to
  // FieldValue.arrayUnion via a Cloud Function instead.
  const settings = await getNotificationSettings(projectId, uid, accessToken);
  if (!settings) return;

  if (settings.milestonesCelebrated.includes(milestone)) return;

  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/settings/notifications?updateMask.fieldPaths=milestonesCelebrated`;

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
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/settings/notifications?updateMask.fieldPaths=expoPushToken`;

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
// booleanValue, mapValue, arrayValue, nullValue } envelope. These helpers
// flatten that into the TypeScript shape.

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values: FirestoreValue[] } };

function parseValue<T>(v: FirestoreValue | undefined, fallback: T): T {
  if (!v) return fallback;
  if ('stringValue' in v) return v.stringValue as unknown as T;
  if ('integerValue' in v) return Number(v.integerValue) as unknown as T;
  if ('booleanValue' in v) return v.booleanValue as unknown as T;
  if ('nullValue' in v) return null as unknown as T;
  if ('mapValue' in v) return v.mapValue.fields as unknown as T;
  if ('arrayValue' in v) return v.arrayValue.values as unknown as T;
  return fallback;
}

function parseMap<T extends object>(
  v: FirestoreValue | undefined,
): T {
  if (!v || !('mapValue' in v)) return {} as T;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v.mapValue.fields)) {
    out[k] = parseValue(val, null);
  }
  return out as T;
}

function parseNotificationSettings(
  fields: Record<string, unknown>,
): NotificationSettings {
  const f = fields as Record<string, FirestoreValue>;
  return {
    prefs: parseMap<NotificationSettings['prefs']>(f['prefs']) as NotificationSettings['prefs'],
    checkInTime: parseValue(f['checkInTime'], '20:00'),
    timezone: parseValue(f['timezone'], 'UTC'),
    expoPushToken: parseValue<FirestoreValue | null>(f['expoPushToken'], null)
      ? parseValue<string>(f['expoPushToken'], '')
      : null,
    lastSentAt: parseMap<NotificationSettings['lastSentAt']>(f['lastSentAt']),
    milestonesCelebrated: parseValue<number[]>(f['milestonesCelebrated'], []),
    lastSeenAt: parseValue(f['lastSeenAt'], 0),
    lastShipDate: parseValue<FirestoreValue | null>(f['lastShipDate'], null)
      ? parseValue<string>(f['lastShipDate'], '')
      : null,
    streakCurrent: parseValue(f['streakCurrent'], 0),
  };
}

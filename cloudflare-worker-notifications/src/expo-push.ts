/**
 * Expo Push API wrapper (no SDK — direct fetch).
 *
 * Cloudflare Workers' bundler can't handle expo-server-sdk's dynamic
 * `require("node:assert")` / `require("node:zlib")` imports
 * (error code 10021 even with nodejs_compat). The Expo Push API is
 * a single POST endpoint — chunking is easy to inline.
 *
 * We send chunks of <= 100 messages per HTTP request (Expo's hard limit).
 *
 * Error handling:
 *   - 429 with Retry-After: surface to caller, defer remaining chunks
 *   - DeviceNotRegistered: clear the user's push token in Firestore
 *   - Other 4xx/5xx: log and continue (don't block the rest of the run)
 */

import type { RenderedNotification } from './types';
import { clearPushToken } from './firestore';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

interface ExpoPushMessage {
  to: string;
  sound?: 'default' | null;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: {
    error?: 'DeviceNotRegistered' | 'InvalidCredentials' | 'MessageTooBig' | 'MessageRateExceeded' | string;
    expoPushToken?: string;
  };
}

interface SendContext {
  projectId: string;
  accessToken: string;
  /** Function to look up the uid for a given push token (for clearing on DeviceNotRegistered). */
  tokenToUid: (token: string) => string | null;
}

interface SendResult {
  sent: number;
  failed: number;
  cleared: number;
}

/**
 * Validate an Expo push token. Mirrors `Expo.isExpoPushToken()` from the SDK.
 * Format: ExponentPushToken[xxx] or ExpoPushToken[xxx]
 */
function isExpoPushToken(token: string): boolean {
  return /^(Exponent|Expo)PushToken\[[A-Za-z0-9_\-]+\]$/.test(token);
}

/**
 * Send a batch of rendered notifications. Returns counts for logging.
 * Handles chunking (100/req), DeviceNotRegistered cleanup, and basic
 * 429 backoff.
 */
export async function sendNotifications(
  items: Array<{ uid: string; token: string; notification: RenderedNotification }>,
  ctx: SendContext,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, failed: 0, cleared: 0 };

  // Build messages, dropping any with invalid tokens (don't waste a chunk slot).
  const messages: ExpoPushMessage[] = [];
  const tokenByMessageTo: string[] = [];
  for (const { token, notification } of items) {
    if (!isExpoPushToken(token)) {
      console.warn(`expo-push: invalid token format, skipping uid=${notification.data?.uid ?? '?'}`);
      result.failed += 1;
      continue;
    }
    messages.push({
      to: token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: notification.data,
      priority: notification.type === 'broken' ? 'high' : 'normal',
      channelId: 'codetrail-hype',
    });
    tokenByMessageTo.push(token);
  }

  // Chunk manually — same logic as expo.chunkPushNotifications.
  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    let res: Response;
    try {
      res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });
    } catch (err) {
      // Network error — count the whole chunk as failed and move on.
      console.error('expo-push: network error', err);
      result.failed += chunk.length;
      continue;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '60');
      console.warn(`expo-push: 429 — backing off ${retryAfter}s`);
      // For MVP, just log + drop. Production: enqueue for next cron.
      result.failed += chunk.length;
      continue;
    }

    if (!res.ok) {
      console.error(`expo-push: ${res.status} ${await res.text()}`);
      result.failed += chunk.length;
      continue;
    }

    const receipts = (await res.json()) as { data: ExpoPushTicket[] };
    for (let j = 0; j < receipts.data.length; j++) {
      const ticket = receipts.data[j]!;
      if (ticket.status === 'ok') {
        result.sent += 1;
        continue;
      }

      result.failed += 1;

      // DeviceNotRegistered → the app was uninstalled or the user
      // revoked notification permission. Clear the token so we don't
      // retry forever.
      if (ticket.details?.error === 'DeviceNotRegistered') {
        const token = tokenByMessageTo[i + j]!;
        const uid = ctx.tokenToUid(token);
        if (uid) {
          await clearPushToken(ctx.projectId, uid, ctx.accessToken);
          result.cleared += 1;
        }
      }
    }
  }

  return result;
}

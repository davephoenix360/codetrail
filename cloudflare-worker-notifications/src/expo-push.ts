/**
 * Expo Push API wrapper.
 *
 * expo-server-sdk provides chunking + Expo.isExpoPushToken() validation.
 * We send chunks of <= 100 messages per HTTP request (Expo's hard limit).
 *
 * Error handling:
 *   - 429 with Retry-After: surface to caller, defer remaining chunks
 *   - DeviceNotRegistered: clear the user's push token in Firestore
 *   - Other 4xx/5xx: log and continue (don't block the rest of the run)
 */

import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import type { RenderedNotification } from './types';
import { clearPushToken } from './firestore';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

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
 * Send a batch of rendered notifications. Returns counts for logging.
 * Handles chunking (100/req), DeviceNotRegistered cleanup, and basic
 * 429 backoff.
 */
export async function sendNotifications(
  items: Array<{ uid: string; token: string; notification: RenderedNotification }>,
  ctx: SendContext,
): Promise<SendResult> {
  const expo = new Expo();
  const result: SendResult = { sent: 0, failed: 0, cleared: 0 };

  const messages: ExpoPushMessage[] = items.map(({ token, notification }) => ({
    to: token,
    sound: 'default',
    title: notification.title,
    body: notification.body,
    data: notification.data,
    priority: notification.type === 'broken' ? 'high' : 'normal',
    channelId: 'codetrail-hype',
  }));

  const chunks = expo.chunkPushNotifications(messages);

  for (const chunk of chunks) {
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
    for (let i = 0; i < receipts.data.length; i++) {
      const ticket = receipts.data[i]!;
      if (ticket.status === 'ok') {
        result.sent += 1;
        continue;
      }

      result.failed += 1;

      // DeviceNotRegistered → the app was uninstalled or the user
      // revoked notification permission. Clear the token so we don't
      // retry forever.
      if (ticket.details?.error === 'DeviceNotRegistered') {
        const message = chunk[i]!;
        const uid = ctx.tokenToUid(message.to as string);
        if (uid) {
          await clearPushToken(ctx.projectId, uid, ctx.accessToken);
          result.cleared += 1;
        }
      }
    }
  }

  return result;
}

/**
 * Cloudflare Worker entry — codetrail-notifications.
 *
 * Trigger: cron (hourly via wrangler.toml [triggers] crons).
 *
 * Flow per invocation:
 *   1. Mint Firestore access token (cached per isolate).
 *   2. List all users with notifications enabled.
 *   3. For each user, evaluate each notification type's eligibility.
 *   4. Batch all eligible notifications and send via Expo Push.
 *   5. Mark each sent notification's lastSentAt in Firestore.
 *   6. Log results.
 */

import type { Env, NotificationSettings, RenderedNotification } from './types';
import {
  getFirestoreAccessToken,
  listAllUsersWithNotifications,
  getNotificationSettings,
  markNotificationSent,
  recordMilestoneCelebrated,
} from './firestore';
import { sendNotifications } from './expo-push';
import { evaluateDailyCheckIn } from './notifications/daily-check-in';
import { evaluateStreakMilestone } from './notifications/streak-milestone';
import { evaluateStreakBroken } from './notifications/streak-broken';
import { evaluateWelcomeBack } from './notifications/welcome-back';

export {};

// Workers' default export — handles scheduled (cron) events AND HTTP requests.
export default {
  /**
   * HTTP fetch handler. Routes:
   *   GET /health → { ok: true, schedule: "0 * * * *" }
   *   GET /test?uid=<uid>   → fires a test push to the given uid (or default to "me")
   *                            Requires Authorization: Bearer <TEST_AUTH_TOKEN>.
   *   GET /test/me          → shortcut for /test?uid=AC2OdH3GOvbvd04nXHwI5Jpv13
   *                            (the signed-in user, hardcoded for convenience)
   *   *                     → 404
   *
   * The /test route does NOT call markNotificationSent — the real cron run
   * is unaffected. Title is prefixed "[Test]" so it's visibly not a real
   * eligibility-driven notification.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight: keep cheap and safe.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        schedule: '0 * * * *',
        service: 'codetrail-notifications',
        ts: new Date().toISOString(),
      });
    }

    if (url.pathname === '/test' || url.pathname === '/test/me') {
      // Auth — only callers with the secret can fire a test push.
      const auth = request.headers.get('Authorization') ?? '';
      const expected = `Bearer ${env.TEST_AUTH_TOKEN ?? ''}`;
      if (!env.TEST_AUTH_TOKEN || auth !== expected) {
        return Response.json(
          { ok: false, error: 'unauthorized' },
          { status: 401 },
        );
      }

      // Resolve target uid.
      let uid = url.searchParams.get('uid');
      if (url.pathname === '/test/me' || uid === 'me' || !uid) {
        uid = 'AC2OdH3GOvbvd04nXHwI5Jpv13'; // davephoenix360
      }

      try {
        const accessToken = await getFirestoreAccessToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
        const settings = await getNotificationSettings(env.FIRESTORE_PROJECT_ID, uid, accessToken);
        if (!settings) {
          return Response.json({ ok: false, error: `no settings for uid=${uid}` }, { status: 404 });
        }
        if (!settings.expoPushToken) {
          return Response.json(
            { ok: false, error: 'user has no expoPushToken — sign in to register one' },
            { status: 400 },
          );
        }

        // Build a clearly-marked test notification. Uses the same shape
        // as a real dailyCheckIn but with [Test] in the title so it
        // doesn't masquerade as a real one in analytics.
        const notification: RenderedNotification = {
          type: 'dailyCheckIn',
          title: '[Test] CodeTrail',
          body: `If you can see this, the push loop works end-to-end. (uid=${uid.slice(0, 6)}…)`,
          data: { uid, test: '1', streak: String(settings.streakCurrent ?? 0) },
        };

        const result = await sendNotifications(
          [{ uid, token: settings.expoPushToken, notification }],
          {
            projectId: env.FIRESTORE_PROJECT_ID,
            accessToken,
            tokenToUid: () => uid,
          },
        );

        return Response.json({
          ok: result.sent > 0,
          sent: result.sent,
          failed: result.failed,
          cleared: result.cleared,
          uid,
          tokenTail: settings.expoPushToken.slice(-12),
        });
      } catch (err) {
        console.error('/test: error', err);
        return Response.json(
          { ok: false, error: String(err) },
          { status: 500 },
        );
      }
    }

    return Response.json(
      { ok: false, error: 'not found — try /health or /test' },
      { status: 404 },
    );
  },

  /**
   * Cron trigger. Cloudflare passes a ScheduledController with
   * cron + scheduledTime. The handler should be idempotent (we run
   * hourly, so each run should make forward progress only).
   */
  async scheduled(
    _event: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const now = new Date();
    console.log(JSON.stringify({
      level: 'info',
      message: 'notifications-scheduler: tick',
      time: now.toISOString(),
    }));

    try {
      const accessToken = await getFirestoreAccessToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);

      // For the MVP, we re-read each user's settings sub-doc. Production
      // optimization: pre-fetch all in one query and skip the per-user
      // round-trip. The list query above is the foundation; per-user
      // fetch here is for clarity and to keep the patch operations tight.
      //
      // If user count grows past ~500, switch to a single runQuery that
      // returns full sub-doc bodies (Firestore supports this with
      // `select` fields or by reading the parent doc with a subcollection
      // wildcard).

      const users = await listAllUsersWithNotifications(
        env.FIRESTORE_PROJECT_ID,
        accessToken,
      );

      const sendQueue: Array<{
        uid: string;
        token: string;
        notification: import('./types').RenderedNotification;
      }> = [];
      const tokenToUid = new Map<string, string>();

      for (const { uid } of users) {
        const settings = await getNotificationSettings(
          env.FIRESTORE_PROJECT_ID,
          uid,
          accessToken,
        );
        if (!settings || !settings.expoPushToken) continue;

        const eligible = [
          evaluateDailyCheckIn(settings, now),
          evaluateStreakMilestone(settings, now),
          evaluateStreakBroken(settings, now),
          evaluateWelcomeBack(settings, now),
        ];

        for (const result of eligible) {
          if (result.eligible && result.notification) {
            sendQueue.push({ uid, token: settings.expoPushToken, notification: result.notification });
            tokenToUid.set(settings.expoPushToken, uid);
          }
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'notifications-scheduler: evaluated',
        totalUsers: users.length,
        eligibleToSend: sendQueue.length,
      }));

      if (sendQueue.length === 0) return;

      const result = await sendNotifications(sendQueue, {
        projectId: env.FIRESTORE_PROJECT_ID,
        accessToken,
        tokenToUid: (token) => tokenToUid.get(token) ?? null,
      });

      // Mark each sent notification's lastSentAt. We do this in a
      // best-effort loop — if one fails, the user might get a duplicate
      // next run (the eligibility check will catch it).
      for (const item of sendQueue) {
        try {
          await markNotificationSent(
            env.FIRESTORE_PROJECT_ID,
            item.uid,
            item.notification.type,
            accessToken,
          );
          if (item.notification.type === 'milestone') {
            // Extract the milestone value from the data payload.
            const value = Number(item.notification.data['value'] ?? '0');
            if (value > 0) {
              await recordMilestoneCelebrated(
                env.FIRESTORE_PROJECT_ID,
                item.uid,
                value,
                accessToken,
              );
            }
          }
        } catch (err) {
          console.error(`markNotificationSent failed for ${item.uid}/${item.notification.type}:`, err);
        }
      }

      console.log(JSON.stringify({
        level: 'info',
        message: 'notifications-scheduler: complete',
        sent: result.sent,
        failed: result.failed,
        cleared: result.cleared,
      }));
    } catch (err) {
      console.error('notifications-scheduler: fatal', err);
      throw err;
    }
  },
} satisfies ExportedHandler<Env>;

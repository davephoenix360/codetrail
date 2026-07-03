/**
 * Welcome back — fires for users who haven't opened the app in 7+ days.
 * Re-engagement nudge.
 *
 * Idempotency: skip if we sent welcome-back in the last 30 days.
 */

import type { EligibilityResult, NotificationSettings } from '../types';
import { welcomeBackCopy } from '../copy';
import { localHour, daysSince } from '../time';

const DORMANT_THRESHOLD_DAYS = 7;
const RESEND_COOLDOWN_DAYS = 30;

export function evaluateWelcomeBack(
  user: NotificationSettings,
  now: Date,
): EligibilityResult {
  if (!user.prefs.welcomeBack) {
    return { eligible: false, reason: 'welcomeBack disabled' };
  }
  if (!user.expoPushToken) {
    return { eligible: false, reason: 'no push token' };
  }
  // Welcome back fires even in lowNoiseMode — it's the one anti-dormant nudge.

  const daysSinceSeen = daysSince(user.lastSeenAt, now);
  if (daysSinceSeen < DORMANT_THRESHOLD_DAYS) {
    return { eligible: false, reason: `seen ${daysSinceSeen}d ago (threshold ${DORMANT_THRESHOLD_DAYS}d)` };
  }

  if (user.lastSentAt.welcomeBack) {
    const daysSinceWelcome = daysSince(user.lastSentAt.welcomeBack, now);
    if (daysSinceWelcome < RESEND_COOLDOWN_DAYS) {
      return { eligible: false, reason: `welcome-back sent ${daysSinceWelcome}d ago (cooldown ${RESEND_COOLDOWN_DAYS}d)` };
    }
  }

  // Send any hour — the user is dormant, so any wake-up is fine.
  // (Evening is still preferable; we just don't gate on it.)
  const hour = localHour(now, user.timezone);
  if (hour < 9 || hour > 21) {
    return { eligible: false, reason: 'outside 9-21 quiet hours' };
  }

  return {
    eligible: true,
    notification: welcomeBackCopy(daysSinceSeen),
  };
}

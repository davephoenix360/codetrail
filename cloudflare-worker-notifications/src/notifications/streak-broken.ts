/**
 * Streak broken — fires when a user had a streak > 0 yesterday but
 * has no commit today (i.e., their streak just ended).
 *
 * Idempotency: skip if we already sent a "broken" notification in the
 * last 24h (the user's profile may say streakCurrent=0 for multiple
 * days, but we only want to message them once per broken streak).
 *
 * Timing: fires at the user's checkInTime. Better: morning (10am local)
 * so they have all day to recover. Open question in design doc.
 */

import type { EligibilityResult, NotificationSettings } from '../types';
import { streakBrokenCopy } from '../copy';
import { localDateString, localHour, daysBetween } from '../time';

export function evaluateStreakBroken(
  user: NotificationSettings,
  now: Date,
): EligibilityResult {
  if (!user.prefs.streakBroken) {
    return { eligible: false, reason: 'streakBroken disabled' };
  }
  if (!user.expoPushToken) {
    return { eligible: false, reason: 'no push token' };
  }

  // No streak to break.
  if (user.streakCurrent > 0 || !user.lastShipDate) {
    return { eligible: false, reason: 'streak still alive or no prior ship' };
  }

  // Was there a streak yesterday? i.e., lastShipDate was 1-2 days ago
  // (we may have run late, so allow 2 days of slop).
  const daysSinceLastShip = daysBetween(user.lastShipDate, now, user.timezone);
  if (daysSinceLastShip < 1 || daysSinceLastShip > 2) {
    return { eligible: false, reason: `lastShipDate was ${daysSinceLastShip}d ago` };
  }

  // Only send once per 24h.
  if (user.lastSentAt.broken) {
    const hoursSince = (Date.now() - user.lastSentAt.broken) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      return { eligible: false, reason: 'sent within last 24h' };
    }
  }

  // Fire at the user's checkInTime.
  const targetHour = parseInt(user.checkInTime.split(':')[0] ?? '20', 10);
  if (localHour(now, user.timezone) !== targetHour) {
    return { eligible: false, reason: 'outside checkInTime window' };
  }

  // Reconstruct broken streak length from lastShipDate — we don't have
  // the value directly, but we know the user *had* a streak > 0
  // yesterday. Conservative estimate: 1 (could be improved later).
  return {
    eligible: true,
    notification: streakBrokenCopy(Math.max(user.streakCurrent, 1)),
  };
}

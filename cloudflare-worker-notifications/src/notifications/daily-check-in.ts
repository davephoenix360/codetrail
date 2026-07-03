/**
 * Daily check-in notification — fires at the user's local checkInTime
 * (default 20:00) once per user-local day.
 *
 * Idempotency: skip if we already sent today in the user's timezone.
 */

import type { EligibilityResult, NotificationSettings } from '../types';
import { dailyCheckInCopy } from '../copy';
import { localDateString, localHour } from '../time';

export function evaluateDailyCheckIn(
  user: NotificationSettings,
  now: Date,
): EligibilityResult {
  if (!user.prefs.dailyCheckIn) {
    return { eligible: false, reason: 'dailyCheckIn disabled' };
  }
  if (!user.expoPushToken) {
    return { eligible: false, reason: 'no push token' };
  }
  if (user.prefs.lowNoiseMode) {
    return { eligible: false, reason: 'lowNoiseMode' };
  }

  const targetHour = parseInt(user.checkInTime.split(':')[0] ?? '20', 10);
  const targetMinute = parseInt(user.checkInTime.split(':')[1] ?? '00', 10);
  const currentHour = localHour(now, user.timezone);
  const currentMinute = now.getUTCMinutes(); // Close enough; cron is hourly.

  // Within a 60-min window starting at checkInTime. If cron runs at :00
  // UTC and user's local is 20:00, this matches. If user's local is
  // 20:30 by the time the cron lands, we miss — accept that 1/60 miss
  // rate for the MVP.
  if (currentHour !== targetHour) {
    return { eligible: false, reason: `outside checkInTime window (${currentHour}:${currentMinute})` };
  }

  // Idempotency: skip if we already sent today in the user's timezone.
  const today = localDateString(now, user.timezone);
  if (user.lastSentAt.dailyCheckIn) {
    const lastSentDay = localDateString(
      new Date(user.lastSentAt.dailyCheckIn),
      user.timezone,
    );
    if (lastSentDay === today) {
      return { eligible: false, reason: 'already sent today' };
    }
  }

  return {
    eligible: true,
    notification: dailyCheckInCopy(user.streakCurrent),
  };
}

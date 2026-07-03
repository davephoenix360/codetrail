/**
 * Streak milestone — fires when the user's streak hits one of
 * {7, 14, 30, 60, 100, 365} for the first time. Idempotent via the
 * `milestonesCelebrated[]` array.
 *
 * Open question: should we run this in the morning (so the user has
 * all day to feel good about it) or at check-in time? Currently uses
 * check-in time, but morning might be better — flagged in design doc.
 */

import type { EligibilityResult, NotificationSettings } from '../types';
import { streakMilestoneCopy } from '../copy';
import { localHour } from '../time';

const MILESTONES = [7, 14, 30, 60, 100, 365] as const;

export function evaluateStreakMilestone(
  user: NotificationSettings,
  now: Date,
): EligibilityResult {
  if (!user.prefs.streakMilestones) {
    return { eligible: false, reason: 'streakMilestones disabled' };
  }
  if (!user.expoPushToken) {
    return { eligible: false, reason: 'no push token' };
  }
  if (user.prefs.lowNoiseMode) {
    return { eligible: false, reason: 'lowNoiseMode' };
  }

  // Find the highest unreached milestone the user is at or past.
  const target = MILESTONES.find(
    (m) => user.streakCurrent >= m && !user.milestonesCelebrated.includes(m),
  );
  if (!target) {
    return { eligible: false, reason: 'no unreached milestone' };
  }

  // Only send at the user's checkInTime — avoids waking them up at 3am.
  const targetHour = parseInt(user.checkInTime.split(':')[0] ?? '20', 10);
  if (localHour(now, user.timezone) !== targetHour) {
    return { eligible: false, reason: 'outside checkInTime window' };
  }

  return {
    eligible: true,
    notification: streakMilestoneCopy(target),
  };
}

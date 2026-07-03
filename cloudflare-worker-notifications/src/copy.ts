/**
 * Hype-man copy variants.
 *
 * Each notification type has 3 variants for now (A/B/C). Pick one
 * randomly per send. After ~1k sends/type with receipts analyzed,
 * pick the winner and pare down to 1-2 variants.
 *
 * Tone: short, direct, second-person. No "Hello {name}," openers.
 * No exclamation points in body (one in title is fine).
 */

import type { RenderedNotification } from './types';

/** Random pick from an array. */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function dailyCheckInCopy(streak: number): RenderedNotification {
  return {
    type: 'dailyCheckIn',
    title: 'CodeTrail',
    body: pick([
      `🔥 ${streak} day streak. What's today's build?`,
      'Keep the flame alive — one commit counts.',
      `You're ${streak} for ${streak}. Don't break the chain.`,
    ]),
    data: { type: 'dailyCheckIn', deepLink: 'codetrail://repos' },
  };
}

export function streakMilestoneCopy(streak: number): RenderedNotification {
  const messages: Record<number, string[]> = {
    7: [
      '7 days straight. You\'re not just shipping — you\'re building a habit.',
      'One week. Most people don\'t make it past day 3. You just did.',
      '7 days. The compound interest of showing up.',
    ],
    14: [
      'Two weeks. The streak isn\'t the goal — the consistency is.',
      '14 days. You\'ve passed the "novelty" phase. This is the real work.',
    ],
    30: [
      '🔥 30 days. One full month of shipping. Most people dream about this.',
      'A month straight. Whatever you\'re building, it\'s no longer an idea.',
    ],
    60: [
      '60 days. You\'ve built the kind of discipline most engineers never find.',
    ],
    100: [
      '💯 100 days. Triple digits. This isn\'t a streak anymore — it\'s a system.',
      '100 days. You\'ve shipped more in 14 weeks than most people do in a year.',
    ],
    365: [
      '🔥🔥🔥 365 days. One year. You\'re in the top 1% of builders.',
    ],
  };

  const variants = messages[streak] ?? [
    `${streak} days. Numbers like this aren't luck — they're discipline.`,
  ];

  return {
    type: 'milestone',
    title: 'Milestone unlocked',
    body: pick(variants),
    data: { type: 'milestone', value: String(streak), deepLink: 'codetrail://repos' },
  };
}

export function streakBrokenCopy(brokenLength: number): RenderedNotification {
  return {
    type: 'broken',
    title: 'Streak broken',
    body: pick([
      'Your streak went dark yesterday. Get back on the horse — one commit counts.',
      `${brokenLength}-day streak is gone. Start a new one today.`,
      'Streaks end. Builders don\'t. Ship something — even small.',
    ]),
    data: { type: 'broken', brokenLength: String(brokenLength), deepLink: 'codetrail://repos' },
  };
}

export function welcomeBackCopy(daysSince: number): RenderedNotification {
  return {
    type: 'welcomeBack',
    title: 'Welcome back',
    body: pick([
      'Hey, you drifted away. The flame\'s still here whenever you\'re ready.',
      `${daysSince} days. Welcome back. No judgment — let's ship something.`,
      'Missed you. The bar\'s set low: one commit.',
    ]),
    data: { type: 'welcomeBack', daysSince: String(daysSince), deepLink: 'codetrail://repos' },
  };
}

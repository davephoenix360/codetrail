/**
 * Streak and weekly commit aggregation.
 *
 * Pulls the last N days of commits from each tracked repo, filters by
 * the user's GitHub login, and aggregates them by LOCAL date (using
 * the device's timezone — so "today" is the user's calendar day, not
 * UTC midnight). The aggregation produces:
 *
 *   - `streak`: consecutive days back from today (or yesterday if today
 *     is empty) that have at least 1 commit to ANY tracked repo.
 *   - `weekly`: array of 7 entries (today and the 6 days before), with
 *     `date` and `count` for each day. Used by the chart on /repos.
 *   - `byDate`: map of "YYYY-MM-DD" → count, for the full window.
 *   - `totalCommits`: sum across the window.
 *
 * The streak rule: any commit to any tracked repo on a given day counts.
 * We don't care WHICH repo; we care that the user shipped something.
 *
 * Why device-local time: the user's "day" is the calendar day they live
 * in. If they're in Edmonton and they commit at 11pm, that's "today" in
 * their world. UTC would push it to "tomorrow" for them, which feels
 * wrong and would break the streak at midnight UTC.
 */
import { getRepoCommits, GitHubApiError } from './github-api';
import type { TrackedRepo } from './firebase-repos';

export interface DailyCommitCount {
  /** ISO date (YYYY-MM-DD) in the user's local timezone. */
  date: string;
  /** How many commits on that day across all tracked repos. */
  count: number;
}

export interface StreakResult {
  /** Consecutive days with ≥1 commit, ending at the most recent ship day
   *  (which may be today, or up to STREAK_GRACE_DAYS ago). */
  streak: number;
  /** True if the user has shipped at least once today (local time). */
  shippedToday: boolean;
  /** Last 7 days, oldest first → today. Length 7 always. */
  weekly: DailyCommitCount[];
  /** Sum of all commits in the window. */
  totalCommits: number;
  /** When this was computed (ms epoch). Lets the UI show "updated 2m ago". */
  generatedAt: number;
  /** Number of repos we successfully fetched commits from. */
  reposScanned: number;
  /** Repos that failed (e.g., private, deleted, rate-limited). Surfaces in the UI. */
  reposFailed: string[];
  /** YYYY-MM-DD of the most recent ship day in the full window, or null if no commits. */
  lastShipped: string | null;
  /** Days between today and the last ship day. 0 = shipped today, 1 = yesterday, etc. */
  daysSinceLastShip: number | null;
  /** True when streak=0 but there's recent weekly activity — the "forgot to push?" hint. */
  forgotToPushHint: boolean;
}

/**
 * Return the local-date key (YYYY-MM-DD) for a given timestamp.
 * Uses the device's timezone.
 */
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']; // Sunday=0, per JS Date.getDay()

/**
 * Number of days the streak survives without a new ship. With grace=2:
 *   - Last ship today    → streak alive (0 grace used)
 *   - Last ship 1 day ago → streak alive (1 grace used)
 *   - Last ship 2 days ago → streak alive (2 grace used, limit)
 *   - Last ship 3+ days ago → streak broken (over the limit)
 *
 * 2 was chosen as a balance: forgiving enough that one missed day
 * (sick, busy, weekend) doesn't kill the run, strict enough that a
 * week-long break does. v2.0 could make this configurable.
 */
export const STREAK_GRACE_DAYS = 2;

function localDateKey(isoString: string, timeZone: string): string {
  // Intl.DateTimeFormat is the most reliable way to extract YYYY-MM-DD
  // in a specific timezone. `en-CA` gives us ISO order.
  const date = new Date(isoString);
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(date);
}

/**
 * Return today's local-date key (YYYY-MM-DD) in the given timezone.
 */
function todayKey(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date());
}

/**
 * Add `days` to a YYYY-MM-DD string and return the new YYYY-MM-DD.
 * Uses noon to avoid DST edge cases.
 */
function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  // Use UTC noon to avoid DST shifts when crossing midnight in local TZ
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export interface LoadStreakOptions {
  /** Number of days to look back. Default 30 (covers a month of streak history). */
  days?: number;
  /** IANA timezone, e.g. "America/Edmonton". Default = device. */
  timeZone?: string;
  /** AbortSignal — caller can cancel mid-flight (e.g., on unmount). */
  signal?: AbortSignal;
}

/**
 * Fetch and aggregate the user's commit activity.
 *
 * For each tracked repo, calls GitHub's commits API in parallel.
 * Aggregates by local date across all repos. Computes streak + weekly.
 *
 * Failures for individual repos don't fail the whole load — we record
 * the failed repo names in `reposFailed` and continue. This way, a
 * deleted or private repo doesn't blank out the whole dashboard.
 */
export async function loadStreak(
  accessToken: string,
  authorLogin: string,
  trackedRepos: TrackedRepo[],
  options: LoadStreakOptions = {},
): Promise<StreakResult> {
  const days = options.days ?? 30;
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // The `since` param for GitHub is exclusive. We pass an ISO string
  // for `days` ago at midnight in the user's local timezone, converted
  // to UTC. So the window covers exactly `days` local calendar days.
  const todayK = todayKey(timeZone);
  const sinceK = addDays(todayK, -days);
  // We pick noon UTC on the day-before-the-window to be safe with DST
  const [y, m, d] = sinceK.split('-').map(Number);
  const sinceIso = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0)).toISOString();

  // Fetch all repos' commits in parallel. Use Promise.allSettled so a
  // single failure (e.g., a repo was deleted) doesn't kill the others.
  const results = await Promise.allSettled(
    trackedRepos.map(async (repo) => {
      if (options.signal?.aborted) {
        throw new Error('aborted');
      }
      const [owner, name] = repo.repoFullName.split('/');
      if (!owner || !name) {
        throw new Error(`Malformed repoFullName: ${repo.repoFullName}`);
      }
      const commits = await getRepoCommits(accessToken, owner, name, authorLogin, sinceIso);
      return { repo, commits };
    }),
  );

  // Aggregate by local date
  const byDate = new Map<string, number>();
  const reposFailed: string[] = [];
  let reposScanned = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      // Pick the first failed repo (we don't know which one — but the
      // caller can use reposFailed to surface a hint)
      const idx = results.indexOf(result);
      const repo = trackedRepos[idx];
      if (repo) reposFailed.push(repo.repoFullName);
      if (__DEV__) {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
        if (reason !== 'aborted') {
          console.warn(`[streak] failed to load commits for ${repo?.repoFullName ?? '?'}:`, reason);
        }
      }
      continue;
    }
    reposScanned++;
    for (const c of result.value.commits) {
      const key = localDateKey(c.date, timeZone);
      byDate.set(key, (byDate.get(key) ?? 0) + 1);
    }
  }

  // Compute streak with a grace period (STREAK_GRACE_DAYS).
  //
  // Algorithm:
  //   1. Walk back from today up to STREAK_GRACE_DAYS + 1 days looking for
  //      a ship day. If we find one within the grace window, that's our
  //      "anchor" — the streak end. If not, the streak is dead (0).
  //   2. From the anchor, walk back while commits > 0, counting the
  //      streak. (No grace within the streak itself — once you start a
  //      run, every day must have a ship.)
  let lastShipDay: string | null = null;
  for (let i = 0; i <= STREAK_GRACE_DAYS; i++) {
    const day = addDays(todayK, -i);
    if ((byDate.get(day) ?? 0) > 0) {
      lastShipDay = day;
      break;
    }
  }

  let streak = 0;
  if (lastShipDay !== null) {
    let cursor = lastShipDay;
    while ((byDate.get(cursor) ?? 0) > 0) {
      streak++;
      cursor = addDays(cursor, -1);
    }
  }

  const shippedToday = (byDate.get(todayK) ?? 0) > 0;

  // Find the most recent ship day in the FULL window (not just the grace
  // window), so we can show "last shipped N days ago" even when the streak
  // is broken. Search up to 365 days back.
  let lastShipped: string | null = null;
  if (lastShipDay !== null) {
    lastShipped = lastShipDay;
  } else {
    // Streak is dead. Find the most recent day with commits anywhere in
    // the window. Walk back from today.
    let probe = todayK;
    for (let i = 0; i < 365; i++) {
      if ((byDate.get(probe) ?? 0) > 0) {
        lastShipped = probe;
        break;
      }
      probe = addDays(probe, -1);
    }
  }

  let daysSinceLastShip: number | null = null;
  if (lastShipped !== null) {
    let count = 0;
    let walker = lastShipped;
    while (walker !== todayK) {
      walker = addDays(walker, 1);
      count++;
    }
    daysSinceLastShip = count;
  }

  // Compute weekly: 7 days ending today, oldest first
  const weekly: DailyCommitCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(todayK, -i);
    weekly.push({ date: key, count: byDate.get(key) ?? 0 });
  }

  const totalCommits = Array.from(byDate.values()).reduce((a, b) => a + b, 0);

  // "Forgot to push?" hint: triggered when the user has NO active streak
  // (last ship > STREAK_GRACE_DAYS ago, OR never) BUT the weekly chart
  // shows recent activity. This catches the "I committed locally but
  // forgot to push" case — they have evidence of activity but the streak
  // is broken. v1.1 nudge; never accusatory.
  const weeklyHasActivity = weekly.some((d) => d.count > 0);
  const forgotToPushHint =
    streak === 0 &&
    weeklyHasActivity &&
    daysSinceLastShip !== null &&
    daysSinceLastShip >= 1;

  // Dev log: print the byDate map and the streak so we can diagnose
  // "why is my streak 0?" reports in the future.
  if (__DEV__) {
    console.log('[streak] byDate:', Object.fromEntries(byDate));
    console.log(
      '[streak] todayK:',
      todayK,
      'lastShipped:',
      lastShipped,
      'streak:',
      streak,
      'shippedToday:',
      shippedToday,
      'graceDays:',
      STREAK_GRACE_DAYS,
    );
    console.log('[streak] forgotToPushHint:', forgotToPushHint);
  }

  return {
    streak,
    shippedToday,
    weekly,
    totalCommits,
    generatedAt: Date.now(),
    reposScanned,
    reposFailed,
    lastShipped,
    daysSinceLastShip,
    forgotToPushHint,
  };
}

/**
 * Format the primary streak line. Returns the main heading copy.
 * Examples:
 *   formatStreakLine(7, true)  → "🔥 7-day streak"
 *   formatStreakLine(1, false) → "🔥 1-day streak"
 *   formatStreakLine(0, false, 1) → "🔥 0 — last shipped yesterday"
 *   formatStreakLine(0, false, 5) → "🔥 0 — last shipped 5 days ago"
 *   formatStreakLine(0, false, null) → "🔥 0 — start your streak"
 */
export function formatStreakLine(
  streak: number,
  shippedToday: boolean,
  daysSinceLastShip: number | null = null,
): string {
  if (streak >= 1) {
    return `🔥 ${streak}-day streak`;
  }
  // streak === 0
  if (daysSinceLastShip === null) {
    return "🔥 0 — start your streak";
  }
  if (daysSinceLastShip === 0) {
    // shippedToday is false but daysSinceLastShip is 0 — should be impossible
    return "🔥 0 — start your streak";
  }
  if (daysSinceLastShip === 1) {
    return "🔥 0 — last shipped yesterday";
  }
  return `🔥 0 — last shipped ${daysSinceLastShip} days ago`;
}

/**
 * Format the secondary line (call-to-action under the streak).
 *
 * If the `forgotToPush` flag is set, we use the friendly nudge copy.
 * Otherwise the standard subline based on streak state.
 */
export function formatStreakSubline(
  streak: number,
  shippedToday: boolean,
  forgotToPush: boolean = false,
): string {
  if (forgotToPush) {
    return "Did you forget to push? 🫠  We count ships when they hit GitHub.";
  }
  if (streak >= 1 && shippedToday) return "You shipped today. Keep the run alive.";
  if (streak >= 1 && !shippedToday) return "Ship something today to keep the streak alive.";
  return "Even a README counts.";
}

/**
 * Format the weekly commits line.
 */
export function formatWeeklyLine(totalThisWeek: number): string {
  if (totalThisWeek === 0) {
    return "No commits this week — yet.";
  }
  if (totalThisWeek === 1) {
    return "1 commit this week. That's a start.";
  }
  if (totalThisWeek < 5) {
    return `${totalThisWeek} commits this week. Momentum.`;
  }
  return `${totalThisWeek} commits this week. You're on fire.`;
}

/**
 * Build a share-friendly message for the system share sheet.
 *
 * Hype-man voice. Hints at the streak number, doesn't brag. Ends with
 * a soft CTA so the recipient knows what the link is about.
 *
 * Examples:
 *   formatShareMessage({streak: 7, shippedToday: true, ...}, 'davephoenix360')
 *     → "🔥 7-day streak on @CodeTrail — davephoenix360 is on fire this week.\n\nTracking what I ship. Try it: https://codetrail.app"
 *   formatShareMessage({streak: 0, shippedToday: false, ...}, 'davephoenix360')
 *     → "Back at it on @CodeTrail — davephoenix360's streak resets today.\n\nThe streak's not going to build itself."
 */
export function formatShareMessage(
  result: StreakResult,
  login: string,
): string {
  // Plain handle, no @ — the message already says "@CodeTrail" so a second
  // @ before the handle reads cluttered. The function takes a bare login
  // (e.g. "davephoenix360") and strips a leading @ if the caller passed one.
  const handle = login.startsWith('@') ? login.slice(1) : login;
  const totalThisWeek = result.weekly.reduce((sum, d) => sum + d.count, 0);

  let line: string;
  if (result.streak >= 7) {
    line = `${result.streak}-day streak on @CodeTrail — ${handle} is on fire this week.`;
  } else if (result.streak >= 3) {
    line = `${result.streak}-day streak on @CodeTrail — ${handle} is showing up.`;
  } else if (result.streak >= 1) {
    line = `${result.streak}-day streak on @CodeTrail — ${handle}'s keeping it going.`;
  } else if (result.forgotToPushHint) {
    line = `Back at it on @CodeTrail — ${handle}'s streak needs a push. 🫠`;
  } else {
    line = `Back at it on @CodeTrail — ${handle}'s streak resets today.`;
  }

  // Two-line message: hype line + soft CTA. The CTA is what gets the
  // recipient to actually open the link.
  return `${line}\n\nTracking what I ship. Try it: https://codetrail.app`;
}

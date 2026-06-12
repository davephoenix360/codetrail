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
  /** Consecutive days with ≥1 commit, counting back from today (or yesterday). */
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
}

/**
 * Return the local-date key (YYYY-MM-DD) for a given timestamp.
 * Uses the device's timezone.
 */
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

  // Compute streak: walk back from today (or yesterday if today is empty)
  let streak = 0;
  let shippedToday = (byDate.get(todayK) ?? 0) > 0;
  let cursor = shippedToday ? todayK : addDays(todayK, -1);
  while ((byDate.get(cursor) ?? 0) > 0) {
    streak++;
    cursor = addDays(cursor, -1);
  }

  // Compute weekly: 7 days ending today, oldest first
  const weekly: DailyCommitCount[] = [];
  for (let i = 6; i >= 0; i--) {
    const key = addDays(todayK, -i);
    weekly.push({ date: key, count: byDate.get(key) ?? 0 });
  }

  const totalCommits = Array.from(byDate.values()).reduce((a, b) => a + b, 0);

  return {
    streak,
    shippedToday,
    weekly,
    totalCommits,
    generatedAt: Date.now(),
    reposScanned,
    reposFailed,
  };
}

/**
 * Format the streak number for display. We use the 🔥 emoji + a number
 * for streaks ≥ 1, and a different vibe for 0.
 */
export function formatStreakLine(streak: number, shippedToday: boolean): string {
  if (streak === 0) {
    return "Start your streak today.";
  }
  if (shippedToday) {
    return `🔥 ${streak}-day streak — You shipped.`;
  }
  return `🔥 ${streak}-day streak — Ship something to keep it alive.`;
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

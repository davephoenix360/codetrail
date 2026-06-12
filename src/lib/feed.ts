/**
 * Feed formatting helpers.
 *
 * Pure functions that turn a FeedEntry into hype-man copy. No side
 * effects, no React — easy to test in isolation.
 *
 * Voice rules (from BRIEF.md):
 *  - No "you failed / missed / lost" language
 *  - No "they shipped 3x more" comparisons
 *  - No exclamation points (let the user's own data speak)
 *  - Aggregate progress is fine
 *  - Hype, never shame
 */
import type { FeedEntry } from './github-api';

/**
 * Format a feed entry into the main "what they did" line.
 *
 * Tiers:
 *  - 1 commit:  "@login pushed 1 commit to owner/repo."
 *  - 2-4 total: "@login shipped N commits to owner/repo."
 *  - 5+ total:  "@login shipped N commits to owner/repo. Big day."
 *  - "more" copy: if they shipped to multiple repos, append a separate
 *    "+ N more in other repos." sentence so the user knows there's
 *    more to see.
 */
export function formatFeedLine(entry: FeedEntry): string {
  const handle = `@${entry.friend.login}`;
  const repo = entry.repo.fullName;
  const total = entry.repo.totalCommits;
  const inBusiest = entry.repo.commitCount;
  const moreCount = total - inBusiest;

  let main: string;
  if (total === 1) {
    main = `${handle} pushed 1 commit to ${repo}.`;
  } else if (total <= 4) {
    main = `${handle} shipped ${total} commits to ${repo}.`;
  } else {
    main = `${handle} shipped ${total} commits to ${repo}. Big day.`;
  }

  if (moreCount > 0) {
    return `${main} +${moreCount} more in other repos.`;
  }
  return main;
}

/**
 * "2h ago" / "5h ago" / "yesterday" / "3d ago" / "1w ago".
 *
 * `now` defaults to the current time; pass an explicit value in tests.
 * `entryDate` is the entry's date (YYYY-MM-DD, UTC). For "today" /
 * "yesterday" we compare the UTC day. For older we count days.
 */
export function timeAgo(entryDate: string, now: Date = new Date()): string {
  // entryDate is YYYY-MM-DD. Parse as UTC midnight.
  const entry = new Date(`${entryDate}T00:00:00Z`);
  if (Number.isNaN(entry.getTime())) return entryDate;

  // Same UTC day?
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const entryDay = Date.UTC(entry.getUTCFullYear(), entry.getUTCMonth(), entry.getUTCDate());
  const daysAgo = Math.round((nowDay - entryDay) / (24 * 60 * 60 * 1000));

  if (daysAgo === 0) return 'today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo < 7) return `${daysAgo}d ago`;
  if (daysAgo < 14) return '1w ago';
  if (daysAgo < 30) return `${Math.floor(daysAgo / 7)}w ago`;
  return `${Math.floor(daysAgo / 30)}mo ago`;
}

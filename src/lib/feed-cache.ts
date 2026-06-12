/**
 * Feed cache (AsyncStorage).
 *
 * Stores the last fetched feed per uid, with a `fetchedAt` timestamp
 * so the UI can decide whether to show "stale" copy or trigger a
 * background refresh. Stale-after: 1 hour for MVP.
 *
 * We do NOT cache the access token in the feed payload (it shouldn't
 * be there). The cache is just the rendered entries.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { FeedResponse } from './github-api';

const STORAGE_PREFIX = '@codetrail:feed:';
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour

interface CachedFeed {
  fetchedAt: string; // ISO
  response: FeedResponse;
}

function key(uid: string): string {
  return `${STORAGE_PREFIX}${uid}`;
}

export async function getCachedFeed(uid: string): Promise<CachedFeed | null> {
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    if (!raw) return null;
    return JSON.parse(raw) as CachedFeed;
  } catch (e) {
    if (__DEV__) console.warn('[feed-cache] getCachedFeed failed:', e);
    return null;
  }
}

export async function setCachedFeed(uid: string, response: FeedResponse): Promise<void> {
  try {
    const value: CachedFeed = { fetchedAt: response.fetchedAt, response };
    await AsyncStorage.setItem(key(uid), JSON.stringify(value));
  } catch (e) {
    if (__DEV__) console.warn('[feed-cache] setCachedFeed failed:', e);
  }
}

export function isStale(cached: CachedFeed, now: Date = new Date()): boolean {
  return now.getTime() - new Date(cached.fetchedAt).getTime() > STALE_AFTER_MS;
}

export async function clearCachedFeed(uid: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key(uid));
  } catch (e) {
    if (__DEV__) console.warn('[feed-cache] clearCachedFeed failed:', e);
  }
}

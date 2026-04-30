/**
 * localStorage-backed "recent searches" list.
 *
 * The site header search and the /search results page both read from
 * and write to the same key so the recency list stays consistent
 * across the app. The list is intentionally small (5 entries) so the
 * recents UI doesn't dominate the search page when no query is set.
 *
 * All helpers degrade gracefully when localStorage is unavailable
 * (private mode, SSR, quota exceeded, JSON corruption, …) — they just
 * return empty / no-op so the rest of the search experience continues
 * to work.
 */

const STORAGE_KEY = "build-session/recent-searches";
export const RECENT_SEARCHES_LIMIT = 5;
export const RECENT_SEARCHES_EVENT = "build-session:recent-searches-changed";

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function normalizeQuery(raw: string): string {
  // Collapse internal whitespace so "  leather  bag " and "leather bag"
  // count as the same recency entry.
  return raw.trim().replace(/\s+/g, " ");
}

function readRaw(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function writeRaw(values: string[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    // Notify any listeners (e.g. RecentSearches component on the search
    // page). The native `storage` event only fires across tabs, so we
    // dispatch a custom event for same-tab updates.
    window.dispatchEvent(new CustomEvent(RECENT_SEARCHES_EVENT));
  } catch {
    /* ignore write failures (quota, security errors, …) */
  }
}

export function getRecentSearches(): string[] {
  return readRaw()
    .map(normalizeQuery)
    .filter((value) => value.length > 0)
    .slice(0, RECENT_SEARCHES_LIMIT);
}

/**
 * Push a new search term to the front of the list, deduplicating
 * (case-insensitive) and trimming to the limit. No-op for empty or
 * whitespace-only input.
 */
export function pushRecentSearch(query: string): void {
  const normalized = normalizeQuery(query);
  if (normalized.length === 0) return;
  const existing = readRaw().map(normalizeQuery).filter((v) => v.length > 0);
  const lower = normalized.toLowerCase();
  const without = existing.filter((value) => value.toLowerCase() !== lower);
  const next = [normalized, ...without].slice(0, RECENT_SEARCHES_LIMIT);
  writeRaw(next);
}

export function removeRecentSearch(query: string): void {
  const lower = normalizeQuery(query).toLowerCase();
  if (lower.length === 0) return;
  const existing = readRaw().map(normalizeQuery).filter((v) => v.length > 0);
  const next = existing.filter((value) => value.toLowerCase() !== lower);
  if (next.length === existing.length) return;
  writeRaw(next);
}

export function clearRecentSearches(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(RECENT_SEARCHES_EVENT));
  } catch {
    /* ignore */
  }
}

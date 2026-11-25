/**
 * Developer Console cache: stats are kept for 10 minutes (and survive a page reload), so opening the
 * console or switching tabs never re-downloads them. Refresh / Sync Stats always fetch fresh data.
 */
export const ADMIN_CACHE_MS = 10 * 60 * 1000;

interface Cached<T> { at: number; value: T }

export function readAdminCache<T>(key: string, maxAgeMs = ADMIN_CACHE_MS): Cached<T> | null {
  try {
    const raw = sessionStorage.getItem(`echat_admin_${key}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as Cached<T>;
    return Date.now() - cached.at < maxAgeMs ? cached : null;
  } catch { return null; }
}

export function writeAdminCache<T>(key: string, value: T): number {
  const at = Date.now();
  try { sessionStorage.setItem(`echat_admin_${key}`, JSON.stringify({ at, value })); } catch { /* storage full or blocked */ }
  return at;
}

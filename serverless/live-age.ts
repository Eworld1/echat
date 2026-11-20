/**
 * Works out an account's creation time for the Go Live "60 days old" rule.
 *
 * - If Firebase Admin could read the real creation time, that always wins.
 * - Otherwise the best we can prove is auth_time (the user's last sign-in). A Firebase account
 *   cannot sign in before it exists, so the real creation time is never LATER than auth_time,
 *   but it can be much earlier. So we use the earlier of the stored value and auth_time, and we
 *   never replace an older stored date with a newer sign-in time (that wrongly made old accounts
 *   look brand new every time they signed in).
 */
export function resolveLiveCreatedAt(input: { adminCreatedAt?: number; storedCreatedAt?: number; authTimeMs?: number; now?: number }): number {
  const now = input.now ?? Date.now();
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= now;
  if (valid(input.adminCreatedAt)) return input.adminCreatedAt;
  const candidates = [input.storedCreatedAt, input.authTimeMs].filter(valid);
  return candidates.length ? Math.min(...candidates) : 0;
}

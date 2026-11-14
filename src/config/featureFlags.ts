// TEMP DISABLED FOR V2 ROLLBACK: set true to restore the existing V2 route entry.
export const ECHAT_V2_ENABLED = false;
export const ECHAT_V2_DEFAULT = 'classic' as const;
export const ECHAT_CLASSIC_ENABLED = true;

export const GO_LIVE = {
  enabledFor: 'developers_only_for_now',
  developerRoles: ['developer', 'admin', 'super_admin'] as const,
  minAccountAgeDaysForNormalUsers: 60,
  message: 'Go Live is currently for developers only. Normal accounts can Go Live after 60 days.'
} as const;


type GoLiveUser = { role?: string; isAdmin?: boolean; isDeveloper?: boolean; createdAt?: number };
export function getGoLiveEligibility(user: GoLiveUser, now = Date.now()) {
  const createdAt = Number(user.createdAt || 0);
  const ageDaysExact = createdAt > 0 ? Math.max(0, (now - createdAt) / 86400000) : 0;
  const accountAgeDays = Math.floor(ageDaysExact);
  const developer = Boolean(user.isDeveloper || user.isAdmin || GO_LIVE.developerRoles.some(role => role === user.role));
  const daysLeft = Math.max(0, GO_LIVE.minAccountAgeDaysForNormalUsers - accountAgeDays);
  return { developer, accountAgeDays, ageDaysExact, daysLeft, canGoLive: developer || ageDaysExact >= GO_LIVE.minAccountAgeDaysForNormalUsers };
}

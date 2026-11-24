/**
 * One shared "Reels sound" setting for every reel player (new Firestore reels and older post reels).
 * The user's choice is remembered in localStorage. When the browser blocks sound on autoplay we
 * switch to muted for this session only (so the 🔇 icon is always truthful) without overwriting
 * the saved preference.
 */
const KEY = 'reels_muted';
export const REELS_SETTINGS_EVENT = 'echat:reels-settings';
let sessionMuted: boolean | null = null;

export function getReelsMuted(): boolean {
  if (sessionMuted !== null) return sessionMuted;
  try { return window.localStorage.getItem(KEY) !== 'false'; } catch { return true; }
}

/** persist=false: browser forced mute (autoplay policy) — don't change the saved preference. */
export function setReelsMuted(muted: boolean, persist = true): void {
  if (persist) {
    sessionMuted = null;
    try { window.localStorage.setItem(KEY, String(muted)); } catch { /* storage blocked */ sessionMuted = muted; }
  } else {
    sessionMuted = muted;
  }
  window.dispatchEvent(new Event(REELS_SETTINGS_EVENT));
}

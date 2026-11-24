import app, { auth } from './firebase';
import { apiUrl } from './apiBase';

/**
 * Push notifications (Firebase Cloud Messaging).
 * - This device's FCM token is sent to the eChat server, which saves it in Firestore at
 *   users/{uid}/tokens and sends pushes for new messages, friend requests and group posts.
 * - public/sw.js shows them, so they arrive even when eChat is closed (as long as there is internet).
 * - The choice is per device: Settings & Privacy → Push Notifications.
 */

const PREF_KEY = 'echat_push';            // 'on' | 'off' (null = never asked)
const TOKEN_KEY = 'echat_push_token';
const ASKED_KEY = 'echat_push_asked_at';
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Web Push certificate (Firebase Console → Project settings → Cloud Messaging → Web configuration).
 * This is the PUBLIC key of the pair, so it is safe in the code; VITE_FIREBASE_VAPID_KEY overrides it.
 */
const ECHAT_VAPID_KEY = 'BCIfjwZ3c3BrCk3UN4S7EyZmwhYvmuHMDDmLVlKEaGu5CzK9TQisPv8mSlaYmw8PKGHqEQsaTVyg_5Sql5lwqX4';
const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined)?.trim() || ECHAT_VAPID_KEY;
export const PUSH_CHANGED_EVENT = 'echat:push-changed';

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on';

const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
const remove = (key: string) => { try { localStorage.removeItem(key); } catch { /* storage blocked */ } };
const changed = () => window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));

export const isInstalledApp = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

let supported: Promise<boolean> | null = null;
export function pushSupported(): Promise<boolean> {
  if (!supported) {
    supported = (async () => {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
      try { const { isSupported } = await import('firebase/messaging'); return await isSupported(); } catch { return false; }
    })();
  }
  return supported;
}

export async function getPushState(): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && read(PREF_KEY) !== 'off' && read(TOKEN_KEY) ? 'on' : 'off';
}

async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

async function callServer(path: string, body: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please log in first.');
  const res = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-firebase-id-token': await user.getIdToken() },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error || 'Could not update notifications. Please try again.');
}

/** Ask for permission (if needed), get this device's FCM token and save it for the signed-in user. */
export async function enablePush(): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  write(ASKED_KEY, String(Date.now()));
  if (permission !== 'granted') { changed(); return permission === 'denied' ? 'blocked' : 'off'; }
  const { getMessaging, getToken } = await import('firebase/messaging');
  const token = await getToken(getMessaging(app), { serviceWorkerRegistration: await serviceWorker(), vapidKey: VAPID_KEY });
  if (!token) throw new Error('Could not turn on notifications. Please try again.');
  await callServer('/api/push/token', { token, platform: isInstalledApp() ? 'pwa' : 'browser' });
  write(TOKEN_KEY, token);
  write(PREF_KEY, 'on');
  changed();
  return 'on';
}

/**
 * Stop pushes to this device. Logging out passes keepChoice so the next person who logs in here
 * gets their own token (and the previous person's notifications never show up on this phone).
 */
export async function disablePush(options: { keepChoice?: boolean } = {}): Promise<void> {
  const token = read(TOKEN_KEY);
  if (!options.keepChoice) write(PREF_KEY, 'off');
  remove(TOKEN_KEY);
  if (token) await callServer('/api/push/token/remove', { token }).catch(() => {});
  if (await pushSupported()) {
    try { const { getMessaging, deleteToken } = await import('firebase/messaging'); await deleteToken(getMessaging(app)); } catch { /* nothing to delete */ }
  }
  setAppBadge(0);
  changed();
}

/** After login: quietly refresh the token if this device already said yes. */
export async function syncPushAfterLogin(): Promise<void> {
  if (read(PREF_KEY) === 'off' || !(await pushSupported()) || Notification.permission !== 'granted') return;
  try { await enablePush(); } catch (error) { console.warn('Push notifications could not refresh:', error); }
}

/** Show the "Turn on notifications?" card? Only when the browser hasn't been asked (or "Not now" was a week ago). */
export async function shouldAskForPush(): Promise<boolean> {
  if (read(PREF_KEY) !== null || !(await pushSupported()) || Notification.permission !== 'default') return false;
  const askedAt = Number(read(ASKED_KEY) || 0);
  return Date.now() - askedAt > ASK_AGAIN_MS;
}

export const snoozePushPrompt = () => write(ASKED_KEY, String(Date.now()));

/** Unread count on the installed app's icon (Chrome / Edge / Android PWAs). */
export function setAppBadge(count: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try { void (count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.())?.catch(() => {}); } catch { /* not supported */ }
}

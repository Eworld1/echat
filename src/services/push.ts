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

/** The push worker: public/firebase-messaging-sw.js in FCM's own scope (separate from /sw.js). */
export const PUSH_SW_URL = '/firebase-messaging-sw.js';
export const PUSH_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

/** Resolves once the worker is ACTIVE: subscribing earlier fails with "no active Service Worker". */
function whenActive(registration: ServiceWorkerRegistration, timeoutMs = 20000): Promise<ServiceWorkerRegistration> {
  if (registration.active) return Promise.resolve(registration);
  return new Promise((resolve, reject) => {
    const worker = registration.installing || registration.waiting;
    if (!worker) { reject(new Error('Notifications could not start. Please reload eChat and try again.')); return; }
    const timer = window.setTimeout(() => reject(new Error('Notifications are still starting. Please wait a moment and tap Turn on again.')), timeoutMs);
    const check = () => {
      if (registration.active || worker.state === 'activated') { window.clearTimeout(timer); worker.removeEventListener('statechange', check); resolve(registration); }
      else if (worker.state === 'redundant') { window.clearTimeout(timer); worker.removeEventListener('statechange', check); reject(new Error('Notifications could not start. Please reload eChat and try again.')); }
    };
    worker.addEventListener('statechange', check);
    check();
  });
}

/** Register (or reuse) the push worker. Called on app load and again before subscribing. */
export async function registerPushServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = (await navigator.serviceWorker.getRegistration(PUSH_SW_SCOPE))
    ?? await navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE });
  return whenActive(registration);
}

async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  return registerPushServiceWorker();
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

/**
 * Temporary phone / browser hiccups that go away on a second try:
 * - "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing." - the browser
 *   closed Firebase's IndexedDB connection (app resumed from background, or an older eChat tab is open);
 *   Firebase reopens it on the next call.
 * - "no active Service Worker" - the push worker was still starting.
 */
const TRANSIENT = /IDBDatabase|database connection is closing|InvalidStateError|AbortError|UnknownError|no active service worker|registration failed|not registered|still starting/i;
async function withRetry<T>(task: () => Promise<T>): Promise<T> {
  const delays = [600, 1500, 3000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const text = `${(error as Error)?.name || ''} ${(error as Error)?.message || error}`;
      if (!TRANSIENT.test(text) || attempt >= delays.length) {
        console.warn('Push notifications could not start:', error);
        // Never show raw browser / database errors to people.
        throw new Error(TRANSIENT.test(text) ? 'Notifications could not start right now. Please close and reopen eChat, then tap Turn on again.' : friendlyPushError(error));
      }
      await new Promise(resolve => window.setTimeout(resolve, delays[attempt]));
    }
  }
}
function friendlyPushError(error: unknown): string {
  const text = String((error as Error)?.message || error);
  if (/permission|blocked|denied/i.test(text)) return 'Notifications are blocked. Allow them for eChat in your browser settings, then try again.';
  if (/network|fetch|offline|Failed to fetch/i.test(text)) return 'No internet connection. Check your network and try again.';
  if (/log in|sign in|session/i.test(text)) return text;
  return 'Could not turn on notifications. Please try again.';
}

/** Ask for permission (if needed), get this device's FCM token and save it for the signed-in user. */
// One push operation at a time: overlapping getToken / deleteToken calls fight over Firebase's database.
let pushQueue: Promise<unknown> = Promise.resolve();
let enabling: Promise<PushState> | null = null;
function queued<T>(task: () => Promise<T>): Promise<T> {
  const run = pushQueue.then(task, task);
  pushQueue = run.catch(() => undefined);
  return run;
}

export function enablePush(): Promise<PushState> {
  // Tapping "Turn on" while the login refresh is running joins the same attempt.
  if (!enabling) enabling = queued(enablePushNow).finally(() => { enabling = null; });
  return enabling;
}

async function enablePushNow(): Promise<PushState> {
  if (!(await pushSupported())) return 'unsupported';
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  write(ASKED_KEY, String(Date.now()));
  if (permission !== 'granted') { changed(); return permission === 'denied' ? 'blocked' : 'off'; }
  const { getMessaging, getToken } = await import('firebase/messaging');
  const messaging = getMessaging(app);
  const token = await withRetry(async () => getToken(messaging, { serviceWorkerRegistration: await serviceWorker(), vapidKey: VAPID_KEY }));
  if (!token) throw new Error('Could not turn on notifications. Please try again.');
  await withRetry(() => callServer('/api/push/token', { token, platform: isInstalledApp() ? 'pwa' : 'browser' }));
  write(TOKEN_KEY, token);
  write(PREF_KEY, 'on');
  changed();
  return 'on';
}

/**
 * Stop pushes to this device. Logging out passes keepChoice so the next person who logs in here
 * gets their own token (and the previous person's notifications never show up on this phone).
 */
export function disablePush(options: { keepChoice?: boolean } = {}): Promise<void> {
  return queued(() => disablePushNow(options));
}

async function disablePushNow(options: { keepChoice?: boolean }): Promise<void> {
  const token = read(TOKEN_KEY);
  if (!options.keepChoice) write(PREF_KEY, 'off');
  remove(TOKEN_KEY);
  if (token) await callServer('/api/push/token/remove', { token }).catch(() => {});
  if (await pushSupported()) {
    try { const { getMessaging, deleteToken } = await import('firebase/messaging'); await withRetry(() => deleteToken(getMessaging(app))); } catch { /* nothing to delete */ }
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

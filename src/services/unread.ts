import { useEffect, useState } from 'react';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from './firebase';
import { api } from './api';

/**
 * Live unread counts for the red badges (Messages + Notifications).
 * - The eChat server keeps users/{uid}.unread up to date; ONE Firestore listener on your own profile
 *   updates every badge instantly (1 read per change, no polling, no refresh).
 * - The socket's "unread_counts" event arrives even faster when it's connected.
 * Opening a chat / the Notifications page marks things read on the server, which clears the badge.
 */
export interface UnreadCounts { messages: number; notifications: number }

let counts: UnreadCounts = { messages: 0, notifications: 0 };
const subscribers = new Set<(value: UnreadCounts) => void>();
let activeUid: string | null = null;
let stopFirestore: Unsubscribe | null = null;

function publish(next: UnreadCounts) {
  const clean = { messages: Math.max(0, Math.floor(next.messages || 0)), notifications: Math.max(0, Math.floor(next.notifications || 0)) };
  if (clean.messages === counts.messages && clean.notifications === counts.notifications) return;
  counts = clean;
  subscribers.forEach(fn => fn(counts));
}

/** Instant local update (e.g. a chat was just opened) before the server confirms it. */
export function setUnreadCounts(partial: Partial<UnreadCounts>) {
  publish({ ...counts, ...partial });
}

function start(uid: string) {
  if (activeUid === uid) return;
  stop();
  activeUid = uid;
  stopFirestore = onSnapshot(doc(db, 'users', uid), snapshot => {
    const unread = snapshot.get('unread') as Partial<UnreadCounts> | undefined;
    if (unread && typeof unread === 'object') publish({ messages: Number(unread.messages) || 0, notifications: Number(unread.notifications) || 0 });
  }, () => { /* quota / offline: the socket and the one-off fetch below still work */ });
  void api.getUnreadCounts().then(publish).catch(() => {});
}

function stop() {
  stopFirestore?.();
  stopFirestore = null;
  activeUid = null;
  publish({ messages: 0, notifications: 0 });
}

if (typeof window !== 'undefined') {
  window.addEventListener('echat:unread', event => publish((event as CustomEvent<UnreadCounts>).detail));
  // Coming back to the app (phone unlocked, tab focused): make sure the numbers are current.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && activeUid) void api.getUnreadCounts().then(publish).catch(() => {}); });
}

/** Red badge numbers. Pass the signed-in user's id so the listener follows login / logout. */
export function useUnreadCounts(userId: string | null | undefined): UnreadCounts {
  const [value, setValue] = useState(counts);
  useEffect(() => {
    const uid = userId ? auth.currentUser?.uid || userId : null;
    if (uid) start(uid); else if (!userId && activeUid) stop();
    subscribers.add(setValue);
    setValue(counts);
    return () => { subscribers.delete(setValue); };
  }, [userId]);
  return value;
}

/** "9+" style label for badges. */
export const badgeLabel = (n: number) => (n > 99 ? '99+' : String(n));

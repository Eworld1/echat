/**
 * Bell notifications for lives (camera AND streaming software), Facebook-style.
 * Watches Firestore lives/{hostUserId} (written by the live API). When a host goes live, ONE
 * notification per follower / friend (deduplicated by stream id) with a deep link /live/{hostId};
 * when the live ends, those notifications are updated to "Live ended".
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { Notification, User } from './types.js';

export interface LiveNotifierDeps {
  firestore: Firestore | null;
  lookupUser: (uid: string) => User | undefined;
  isBlockedBetween: (a: string, b: string) => boolean;
  getAllNotifications: () => Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'createdAt'>) => Notification;
  save: () => void;
  push: (userId: string, notification: Notification) => void;
}

/** Only announce lives that started recently (a server restart must not re-announce old lives). */
const ANNOUNCE_WINDOW_MS = 15 * 60 * 1000;

export function startLiveNotifier(deps: LiveNotifierDeps): () => void {
  const { firestore } = deps;
  if (!firestore) return () => {};
  const handled = new Map<string, string>(); // hostId -> "streamId:status"

  const audienceOf = async (hostUid: string, host: User | undefined): Promise<string[]> => {
    const ids = new Set<string>();
    const followers = await firestore.collection('followers').where('followingId', '==', hostUid).limit(1000).get().catch(() => null);
    for (const doc of followers?.docs || []) ids.add(String(doc.data().followerId || ''));
    for (const friendId of host?.friends || []) ids.add(friendId);
    const out = new Set<string>();
    for (const id of ids) {
      const user = id ? deps.lookupUser(id) : undefined;
      if (!user || user.id === host?.id || id === hostUid) continue;
      if (host && deps.isBlockedBetween(host.id, user.id)) continue;
      out.add(user.id);
    }
    return [...out];
  };

  const announce = async (hostUid: string, data: Record<string, any>) => {
    const streamId = String(data.streamId || '');
    if (!streamId || Date.now() - Number(data.startedAt || 0) > ANNOUNCE_WINDOW_MS) return;
    const already = new Set(deps.getAllNotifications().filter(n => n.type === 'live_stream' && n.targetId === streamId).map(n => n.userId));
    const host = deps.lookupUser(hostUid);
    const name = host?.name || String(data.hostName || 'Someone');
    const title = String(data.title || `${name} is Live on EChat!`);
    for (const userId of await audienceOf(hostUid, host)) {
      if (already.has(userId)) continue; // never twice for the same live
      const notification = deps.addNotification({
        userId,
        actorId: host?.id || hostUid,
        type: 'live_stream',
        targetId: streamId,
        link: `/live/${encodeURIComponent(hostUid)}`,
        message: `${name} is live: ${title}`,
        read: false
      });
      deps.push(userId, notification);
    }
  };

  const markEnded = (data: Record<string, any>) => {
    const streamId = String(data.streamId || '');
    let changed = false;
    for (const n of deps.getAllNotifications()) {
      if (n.type !== 'live_stream' || n.targetId !== streamId || n.message.startsWith('Live ended')) continue;
      n.message = `Live ended · ${n.message.replace(/ is live(:| with)/, ' was live$1')}`;
      changed = true;
    }
    if (changed) deps.save();
  };

  return firestore.collection('lives').onSnapshot(snapshot => {
    for (const change of snapshot.docChanges()) {
      const hostUid = change.doc.id;
      const data = change.doc.data();
      const key = `${data.streamId}:${data.status}`;
      if (handled.get(hostUid) === key) continue;
      handled.set(hostUid, key);
      if (data.status === 'live') void announce(hostUid, data).catch(error => console.warn('[Live notifier] announce failed', error instanceof Error ? error.message : error));
      else if (data.status === 'ended') markEnded(data);
    }
  }, error => console.warn('[Live notifier] Firestore listener failed:', error.message));
}

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getCountFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './firebase';
import type { LiveComment, LiveStream } from '../types';

export const LIVE_CATEGORIES = ['Just Chatting', 'Music', 'Gaming', 'News', 'Sports', 'Church', 'Education', 'Market / Selling'] as const;
export const LIVE_LOCATIONS = ['Freetown', 'Bo', 'Kenema', 'Makeni', 'Other'] as const;
export type LiveReportReason = 'Spam' | 'Harassment' | 'Inappropriate / Sexual Content' | 'Violence' | 'False Information';
export const LIVE_REPORT_REASONS: LiveReportReason[] = ['Spam', 'Harassment', 'Inappropriate / Sexual Content', 'Violence', 'False Information'];

const livesRef = collection(db, 'liveStreams');
const pairId = (first: string, second: string) => `${first}_${second}`;
const LIVE_DISCOVERY_CACHE_TTL_MS = 30_000;
type LiveDiscoveryUserData = { followingIds: string[]; blockedIds: string[]; blockedByIds: string[]; notificationCount: number };
const liveDiscoveryUserDataCache = new Map<string, { expiresAt: number; value?: LiveDiscoveryUserData; promise?: Promise<LiveDiscoveryUserData> }>();

export function invalidateLiveDiscoveryUserData(userId: string): void {
  liveDiscoveryUserDataCache.delete(userId);
}

/**
 * Facebook-style live discovery. ONE document per host: lives/{hostUserId} with status 'live' | 'ended',
 * the CURRENT streamId and a heartbeat (updatedAt, every 10 s from the host's app).
 * - Only status == 'live' is listened to, so an ended live disappears for everyone instantly.
 * - A camera live whose heartbeat is older than 30 s counts as ended (host's app closed / offline).
 * - One shared realtime listener for the whole app (feed banner, Live tab, sidebar…).
 * Until the lives/{hostId} read rule is published, it falls back to liveStreams with the same checks.
 */
export const LIVE_STALE_MS = 30_000;
const hostLivesRef = collection(db, 'lives');

type RawLive = LiveStream & { updatedAt: number };

function hostLiveToStream(hostId: string, data: Record<string, any>): RawLive {
  return {
    id: String(data.streamId || ''),
    hostId,
    hostName: String(data.hostName || ''),
    hostAvatar: String(data.hostAvatar || ''),
    hostEmail: '',
    isHostVerified: data.isHostVerified === true,
    title: String(data.title || ''),
    category: data.category,
    location: data.location,
    viewersCount: Number(data.viewerCount || 0),
    reactionsCount: 0,
    startedAt: Number(data.startedAt || 0),
    updatedAt: Number(data.updatedAt || 0),
    isActive: data.status === 'live',
    status: data.status === 'live' ? 'live' : 'ended',
    source: data.source,
    comments: [],
    liveKitRoom: String(data.liveKitRoom || '')
  };
}

function legacyToStream(id: string, data: Record<string, any>): RawLive {
  return { ...(data as LiveStream), id, updatedAt: Number(data.heartbeatAt || data.startedAt || 0), status: data.isActive === true ? 'live' : 'ended' };
}

/**
 * Heartbeat freshness measured on THIS device: a heartbeat counts from the moment we saw it change,
 * so a phone with a wrong clock can't hide (or keep showing) lives for long.
 */
const heartbeatSeen = new Map<string, { updatedAt: number; seenAt: number }>();
export function isLiveFresh(stream: Pick<LiveStream, 'id' | 'hostId' | 'source'> & { updatedAt?: number }, now = Date.now()): boolean {
  if (stream.source === 'rtmp') return true; // streaming software: ended by LiveKit's webhook instead
  const updatedAt = Number(stream.updatedAt || 0);
  const key = `${stream.hostId}:${stream.id}`;
  const seen = heartbeatSeen.get(key);
  if (!seen || seen.updatedAt !== updatedAt) heartbeatSeen.set(key, { updatedAt, seenAt: seen ? now : Math.min(now, updatedAt) });
  return now - heartbeatSeen.get(key)!.seenAt <= LIVE_STALE_MS;
}

type LivesListener = { onStreams: (streams: LiveStream[]) => void; onError: (error: Error) => void };
const livesListeners = new Set<LivesListener>();
let rawLives: RawLive[] = [];
let visibleLives: LiveStream[] | null = null;
let livesError: Error | null = null;
let stopLivesSource: (() => void) | null = null;
let livesTicker: number | null = null;

function publishLives() {
  const now = Date.now();
  const next = rawLives
    .filter(stream => stream.id && stream.status === 'live' && isLiveFresh(stream, now))
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const changed = !visibleLives || next.length !== visibleLives.length || next.some((item, index) => {
    const before = visibleLives![index];
    return item.id !== before.id || item.viewersCount !== before.viewersCount || item.title !== before.title || item.hostName !== before.hostName || item.hostAvatar !== before.hostAvatar;
  });
  if (!changed) return;
  visibleLives = next;
  livesError = null;
  livesListeners.forEach(listener => listener.onStreams(next));
}

function startLivesSource() {
  const fail = (error: Error) => {
    livesError = error;
    livesListeners.forEach(listener => listener.onError(error));
  };
  const useLegacy = () => {
    stopLivesSource = onSnapshot(query(collection(db, 'liveStreams'), where('isActive', '==', true)), snapshot => {
      const newestPerHost = new Map<string, RawLive>();
      for (const item of snapshot.docs) {
        const stream = legacyToStream(item.id, item.data());
        const existing = newestPerHost.get(stream.hostId);
        if (!existing || (stream.startedAt || 0) > (existing.startedAt || 0)) newestPerHost.set(stream.hostId, stream);
      }
      rawLives = [...newestPerHost.values()];
      publishLives();
    }, fail);
  };
  stopLivesSource = onSnapshot(query(hostLivesRef, where('status', '==', 'live')), snapshot => {
    rawLives = snapshot.docs.map(item => hostLiveToStream(item.id, item.data()));
    publishLives();
  }, error => {
    // lives/{hostId} rule not published yet: same behaviour from the per-stream documents.
    if ((error as { code?: string }).code === 'permission-denied') { stopLivesSource?.(); useLegacy(); }
    else fail(error);
  });
  // Re-check heartbeats so a host who went silent drops off within ~30 s without any new snapshot.
  livesTicker = window.setInterval(publishLives, 5000);
}

/** Realtime list of lives that are on air now (newest first). Shared by every caller. */
export function listenLiveStreams(onStreams: (streams: LiveStream[]) => void, onError: (error: Error) => void): Unsubscribe {
  const listener: LivesListener = { onStreams, onError };
  livesListeners.add(listener);
  if (!stopLivesSource) startLivesSource();
  else if (visibleLives) onStreams(visibleLives);
  else if (livesError) onError(livesError);
  return () => {
    livesListeners.delete(listener);
    if (livesListeners.size) return;
    stopLivesSource?.();
    stopLivesSource = null;
    if (livesTicker) window.clearInterval(livesTicker);
    livesTicker = null;
    visibleLives = null;
    rawLives = [];
  };
}

/** React hook: lives on air now (null while loading). */
export function useActiveLives(enabled = true): LiveStream[] | null {
  const [streams, setStreams] = useState<LiveStream[] | null>(null);
  useEffect(() => {
    if (!enabled) { setStreams(null); return; }
    return listenLiveStreams(setStreams, () => setStreams([]));
  }, [enabled]);
  return streams;
}

export type HostLiveState = { loaded: boolean; stream: LiveStream | null; ended: boolean };

/**
 * Follow one host's live (lives/{hostId}): the CURRENT stream id, title, viewer count and whether it
 * ended (status 'ended' or no heartbeat for 30 s). Lives started before lives/{hostId} existed (or
 * before the read rule is published) are followed through liveStreams/{fallbackStreamId}.
 */
export function listenHostLive(hostId: string, fallbackStreamId: string, onState: (state: HostLiveState) => void): Unsubscribe {
  let stop: (() => void) | null = null;
  let latest: RawLive | null = null;
  let closed = false;
  const emit = () => {
    if (!latest) { onState({ loaded: true, stream: null, ended: true }); return; }
    onState({ loaded: true, stream: latest, ended: latest.status !== 'live' || !isLiveFresh(latest) });
  };
  const followLegacy = () => {
    stop?.();
    if (!fallbackStreamId) { latest = null; emit(); stop = null; return; }
    stop = onSnapshot(doc(db, 'liveStreams', fallbackStreamId), snapshot => {
      latest = snapshot.exists() ? legacyToStream(snapshot.id, snapshot.data()) : null;
      emit();
    }, () => { latest = null; emit(); });
  };
  if (!hostId) followLegacy();
  else {
    stop = onSnapshot(doc(db, 'lives', hostId), snapshot => {
      if (closed) return;
      if (!snapshot.exists()) { followLegacy(); return; }
      latest = hostLiveToStream(hostId, snapshot.data());
      emit();
    }, () => { if (!closed) followLegacy(); });
  }
  const ticker = window.setInterval(() => { if (latest) emit(); }, 5000);
  return () => { closed = true; stop?.(); window.clearInterval(ticker); };
}

export function getLiveDiscoveryUserData(userId: string): Promise<LiveDiscoveryUserData> {
  const cached = liveDiscoveryUserDataCache.get(userId);
  if (cached?.promise) return cached.promise;
  if (cached && cached.expiresAt > Date.now() && cached.value) return Promise.resolve(cached.value);

  const promise = Promise.all([
    getDocs(query(collection(db, 'followers'), where('followerId', '==', userId))),
    getDocs(query(collection(db, 'blocks'), where('blockerId', '==', userId))),
    getDocs(query(collection(db, 'blocks'), where('blockedId', '==', userId))),
    getDocs(query(collection(db, 'notifications'), where('userId', '==', userId), where('type', '==', 'live_stream'), where('read', '==', false), limit(99)))
  ]).then(([following, blocks, blockedBy, notifications]) => {
    const value = {
      followingIds: following.docs.map(item => String(item.data().followingId || '')).filter(Boolean),
      blockedIds: blocks.docs.map(item => String(item.data().blockedId || '')).filter(Boolean),
      blockedByIds: blockedBy.docs.map(item => String(item.data().blockerId || '')).filter(Boolean),
      notificationCount: notifications.size
    };
    liveDiscoveryUserDataCache.set(userId, { expiresAt: Date.now() + LIVE_DISCOVERY_CACHE_TTL_MS, value });
    return value;
  }, error => {
    liveDiscoveryUserDataCache.delete(userId);
    throw error;
  });
  liveDiscoveryUserDataCache.set(userId, { expiresAt: 0, promise });
  return promise;
}

export function listenFollowingIds(userId: string, onIds: (ids: string[]) => void, onError?: (error: Error) => void): Unsubscribe {
  if (!userId) { onIds([]); return () => {}; }
  return onSnapshot(query(collection(db, 'followers'), where('followerId', '==', userId)), snapshot => {
    onIds(snapshot.docs.map(item => String(item.data().followingId || '')).filter(Boolean));
  }, error => onError?.(error));
}

export function listenBlockIds(userId: string, onIds: (ids: string[]) => void, onError?: (error: Error) => void): Unsubscribe {
  if (!userId) { onIds([]); return () => {}; }
  return onSnapshot(query(collection(db, 'blocks'), where('blockerId', '==', userId)), snapshot => {
    onIds(snapshot.docs.map(item => String(item.data().blockedId || '')).filter(Boolean));
  }, error => onError?.(error));
}

export function listenBlockedByIds(userId: string, onIds: (ids: string[]) => void, onError?: (error: Error) => void): Unsubscribe {
  if (!userId) { onIds([]); return () => {}; }
  return onSnapshot(query(collection(db, 'blocks'), where('blockedId', '==', userId)), snapshot => {
    onIds(snapshot.docs.map(item => String(item.data().blockerId || '')).filter(Boolean));
  }, error => onError?.(error));
}

export function listenFollowingState(followerId: string, followingId: string, onFollowing: (following: boolean) => void): Unsubscribe {
  return onSnapshot(doc(db, 'followers', pairId(followerId, followingId)), snapshot => onFollowing(snapshot.exists()));
}

/** IDs of everyone who follows `userId` (live). */
export function listenFollowerIds(userId: string, onIds: (ids: string[]) => void, onError?: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'followers'), where('followingId', '==', userId)), snapshot => {
    onIds(snapshot.docs.map(item => String(item.data().followerId || '')).filter(Boolean));
  }, error => onError?.(error));
}

/**
 * Follower count with an aggregation query (1 read per 1,000 followers) instead of a listener that
 * downloads every follower document. Cached for 5 minutes; follow / unfollow in this app refreshes it.
 */
const FOLLOWER_COUNT_TTL_MS = 5 * 60 * 1000;
const followerCounts = new Map<string, { at: number; count: number; pending?: Promise<number> }>();
const followerCountListeners = new Map<string, Set<(count: number) => void>>();

function loadFollowerCount(userId: string, force = false): Promise<number> {
  const cached = followerCounts.get(userId);
  if (cached?.pending) return cached.pending;
  if (!force && cached && Date.now() - cached.at < FOLLOWER_COUNT_TTL_MS) return Promise.resolve(cached.count);
  const pending = getCountFromServer(query(collection(db, 'followers'), where('followingId', '==', userId)))
    .then(result => result.data().count)
    .catch(() => cached?.count ?? 0)
    .then(count => {
      followerCounts.set(userId, { at: Date.now(), count });
      followerCountListeners.get(userId)?.forEach(listener => listener(count));
      return count;
    });
  followerCounts.set(userId, { at: cached?.at ?? 0, count: cached?.count ?? 0, pending });
  return pending;
}

export function listenFollowerCount(userId: string, onCount: (count: number) => void): Unsubscribe {
  if (!userId) { onCount(0); return () => {}; }
  const listeners = followerCountListeners.get(userId) ?? new Set();
  listeners.add(onCount);
  followerCountListeners.set(userId, listeners);
  const cached = followerCounts.get(userId);
  if (cached && !cached.pending && Date.now() - cached.at < FOLLOWER_COUNT_TTL_MS) onCount(cached.count);
  else void loadFollowerCount(userId);
  return () => { listeners.delete(onCount); };
}

export async function followCreator(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) throw new Error('You cannot follow your own account.');
  const [blockedByMe, blockedMe] = await Promise.all([
    getDoc(doc(db, 'blocks', pairId(followerId, followingId))),
    getDoc(doc(db, 'blocks', pairId(followingId, followerId)))
  ]);
  if (blockedByMe.exists() || blockedMe.exists()) throw new Error('Following is unavailable for this account.');
  await setDoc(doc(db, 'followers', pairId(followerId, followingId)), { followerId, followingId, createdAt: Date.now() });
  void loadFollowerCount(followingId, true);
}

export async function unfollowCreator(followerId: string, followingId: string): Promise<void> {
  await deleteDoc(doc(db, 'followers', pairId(followerId, followingId)));
  void loadFollowerCount(followingId, true);
}

export async function blockLiveUser(blockerId: string, blockedId: string): Promise<void> {
  if (!blockerId || blockerId === blockedId) throw new Error('You cannot block this account.');
  const blockRef = doc(db, 'blocks', pairId(blockerId, blockedId));
  if (!(await getDoc(blockRef)).exists()) await setDoc(blockRef, { blockerId, blockedId, createdAt: Date.now(), source: 'live' });
  await deleteDoc(doc(db, 'followers', pairId(blockerId, blockedId))).catch(() => {});
  await deleteDoc(doc(db, 'followers', pairId(blockedId, blockerId))).catch(() => {});
}

export async function unblockLiveUser(blockerId: string, blockedId: string): Promise<void> {
  await deleteDoc(doc(db, 'blocks', pairId(blockerId, blockedId)));
}

export async function reportLiveTarget(input: { reporterId: string; targetUserId: string; streamId?: string; reason: LiveReportReason }): Promise<void> {
  const { reporterId, targetUserId, streamId, reason } = input;
  if (!reporterId || !targetUserId || reporterId === targetUserId) throw new Error('This report could not be submitted.');
  if (!streamId) {
    await setDoc(doc(db, 'reports', `profile_${targetUserId}_${reporterId}`), {
      reporterId, targetUserId, streamId: null, reason, status: 'pending', createdAt: Date.now()
    });
    return;
  }
  const reportRef = doc(db, 'reports', pairId(streamId, reporterId));
  const streamRef = doc(db, 'liveStreams', streamId);
  await runTransaction(db, async transaction => {
    const [report, stream] = await Promise.all([transaction.get(reportRef), transaction.get(streamRef)]);
    if (report.exists()) throw new Error('You have already reported this live.');
    if (!stream.exists()) throw new Error('This live stream is no longer available.');
    const data = stream.data();
    const reportCount = Number(data.reportCount || 0) + 1;
    transaction.set(reportRef, { reporterId, targetUserId, streamId, reason, status: 'pending', createdAt: Date.now() });
    transaction.update(streamRef, { reportCount, underReview: reportCount >= 3 });
  });
}

export function listenLiveComments(streamId: string, onComments: (comments: LiveComment[]) => void, onError?: (error: Error) => void): Unsubscribe {
  const comments = collection(db, 'liveStreams', streamId, 'comments');
  return onSnapshot(query(comments, orderBy('createdAt', 'asc'), limit(80)), snapshot => {
    onComments(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as LiveComment)));
  }, error => onError?.(error));
}

export async function addLiveComment(streamId: string, comment: Omit<LiveComment, 'id'>): Promise<void> {
  await addDoc(collection(db, 'liveStreams', streamId, 'comments'), comment);
}

export async function deleteLiveComment(streamId: string, commentId: string): Promise<void> {
  await deleteDoc(doc(db, 'liveStreams', streamId, 'comments', commentId));
}

export async function timeoutLiveUser(streamId: string, hostId: string, userId: string, minutes = 10): Promise<void> {
  const expiresAt = Date.now() + Math.max(1, Math.min(minutes, 1440)) * 60_000;
  await setDoc(doc(db, 'liveTimeouts', pairId(streamId, userId)), { streamId, hostId, userId, expiresAt, createdAt: Date.now() });
}

export function listenLiveNotifications(userId: string, onCount: (count: number) => void): Unsubscribe {
  if (!userId) { onCount(0); return () => {}; }
  return onSnapshot(query(collection(db, 'notifications'), where('userId', '==', userId), where('type', '==', 'live_stream'), where('read', '==', false), limit(99)), snapshot => {
    onCount(snapshot.size);
  });
}

export async function markLiveNotificationsRead(userId: string): Promise<void> {
  const snapshot = await getDocs(query(collection(db, 'notifications'), where('userId', '==', userId), where('type', '==', 'live_stream'), where('read', '==', false), limit(450)));
  const unread = snapshot.docs;
  if (!unread.length) return;
  const batch = writeBatch(db);
  unread.slice(0, 450).forEach(item => batch.update(item.ref, { read: true }));
  await batch.commit();
}

export function listenAdminLiveReports(onReports: (reports: Array<{ id: string; reporterId: string; targetUserId: string; streamId?: string; reason: string; createdAt: number; status: string }>) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(100)), snapshot => {
    onReports(snapshot.docs.map(item => ({ id: item.id, ...item.data() } as { id: string; reporterId: string; targetUserId: string; streamId?: string; reason: string; createdAt: number; status: string })).filter(item => item.status === 'pending'));
  }, onError);
}

export async function resolveLiveReport(reportId: string, status: 'reviewed' | 'dismissed'): Promise<void> {
  const reportRef = doc(db, 'reports', reportId);
  const report = await getDoc(reportRef);
  const streamId = report.data()?.streamId;
  await updateDoc(reportRef, { status, reviewedAt: Date.now() });
  if (status === 'dismissed' && typeof streamId === 'string' && streamId) {
    const pending = await getDocs(query(collection(db, 'reports'), where('streamId', '==', streamId)));
    if (!pending.docs.some(item => item.id !== reportId && item.data().status === 'pending')) {
      await updateDoc(doc(db, 'liveStreams', streamId), { underReview: false, reviewedAt: Date.now() });
    }
  }
}

export async function banLiveUser(userId: string): Promise<void> {
  await updateDoc(doc(db, 'users', userId), { isBlocked: true, liveAccess: 'blocked' });
}

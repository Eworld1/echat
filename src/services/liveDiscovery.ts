import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
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
import { db } from './firebase';
import type { LiveComment, LiveStream } from '../types';

export const LIVE_CATEGORIES = ['Church', 'Music', 'Education', 'Market / Selling', 'News', 'Sports', 'Just Chatting'] as const;
export const LIVE_LOCATIONS = ['Freetown', 'Bo', 'Kenema', 'Makeni', 'Other'] as const;
export type LiveReportReason = 'Spam' | 'Harassment' | 'Inappropriate / Sexual Content' | 'Violence' | 'False Information';
export const LIVE_REPORT_REASONS: LiveReportReason[] = ['Spam', 'Harassment', 'Inappropriate / Sexual Content', 'Violence', 'False Information'];

const livesRef = collection(db, 'liveStreams');
const pairId = (first: string, second: string) => `${first}_${second}`;

export function listenLiveStreams(onStreams: (streams: LiveStream[]) => void, onError: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(livesRef, where('isActive', '==', true)), snapshot => {
    const streams = snapshot.docs
      .map(item => ({ ...item.data(), id: item.id } as LiveStream))
      .filter(stream => stream.isActive)
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
    onStreams(streams);
  }, onError);
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

export function listenFollowerCount(userId: string, onCount: (count: number) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'followers'), where('followingId', '==', userId)), snapshot => onCount(snapshot.size));
}

export async function followCreator(followerId: string, followingId: string): Promise<void> {
  if (followerId === followingId) throw new Error('You cannot follow your own account.');
  const [blockedByMe, blockedMe] = await Promise.all([
    getDoc(doc(db, 'blocks', pairId(followerId, followingId))),
    getDoc(doc(db, 'blocks', pairId(followingId, followerId)))
  ]);
  if (blockedByMe.exists() || blockedMe.exists()) throw new Error('Following is unavailable for this account.');
  await setDoc(doc(db, 'followers', pairId(followerId, followingId)), { followerId, followingId, createdAt: Date.now() });
}

export async function unfollowCreator(followerId: string, followingId: string): Promise<void> {
  await deleteDoc(doc(db, 'followers', pairId(followerId, followingId)));
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
  return onSnapshot(query(collection(db, 'notifications'), where('userId', '==', userId)), snapshot => {
    onCount(snapshot.docs.filter(item => item.data().type === 'live_stream' && item.data().read !== true).length);
  });
}

export async function markLiveNotificationsRead(userId: string): Promise<void> {
  const snapshot = await getDocs(query(collection(db, 'notifications'), where('userId', '==', userId)));
  const unread = snapshot.docs.filter(item => item.data().type === 'live_stream' && item.data().read !== true);
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

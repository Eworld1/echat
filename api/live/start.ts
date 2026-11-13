import { randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../../serverless/live.js';
import { applyLiveCors, canStartLive, createRoomToken, firestore, handleError, handleLiveOptions, liveKitUrl, lives, requireLiveKit, sendJson, verifyLiveUser } from '../../serverless/live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  console.info('[Vercel Live API] invocation', { route: '/api/live/start', method: req.method, origin: req.headers.origin || null });
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    if (!canStartLive(user)) return sendJson(res, user.isBlocked || user.liveAccess === 'blocked' ? 403 : 403, { error: user.isBlocked || user.liveAccess === 'blocked' ? 'Your Go Live access is blocked.' : 'Request Go Live access from an administrator first.', code: 'live-access-denied' });
    const liveKit = requireLiveKit();

    const id = `live_${randomUUID()}`;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const categories = ['Church', 'Music', 'Education', 'Market / Selling', 'News', 'Sports', 'Just Chatting'];
    const locations = ['Freetown', 'Bo', 'Kenema', 'Makeni', 'Other'];
    const category = categories.includes(req.body?.category) ? req.body.category : 'Just Chatting';
    const location = locations.includes(req.body?.location) ? req.body.location : '';
    if (!location) return sendJson(res, 400, { error: 'Choose a location before starting your live broadcast.', code: 'live-location-required' });
    const roomName = `echat-${user.uid}-${randomUUID().slice(0, 8)}`;
    await liveKit.rooms.createRoom({ name: roomName, emptyTimeout: 60, maxParticipants: 10000 });
    const liveKitToken = await createRoomToken(user, roomName, true);
    const live = {
      id,
      hostId: user.uid,
      hostName: user.name,
      hostAvatar: user.avatar,
      hostEmail: user.email,
      isHostVerified: user.isVerified,
      title: title || `${user.name} is Live on EChat!`,
      category,
      location,
      reportCount: 0,
      underReview: false,
      taggedPageIds: Array.isArray(req.body?.taggedPageIds) ? req.body.taggedPageIds.filter((value: unknown): value is string => typeof value === 'string').slice(0, 22) : [],
      viewersCount: 1,
      reactionsCount: 0,
      startedAt: Date.now(),
      isActive: true,
      comments: [],
      liveKitRoom: roomName
    };
    try {
      await lives.doc(id).create(live);
    } catch (error) {
      await liveKit.rooms.deleteRoom(roomName).catch(() => {});
      throw error;
    }
    try {
      const [followers, blocksByHost, blocksAgainstHost] = await Promise.all([
        firestore.collection('followers').where('followingId', '==', user.uid).limit(450).get(),
        firestore.collection('blocks').where('blockerId', '==', user.uid).get(),
        firestore.collection('blocks').where('blockedId', '==', user.uid).get()
      ]);
      const blockedIds = new Set([...blocksByHost.docs, ...blocksAgainstHost.docs].flatMap(item => {
        const data = item.data();
        return data.blockerId === user.uid ? [String(data.blockedId || '')] : data.blockedId === user.uid ? [String(data.blockerId || '')] : [];
      }));
      const batch = firestore.batch();
      for (const follower of followers.docs) {
        const followerId = String(follower.data().followerId || '');
        if (!followerId || blockedIds.has(followerId)) continue;
        const notification = firestore.collection('notifications').doc();
        batch.set(notification, { userId: followerId, actorId: user.uid, type: 'live_stream', targetId: id, message: `${user.name} is live: ${live.title}`, read: false, createdAt: Date.now() });
      }
      await batch.commit();
    } catch (error) {
      console.warn('[Vercel Live API] Follower notifications could not be delivered', error instanceof Error ? error.message : 'unknown error');
    }
    return sendJson(res, 200, { success: true, live, liveKitUrl, liveKitToken });
  } catch (error) {
    return handleError(res, error, 'start');
  }
}

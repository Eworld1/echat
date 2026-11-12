import { randomUUID } from 'node:crypto';
import type { ApiRequest, ApiResponse } from '../_live.js';
import { canStartLive, createRoomToken, firestore, handleError, liveKitUrl, lives, requireLiveKit, sendJson, verifyLiveUser } from '../_live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    if (!canStartLive(user)) return sendJson(res, user.isBlocked || user.liveAccess === 'blocked' ? 403 : 403, { error: user.isBlocked || user.liveAccess === 'blocked' ? 'Your Go Live access is blocked.' : 'Request Go Live access from an administrator first.', code: 'live-access-denied' });
    const liveKit = requireLiveKit();
    const active = await lives.where('isActive', '==', true).limit(1).get();
    if (!active.empty) return sendJson(res, 409, { error: 'A live broadcast is already in progress.', code: 'live-already-active' });

    const id = `live_${randomUUID()}`;
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
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
    return sendJson(res, 200, { success: true, live, liveKitUrl, liveKitToken });
  } catch (error) {
    return handleError(res, error, 'start');
  }
}

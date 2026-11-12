import type { ApiRequest, ApiResponse } from '../_live.js';
import { canStartLive, createRoomToken, handleError, liveKitUrl, lives, sendJson, verifyLiveUser } from '../_live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    if (!canStartLive(user)) return sendJson(res, 403, { error: user.isBlocked || user.liveAccess === 'blocked' ? 'Your Go Live access is blocked.' : 'Request Go Live access from an administrator first.', code: 'live-access-denied' });
    const streamId = typeof req.body?.streamId === 'string' ? req.body.streamId : '';
    const doc = await lives.doc(streamId).get();
    const live = doc.data();
    if (!doc.exists || !live?.isActive || live.hostId !== user.uid || !live.liveKitRoom) return sendJson(res, 404, { error: 'Your active live broadcast was not found.', code: 'live-not-found' });
    return sendJson(res, 200, { url: liveKitUrl, token: await createRoomToken(user, String(live.liveKitRoom), true) });
  } catch (error) {
    return handleError(res, error, 'publish');
  }
}

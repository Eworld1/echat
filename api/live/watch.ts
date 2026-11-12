import type { ApiRequest, ApiResponse } from '../_live.js';
import type { RemoteTrack } from 'livekit-client';
import { createRoomToken, handleError, liveKitUrl, lives, sendJson, verifyLiveUser } from '../_live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const streamId = String(req.query?.streamId || '');
    const doc = await lives.doc(streamId).get();
    const live = doc.data();
    if (!doc.exists || !live?.isActive || !live.liveKitRoom) return sendJson(res, 404, { error: 'This live stream has ended.', code: 'live-not-found' });
    const token = await createRoomToken(user, String(live.liveKitRoom), false);
    return sendJson(res, 200, { url: liveKitUrl, token });
  } catch (error) {
    return handleError(res, error, 'watch');
  }
}

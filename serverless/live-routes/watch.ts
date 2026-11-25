import type { ApiRequest, ApiResponse } from '../live.js';
import { createRoomToken, firestore, handleError, hostLiveRef, isHeartbeatStale, liveKitUrl, lives, sendJson, verifyLiveUser } from '../live.js';

/**
 * GET /api/live/watch?hostId=…  (or legacy ?streamId=…)
 * Viewers join by HOST: the server looks up lives/{hostId} and hands out a token for the host's
 * CURRENT room — never an old stream id saved on a card. Ended or silent (no heartbeat for 30 s)
 * lives answer 404 "live-not-found" so the app shows Live Ended.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const hostId = String(req.query?.hostId || '');
    let streamId = String(req.query?.streamId || '');
    if (hostId) {
      const pointer = await hostLiveRef(hostId).get();
      const data = pointer.data();
      if (pointer.exists) {
        if (data?.status !== 'live' || isHeartbeatStale(data)) return sendJson(res, 404, { error: 'This live stream has ended.', code: 'live-not-found' });
        streamId = String(data.streamId || '');
      }
    }
    const doc = streamId ? await lives.doc(streamId).get() : null;
    const live = doc?.data();
    if (!doc?.exists || !live?.isActive || !live.liveKitRoom || isHeartbeatStale(live)) return sendJson(res, 404, { error: 'This live stream has ended.', code: 'live-not-found' });
    if (live.hostId !== user.uid) {
      const [hostBlockedViewer, viewerBlockedHost, viewerProfile] = await Promise.all([
        firestore.collection('blocks').doc(`${live.hostId}_${user.uid}`).get(),
        firestore.collection('blocks').doc(`${user.uid}_${live.hostId}`).get(),
        firestore.collection('users').doc(user.uid).get()
      ]);
      if (hostBlockedViewer.exists || viewerBlockedHost.exists || viewerProfile.data()?.isBlocked === true) {
        return sendJson(res, 403, { error: 'You cannot view this live stream.', code: 'live-view-blocked' });
      }
    }
    const token = await createRoomToken(user, String(live.liveKitRoom), false);
    return sendJson(res, 200, { url: liveKitUrl, token, streamId: doc.id });
  } catch (error) {
    return handleError(res, error, 'watch');
  }
}

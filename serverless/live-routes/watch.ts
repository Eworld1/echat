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
    // lives/{hostId} decides: its CURRENT streamId and room (the same document the feed card shows).
    let live: Record<string, any> | undefined;
    if (hostId) {
      const pointer = await hostLiveRef(hostId).get();
      const data = pointer.data();
      if (pointer.exists && data) {
        if (data.status !== 'live') return sendJson(res, 404, { error: 'This live stream has ended.', code: 'live-not-found' });
        if (isHeartbeatStale(data)) return sendJson(res, 503, { error: 'The host is reconnecting. Retrying…', code: 'host-reconnecting' });
        streamId = String(data.streamId || '');
        if (data.liveKitRoom) live = { hostId, liveKitRoom: data.liveKitRoom };
      }
    }
    if (!live) {
      const doc = streamId ? await lives.doc(streamId).get() : null;
      const data = doc?.data();
      if (!doc?.exists || !data?.isActive || !data.liveKitRoom || isHeartbeatStale(data)) return sendJson(res, 404, { error: 'This live stream has ended.', code: 'live-not-found' });
      live = data;
    }
    console.info('[Vercel Live API] watch', { hostId: live.hostId, streamId, roomName: live.liveKitRoom });
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
    return sendJson(res, 200, { url: liveKitUrl, token, streamId, roomName: live.liveKitRoom });
  } catch (error) {
    return handleError(res, error, 'watch');
  }
}

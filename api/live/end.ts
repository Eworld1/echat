import type { ApiRequest, ApiResponse } from '../_live.js';
import { handleError, lives, requireLiveKit, sendJson, verifyLiveUser } from '../_live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const streamId = typeof req.body?.streamId === 'string' ? req.body.streamId : '';
    const snapshot = streamId ? await lives.doc(streamId).get() : await lives.where('hostId', '==', user.uid).where('isActive', '==', true).limit(1).get().then(result => result.docs[0]);
    if (!snapshot?.exists) return sendJson(res, 404, { error: 'Active live stream not found.', code: 'live-not-found' });
    const data = snapshot.data() || {};
    if (data.hostId !== user.uid && user.role !== 'super_admin') return sendJson(res, 403, { error: 'You cannot end another user’s live stream.', code: 'not-live-host' });
    const liveKitRoom = String(data.liveKitRoom || '');
    if (liveKitRoom) {
      const liveKit = requireLiveKit();
      await liveKit.rooms.deleteRoom(liveKitRoom).catch(error => {
        console.warn('[Vercel Live API] LiveKit room cleanup failed', error);
      });
    }
    await snapshot.ref.update({ isActive: false, endedAt: Date.now() });
    return sendJson(res, 200, { success: true, live: { ...data, isActive: false, endedAt: Date.now() } });
  } catch (error) {
    return handleError(res, error, 'end');
  }
}

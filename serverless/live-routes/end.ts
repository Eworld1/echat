import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, endBroadcast, endHostLive, handleError, handleLiveOptions, hostLiveRef, lives, sendJson, verifyLiveUser } from '../live.js';

/**
 * POST /api/live/end { streamId? }
 * Ends the broadcast everywhere at once: LiveKit room closed, liveStreams/{streamId} inactive and
 * lives/{hostId} status 'ended' — every viewer's card disappears and open players show Live Ended.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  console.info('[Vercel Live API] invocation', { route: '/api/live/end', method: req.method, origin: req.headers.origin || null });
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    let streamId = typeof body?.streamId === 'string' ? body.streamId : '';
    if (!streamId) {
      const pointer = await hostLiveRef(user.uid).get();
      streamId = pointer.data()?.status === 'live' ? String(pointer.data()?.streamId || '') : '';
    }
    const snapshot = streamId ? await lives.doc(streamId).get() : await lives.where('hostId', '==', user.uid).where('isActive', '==', true).limit(1).get().then(result => result.docs[0]);
    if (!snapshot?.exists) {
      await endHostLive(user.uid, null, 'host');
      return sendJson(res, 200, { success: true, live: null });
    }
    const data = snapshot.data() || {};
    const isAdmin = user.role === 'super_admin' || user.role === 'admin' || user.role === 'developer' || Boolean(user.isAdmin);
    if (data.hostId !== user.uid && !isAdmin) return sendJson(res, 403, { error: 'You cannot end another user’s live stream.', code: 'not-live-host' });
    const reason = data.hostId === user.uid ? 'host' : 'admin';
    await endBroadcast(snapshot.id, String(data.liveKitRoom || ''), reason);
    return sendJson(res, 200, { success: true, live: { ...data, id: snapshot.id, isActive: false, endedAt: Date.now() } });
  } catch (error) {
    return handleError(res, error, 'end');
  }
}

function safeJson(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value); } catch { return null; }
}

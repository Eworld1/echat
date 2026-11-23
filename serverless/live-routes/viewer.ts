import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, handleError, handleLiveOptions, lives, recountLiveViewers, sendJson, verifyLiveUser } from '../live.js';

/**
 * POST /api/live/viewer/join and /api/live/viewer/leave  { streamId }
 * One presence doc per viewer (liveStreams/{id}/viewers/{uid}), so refreshes never double-count.
 * The host is not counted as a viewer. LiveKit's participant_left webhook also removes stale viewers.
 */
export function viewerPresence(action: 'join' | 'leave') {
  return async function handler(req: ApiRequest, res: ApiResponse) {
    applyLiveCors(req, res);
    if (handleLiveOptions(req, res)) return;
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
    try {
      const { user } = await verifyLiveUser(req);
      const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
      const streamId = typeof body?.streamId === 'string' ? body.streamId : '';
      if (!streamId) return sendJson(res, 400, { error: 'streamId is required.', code: 'stream-id-required' });
      const ref = lives.doc(streamId);
      const snapshot = await ref.get();
      if (!snapshot.exists) return sendJson(res, 404, { error: 'This live stream was not found.', code: 'live-not-found' });
      const live = snapshot.data() || {};
      if (action === 'join' && live.isActive !== true) return sendJson(res, 410, { error: 'This live has ended.', code: 'live-ended' });
      if (live.hostId === user.uid) return sendJson(res, 200, { success: true, viewersCount: Number(live.viewersCount || 0) });
      const viewer = ref.collection('viewers').doc(user.uid);
      if (action === 'join') await viewer.set({ uid: user.uid, name: user.name, joinedAt: Date.now() });
      else await viewer.delete();
      const viewersCount = await recountLiveViewers(streamId);
      return sendJson(res, 200, { success: true, viewersCount });
    } catch (error) {
      return handleError(res, error, `viewer-${action}`);
    }
  };
}

function safeJson(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value); } catch { return null; }
}

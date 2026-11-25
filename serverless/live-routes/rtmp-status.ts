import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, handleError, handleLiveOptions, hostLiveRef, hostLiveToStream, sendJson, verifyLiveUid } from '../live.js';
import { syncRtmpLives } from '../rtmp-sync.js';

/**
 * GET /api/live/rtmp-status — polled every 3 s by the host's Streaming Software tab.
 * Asks LiveKit whether THIS user's ingress is receiving their OBS stream right now and makes
 * Firestore match (starting OBS = going live; stopping OBS = Live Ended). No webhook needed.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const uid = await verifyLiveUid(req);
    const states = await syncRtmpLives(uid);
    const pointer = (await hostLiveRef(uid).get()).data();
    const live = pointer?.status === 'live' && pointer.source === 'rtmp' ? hostLiveToStream(uid, pointer) : null;
    const status = states.find(state => state.publishing)?.status ?? states[0]?.status ?? 0;
    return sendJson(res, 200, {
      publishing: states.some(state => state.publishing),
      // 0 waiting · 1 receiving (buffering) · 2 publishing · 3 error · 4 finished
      ingressStatus: status,
      hasIngress: states.length > 0,
      // You tapped End Live while the app kept streaming: stop it in the app, then start again.
      held: pointer?.holdUntilOffAir === true && states.some(state => state.publishing),
      live
    });
  } catch (error) {
    return handleError(res, error, 'rtmp-status');
  }
}

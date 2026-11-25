import type { ApiRequest, ApiResponse } from '../live.js';
import { firestore, handleError, hostLiveToStream, isHeartbeatStale, liveConfigStatus, sendJson, sweepStaleLives } from '../live.js';
import { syncAllRtmpLivesThrottled } from '../rtmp-sync.js';

/**
 * GET /api/live/current[?id=<hostId or streamId>]
 * The newest live that is really on air (lives/{hostId}, status 'live', fresh heartbeat), or the
 * one asked for by host id / stream id (share links). Also ends lives whose host went silent.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    await sweepStaleLives().catch(error => console.warn('[Vercel Live API] stale sweep failed', error instanceof Error ? error.message : error));
    // Streaming software lives: confirm with LiveKit which ingresses are on air (works without the webhook).
    if (liveConfigStatus().ready) await syncAllRtmpLivesThrottled().catch(error => console.warn('[Vercel Live API] RTMP sync failed', error instanceof Error ? error.message : error));
    const id = String(req.query?.id || '').trim();
    const result = await firestore.collection('lives').where('status', '==', 'live').get();
    const onAir = result.docs
      .map(doc => ({ hostId: doc.id, data: doc.data() }))
      .filter(item => !isHeartbeatStale(item.data))
      .sort((a, b) => Number(b.data.startedAt || 0) - Number(a.data.startedAt || 0));
    const match = id ? onAir.find(item => item.hostId === id || item.data.streamId === id) : onAir[0];
    return sendJson(res, 200, { live: match ? hostLiveToStream(match.hostId, match.data) : null });
  } catch (error) {
    return handleError(res, error, 'current');
  }
}

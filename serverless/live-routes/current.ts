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
    // ?all=1: every live on air (server-confirmed list the app merges with its realtime listener).
    const all = req.query?.all ? onAir.map(item => hostLiveToStream(item.hostId, item.data)) : undefined;
    // ?id=: the player asks about ONE host. Report its exact state so it never guesses "ended":
    // status 'live' (even if the heartbeat is late), 'ended' (with endedAt), or 'missing'.
    let state: Record<string, unknown> = {};
    if (id) {
      let pointer = await firestore.collection('lives').doc(id).get();
      if (!pointer.exists) pointer = (await firestore.collection('lives').where('streamId', '==', id).limit(1).get()).docs[0] || pointer;
      const data = pointer.exists ? pointer.data() || {} : null;
      if (data) {
        state = { hostId: pointer.id, status: data.status === 'live' ? 'live' : 'ended', endedAt: data.endedAt || null, stale: data.status === 'live' && isHeartbeatStale(data), current: data.status === 'live' ? hostLiveToStream(pointer.id, data) : null };
      } else {
        // Lives from before lives/{hostId} existed: the per-stream record.
        const legacy = await firestore.collection('liveStreams').doc(id).get();
        const legacyData = legacy.data();
        state = legacy.exists
          ? { hostId: legacyData?.hostId, status: legacyData?.isActive === true ? 'live' : 'ended', endedAt: legacyData?.endedAt || null, stale: false, current: legacyData?.isActive === true ? { ...legacyData, id: legacy.id } : null }
          : { status: 'missing', endedAt: null, stale: false, current: null };
      }
    }
    return sendJson(res, 200, { live: match ? hostLiveToStream(match.hostId, match.data) : (state.current as unknown) || null, ...(all ? { lives: all } : {}), ...(id ? { state: { status: state.status, endedAt: state.endedAt, stale: state.stale, hostId: state.hostId } } : {}) });
  } catch (error) {
    return handleError(res, error, 'current');
  }
}

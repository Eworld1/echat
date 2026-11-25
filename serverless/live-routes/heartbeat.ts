import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, handleError, handleLiveOptions, hostLiveRef, lives, sendJson, sweepStaleLives, verifyLiveUid } from '../live.js';

/**
 * POST /api/live/heartbeat { streamId } — sent by the host's app every 10 seconds while live.
 * Viewers hide a live whose heartbeat is older than 30 s; the server ends it after 2 minutes.
 * Answers 410 when this stream is no longer the host's live (ended elsewhere or timed out).
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const uid = await verifyLiveUid(req);
    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    const streamId = typeof body?.streamId === 'string' ? body.streamId : '';
    if (!streamId) return sendJson(res, 400, { error: 'streamId is required.', code: 'stream-id-required' });
    const pointer = hostLiveRef(uid);
    const [current, stream] = await Promise.all([pointer.get(), lives.doc(streamId).get()]);
    if (current.data()?.status !== 'live' || current.data()?.streamId !== streamId || stream.data()?.isActive !== true) {
      return sendJson(res, 410, { error: 'This live has ended.', code: 'live-ended' });
    }
    const now = Date.now();
    await Promise.all([pointer.update({ updatedAt: now }), stream.ref.update({ heartbeatAt: now })]);
    await sweepStaleLives().catch(error => console.warn('[Vercel Live API] stale sweep failed', error instanceof Error ? error.message : error));
    return sendJson(res, 200, { success: true, updatedAt: now });
  } catch (error) {
    return handleError(res, error, 'heartbeat');
  }
}

function safeJson(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value); } catch { return null; }
}

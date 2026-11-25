import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, handleError, handleLiveOptions, hostLiveRef, lives, sendJson, verifyLiveUid } from '../live.js';

/**
 * POST /api/live/like { streamId, value: 1 | -1 | 0 }  (1 = like, -1 = dislike, 0 = remove)
 * One vote per viewer per live (liveStreams/{id}/likes/{uid}); counts are recounted and stored on
 * the live (likesCount / dislikesCount) so everyone watching sees them change in real time.
 * GET /api/live/like?streamId=… → my vote + counts.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST' && req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const uid = await verifyLiveUid(req);
    const body = typeof req.body === 'string' ? safeJson(req.body) : req.body;
    const streamId = String((req.method === 'GET' ? req.query?.streamId : body?.streamId) || '');
    if (!streamId) return sendJson(res, 400, { error: 'streamId is required.', code: 'stream-id-required' });
    const ref = lives.doc(streamId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return sendJson(res, 404, { error: 'This live was not found.', code: 'live-not-found' });
    const vote = ref.collection('likes').doc(uid);
    if (req.method === 'POST') {
      const value = Number(body?.value);
      if (![1, -1, 0].includes(value)) return sendJson(res, 400, { error: 'value must be 1, -1 or 0.', code: 'bad-value' });
      if (value === 0) await vote.delete();
      else await vote.set({ uid, value, at: Date.now() });
    }
    const [likes, dislikes, mine] = await Promise.all([
      ref.collection('likes').where('value', '==', 1).count().get(),
      ref.collection('likes').where('value', '==', -1).count().get(),
      vote.get()
    ]);
    const likesCount = likes.data().count;
    const dislikesCount = dislikes.data().count;
    if (req.method === 'POST') {
      await ref.update({ likesCount, dislikesCount });
      const hostId = String(snapshot.data()?.hostId || '');
      const pointer = hostId ? await hostLiveRef(hostId).get() : null;
      if (pointer?.exists && pointer.data()?.streamId === streamId) await pointer.ref.update({ likeCount: likesCount });
    }
    return sendJson(res, 200, { success: true, myVote: Number(mine.data()?.value || 0), likesCount, dislikesCount });
  } catch (error) {
    return handleError(res, error, 'like');
  }
}

function safeJson(value: string): Record<string, unknown> | null {
  try { return JSON.parse(value); } catch { return null; }
}

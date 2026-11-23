import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, handleError, handleLiveOptions, lives, sendJson, verifyLiveUser } from '../live.js';

const ALLOWED_REACTIONS = ['❤️', '👍', '🔥', '😂', '😮', '👏'];

/**
 * POST /api/live/react  { streamId, emoji, count }
 * Clients batch taps (count ≤ 20) so a burst of hearts is one request. Everyone watching sees the
 * hearts through the live document's reactionsCount / lastReaction fields (Firestore realtime).
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const streamId = typeof req.body?.streamId === 'string' ? req.body.streamId : '';
    const emoji = ALLOWED_REACTIONS.includes(req.body?.emoji) ? req.body.emoji : '❤️';
    const count = Math.max(1, Math.min(20, Math.floor(Number(req.body?.count) || 1)));
    const ref = lives.doc(streamId);
    const snapshot = streamId ? await ref.get() : null;
    if (!snapshot?.exists || snapshot.data()?.isActive !== true) return sendJson(res, 410, { error: 'This live has ended.', code: 'live-ended' });
    // Loaded lazily like serverless/live.ts, so a missing optional Firestore package can never
    // break the other live routes at module load.
    const { FieldValue } = await import('firebase-admin/firestore');
    await ref.update({
      reactionsCount: FieldValue.increment(count),
      lastReaction: { emoji, count, userId: user.uid, at: Date.now() }
    });
    return sendJson(res, 200, { success: true });
  } catch (error) {
    return handleError(res, error, 'react');
  }
}

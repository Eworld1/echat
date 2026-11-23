import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, sendJson, verifyLiveUser, LIVE_CATEGORY_VALUES, LIVE_LOCATION_VALUES } from '../live.js';

/**
 * GET/POST /api/live/rtmp-details — title, category and location used when this user's
 * streaming-software (RTMP) broadcast goes live. Stored on the private users/{uid} profile.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const ref = firestore.collection('users').doc(user.uid);
    if (req.method === 'GET') {
      const saved = (await ref.get()).data()?.rtmpStreamDetails || {};
      return sendJson(res, 200, { title: String(saved.title || ''), category: String(saved.category || 'Just Chatting'), location: String(saved.location || '') });
    }
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : '';
    const category = LIVE_CATEGORY_VALUES.includes(req.body?.category) ? req.body.category : 'Just Chatting';
    const location = LIVE_LOCATION_VALUES.includes(req.body?.location) ? req.body.location : '';
    const details = { title, category, location, updatedAt: Date.now() };
    await ref.set({ rtmpStreamDetails: details }, { merge: true });
    return sendJson(res, 200, { success: true, ...details });
  } catch (error) {
    return handleError(res, error, 'rtmp-details');
  }
}

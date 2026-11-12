import type { ApiRequest, ApiResponse } from '../_live.js';
import { handleError, lives, sendJson } from '../_live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const result = await lives.where('isActive', '==', true).limit(1).get();
    const doc = result.docs[0];
    return sendJson(res, 200, { live: doc ? { ...doc.data(), id: doc.id } : null });
  } catch (error) {
    return handleError(res, error, 'current');
  }
}

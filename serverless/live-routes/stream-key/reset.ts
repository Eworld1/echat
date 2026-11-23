import type { ApiRequest, ApiResponse } from '../../live.js';
import { applyLiveCors, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../live.js';
import { resetLiveStreamIngress } from '../../live-stream-key.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user } = await verifyLiveUser(req);
    const ingress = await resetLiveStreamIngress(user.uid);
    return sendJson(res, 200, { success: true, ...ingress });
  } catch (error) {
    return handleError(res, error, 'stream-key-reset');
  }
}

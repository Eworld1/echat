import type { ApiRequest, ApiResponse } from '../../serverless/live.js';
import { handleError, sendJson, verifyLiveUser } from '../../serverless/live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  try {
    const { user, decoded } = await verifyLiveUser(req);
    const firebaseToken = req.headers['x-firebase-id-token'] || req.headers['x-live-auth-token'] || req.headers.authorization?.toString().replace(/^Bearer\s+/i, '') || '';
    return sendJson(res, 200, { liveAuthToken: firebaseToken, userId: user.uid, role: user.role, liveAccess: user.liveAccess, emailVerified: Boolean(decoded.email_verified) });
  } catch (error) {
    return handleError(res, error, 'auth');
  }
}

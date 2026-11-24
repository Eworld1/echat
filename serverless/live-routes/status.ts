import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, checkLiveKitCredentials, handleLiveOptions, liveConfigStatus, sendJson } from '../live.js';

/** GET /api/live/status — which live settings are configured (booleans only, never secret values). */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  const host = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : req.headers.host || '';
  const config = liveConfigStatus();
  // Only test the keys when all three are present, so a missing variable is reported as missing.
  const liveKitCheck = config.liveKitUrl && config.liveKitApiKey && config.liveKitApiSecret ? await checkLiveKitCredentials() : null;
  return sendJson(res, 200, { ...config, liveKitAuthOk: liveKitCheck ? liveKitCheck.ok : null, liveKitError: liveKitCheck?.ok === false ? liveKitCheck.error : '', webhookUrl: host ? `https://${host}/api/live/webhook` : '/api/live/webhook' });
}

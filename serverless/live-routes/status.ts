import type { ApiRequest, ApiResponse } from '../live.js';
import { applyLiveCors, handleLiveOptions, liveConfigStatus, sendJson } from '../live.js';

/** GET /api/live/status — which live settings are configured (booleans only, never secret values). */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  const host = typeof req.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'] : req.headers.host || '';
  return sendJson(res, 200, { ...liveConfigStatus(), webhookUrl: host ? `https://${host}/api/live/webhook` : '/api/live/webhook' });
}

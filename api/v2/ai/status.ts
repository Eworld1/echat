import type { ApiRequest, ApiResponse } from '../../../serverless/live.js';
import { applyLiveCors, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../../serverless/live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
  try {
    const { user } = await verifyLiveUser(req);
    if (user.role !== 'super_admin') return sendJson(res, 403, { error: 'Super-admin access required.' });
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return sendJson(res, 200, { openAiConnected: false, fallbackMode: true });
    try {
      const response = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(5000)
      });
      return sendJson(res, 200, { openAiConnected: response.ok, fallbackMode: true });
    } catch {
      return sendJson(res, 200, { openAiConnected: false, fallbackMode: true });
    }
  } catch (error) {
    return handleError(res, error, 'v2-ai-status');
  }
}

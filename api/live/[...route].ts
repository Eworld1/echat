import type { ApiRequest, ApiResponse } from '../../serverless/live.js';
import { applyLiveCors, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../serverless/live.js';
import auth from '../../serverless/live-routes/auth.js';
import current from '../../serverless/live-routes/current.js';
import end from '../../serverless/live-routes/end.js';
import publish from '../../serverless/live-routes/publish.js';
import start from '../../serverless/live-routes/start.js';
import watch from '../../serverless/live-routes/watch.js';
import { getOrCreateLiveStreamIngress, resetLiveStreamIngress } from '../../serverless/live-stream-key.js';

async function handleStreamKey(req: ApiRequest, res: ApiResponse, reset = false): Promise<void> {
  applyLiveCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (handleLiveOptions(req, res)) return;
  const expectedMethod = reset ? 'POST' : 'GET';
  if (req.method !== expectedMethod) {
    return sendJson(res, 405, { error: 'Method not allowed', code: 'method-not-allowed' });
  }
  try {
    const { user } = await verifyLiveUser(req);
    const ingress = reset
      ? await resetLiveStreamIngress(user.uid)
      : await getOrCreateLiveStreamIngress(user.uid);
    return sendJson(res, 200, { success: true, ...ingress });
  } catch (error) {
    return handleError(res, error, reset ? 'stream-key-reset' : 'stream-key');
  }
}

const handlers: Record<string, (req: ApiRequest, res: ApiResponse) => Promise<void>> = {
  auth,
  current,
  end,
  publish,
  start,
  watch
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const route = Array.isArray(req.query?.route) ? req.query.route.join('/') : String(req.query?.route || '');
  if (route === 'stream-key') return handleStreamKey(req, res);
  if (route === 'stream-key/reset') return handleStreamKey(req, res, true);
  const routeHandler = handlers[route];
  if (!routeHandler) return sendJson(res, 404, { error: 'Not found.' });
  return routeHandler(req, res);
}

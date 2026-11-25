import type { ApiRequest, ApiResponse } from '../../serverless/live.js';
import { applyLiveCors, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../serverless/live.js';
import auth from '../../serverless/live-routes/auth.js';
import current from '../../serverless/live-routes/current.js';
import end from '../../serverless/live-routes/end.js';
import heartbeat from '../../serverless/live-routes/heartbeat.js';
import publish from '../../serverless/live-routes/publish.js';
import react from '../../serverless/live-routes/react.js';
import rtmpDetails from '../../serverless/live-routes/rtmp-details.js';
import rtmpStatus from '../../serverless/live-routes/rtmp-status.js';
import start from '../../serverless/live-routes/start.js';
import status from '../../serverless/live-routes/status.js';
import { viewerPresence } from '../../serverless/live-routes/viewer.js';
import watch from '../../serverless/live-routes/watch.js';
import webhook from '../../serverless/live-routes/webhook.js';
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
  heartbeat,
  publish,
  react,
  'rtmp-details': rtmpDetails,
  'rtmp-status': rtmpStatus,
  start,
  status,
  'viewer/join': viewerPresence('join'),
  'viewer/leave': viewerPresence('leave'),
  watch,
  webhook,
  'stream-key': (req, res) => handleStreamKey(req, res),
  'stream-key/reset': (req, res) => handleStreamKey(req, res, true)
};

/**
 * Work out which /api/live/<route> was requested.
 * The URL path is the reliable source: outside Next.js, Vercel does not always fill
 * req.query.route for catch-all files (it may be missing or named "...route"), which
 * previously made every live call answer "Not found.". The query value is a fallback for
 * platforms that hand the function a rewritten URL such as /api/live/[...route]?route=start.
 */
export function resolveLiveRoute(req: Pick<ApiRequest, 'url' | 'query'>): string {
  const candidates: string[] = [];
  const pathname = String(req.url || '').split('?')[0] || '';
  const match = /\/api\/live\/(.+)$/.exec(pathname);
  if (match) {
    let value = match[1];
    try { value = decodeURIComponent(value); } catch { /* keep raw */ }
    candidates.push(value.replace(/\/+$/, ''));
  }
  const query = req.query || {};
  for (const raw of [query.route, query['...route']]) {
    if (raw) candidates.push((Array.isArray(raw) ? raw.join('/') : String(raw)).replace(/^\/+|\/+$/g, ''));
  }
  return candidates.find(route => route in handlers) || candidates[0] || '';
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const route = resolveLiveRoute(req);
  const routeHandler = handlers[route];
  if (!routeHandler) {
    applyLiveCors(req, res);
    return sendJson(res, 404, { error: `Unknown live API route "/api/live/${route}".`, code: 'live-route-not-found' });
  }
  return routeHandler(req, res);
}

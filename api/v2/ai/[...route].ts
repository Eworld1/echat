import type { ApiRequest, ApiResponse } from '../../../serverless/live.js';
import { sendJson } from '../../../serverless/live.js';
import chat from '../../../serverless/ai-routes/chat.js';
import chats from '../../../serverless/ai-routes/chats.js';
import chatHistory from '../../../serverless/ai-routes/chats/chat.js';
import fallback from '../../../serverless/ai-routes/fallback.js';
import status from '../../../serverless/ai-routes/status.js';

const handlers: Record<string, (req: ApiRequest, res: ApiResponse) => Promise<void>> = {
  chat,
  chats,
  fallback,
  status
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const path = Array.isArray(req.query?.route) ? req.query.route : [req.query?.route || ''];
  const route = path.join('/');
  if (path.length === 2 && path[0] === 'chats' && path[1]) {
    req.query = { ...req.query, chatId: path[1] };
    return chatHistory(req, res);
  }
  const routeHandler = handlers[route];
  if (!routeHandler) return sendJson(res, 404, { error: 'Not found.' });
  return routeHandler(req, res);
}

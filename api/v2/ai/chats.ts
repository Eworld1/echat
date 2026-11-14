import type { ApiRequest, ApiResponse } from '../../../serverless/live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../../serverless/live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  try {
    const { user } = await verifyLiveUser(req);
    const chats = firestore.collection('users').doc(user.uid).collection('v2AiChats');
    if (req.method === 'GET') {
      const snapshot = await chats.orderBy('updatedAt', 'desc').limit(50).get();
      return sendJson(res, 200, { chats: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    const now = Date.now();
    const chat = { title: 'New chat', createdAt: now, updatedAt: now, ownerId: user.uid };
    const created = await chats.add(chat);
    return sendJson(res, 201, { chat: { id: created.id, ...chat } });
  } catch (error) { return handleError(res, error, 'v2-ai-chats'); }
}

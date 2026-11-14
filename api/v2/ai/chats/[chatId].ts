import type { ApiRequest, ApiResponse } from '../../../../serverless/live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../../../serverless/live.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  try {
    const { user } = await verifyLiveUser(req);
    const chatId = String(req.query?.chatId || '').trim();
    if (!chatId) return sendJson(res, 400, { error: 'Chat ID is required.' });
    const chatRef = firestore.collection('users').doc(user.uid).collection('v2AiChats').doc(chatId);
    const chat = await chatRef.get();
    if (!chat.exists) return sendJson(res, 404, { error: 'Chat not found.' });
    if (req.method === 'GET') {
      const messages = await chatRef.collection('messages').orderBy('createdAt', 'asc').limit(100).get();
      return sendJson(res, 200, { chat: { id: chatId, ...chat.data() }, messages: messages.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
    }
    if (req.method === 'PATCH') {
      const messageId = String(req.body?.messageId || '').trim();
      if (messageId) {
        const feedback = req.body?.feedback;
        if (feedback !== 'like' && feedback !== 'dislike') return sendJson(res, 400, { error: 'Invalid feedback value.' });
        const messageRef = chatRef.collection('messages').doc(messageId);
        const message = await messageRef.get();
        if (!message.exists || message.data()?.role !== 'assistant') return sendJson(res, 404, { error: 'Assistant response not found.' });
        await messageRef.set({ feedback }, { merge: true });
        return sendJson(res, 200, { success: true });
      }
      const title = String(req.body?.title || '').trim().slice(0, 80);
      if (!title) return sendJson(res, 400, { error: 'Chat title cannot be empty.' });
      await chatRef.set({ title, updatedAt: Date.now() }, { merge: true });
      return sendJson(res, 200, { success: true, title });
    }
    if (req.method === 'DELETE') {
      const messages = await chatRef.collection('messages').get();
      const batch = firestore.batch();
      messages.docs.forEach(doc => batch.delete(doc.ref));
      batch.delete(chatRef);
      await batch.commit();
      return sendJson(res, 200, { success: true });
    }
    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (error) { return handleError(res, error, 'v2-ai-chat-history'); }
}

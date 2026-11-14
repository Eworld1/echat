import type { ApiRequest, ApiResponse } from '../../../serverless/live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../../serverless/live.js';
import { offlineAnswer } from '../../../src/utils/echatAiFallback.js';

type ChatMessage = { role: 'user' | 'assistant'; content: string; createdAt: number };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'That request could not be completed. Please try again.' });
  try {
    const { user } = await verifyLiveUser(req);
    const chatId = String(req.body?.chatId || '').trim();
    const prompt = String(req.body?.message || '').trim().slice(0, 8000);
    const messageId = String(req.body?.clientMessageId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100);
    if (!chatId || !prompt || !messageId) return sendJson(res, 400, { error: 'Add a message and try again.' });
    const chatRef = firestore.collection('users').doc(user.uid).collection('v2AiChats').doc(chatId);
    const chat = await chatRef.get();
    if (!chat.exists) return sendJson(res, 404, { error: 'This conversation could not be found. Start a new chat and try again.' });
    const historySnapshot = await chatRef.collection('messages').orderBy('createdAt', 'desc').limit(30).get();
    const history = historySnapshot.docs.reverse().map(doc => doc.data() as ChatMessage).filter(message => message.role === 'user' || message.role === 'assistant');
    const answer = offlineAnswer(prompt, history.filter(message => message.content !== prompt));
    const messages = chatRef.collection('messages');
    const now = Date.now();
    await Promise.all([
      messages.doc(messageId).set({ role: 'user', content: prompt, createdAt: now }),
      messages.doc(`assistant_${messageId}`).set({ role: 'assistant', content: answer, createdAt: now + 1 })
    ]);
    const oldTitle = String(chat.data()?.title || 'New chat');
    const title = oldTitle === 'New chat' ? prompt.slice(0, 48) : oldTitle;
    await chatRef.set({ title, updatedAt: now + 1 }, { merge: true });
    return sendJson(res, 200, { answer, title });
  } catch (error) { return handleError(res, error, 'v2-ai-fallback'); }
}

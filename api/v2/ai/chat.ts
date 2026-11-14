import type { ApiRequest, ApiResponse } from '../../../serverless/live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../../serverless/live.js';

type ChatMessage = { role: 'user' | 'assistant'; content: string; createdAt: number; feedback?: 'like' | 'dislike' };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return sendJson(res, 503, { error: 'eChat AI is not configured yet. Add OPENAI_API_KEY to the Vercel project environment.' });

  const encoder = new TextEncoder();
  try {
    const { user } = await verifyLiveUser(req);
    const chatId = String(req.body?.chatId || '').trim();
    const prompt = String(req.body?.message || '').trim().slice(0, 8000);
    if (!chatId || !prompt) return sendJson(res, 400, { error: 'A chat and message are required.' });
    const chatRef = firestore.collection('users').doc(user.uid).collection('v2AiChats').doc(chatId);
    const chat = await chatRef.get();
    if (!chat.exists) return sendJson(res, 404, { error: 'Chat not found.' });
    const historySnapshot = await chatRef.collection('messages').orderBy('createdAt', 'desc').limit(30).get();
    const history = historySnapshot.docs.reverse().map(doc => doc.data() as ChatMessage).filter(message => message.role === 'user' || message.role === 'assistant');
    const now = Date.now();
    await chatRef.collection('messages').add({ role: 'user', content: prompt, createdAt: now });
    const providerResponse = await fetch(`${(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        stream: true,
        messages: [
          { role: 'system', content: 'You are eChat AI, a helpful assistant for everyone. Be clear, kind, useful, and culturally aware of Sierra Leone when relevant. Help with questions, writing, learning, coding, business and Echat features. Never claim to have performed actions you did not perform.' },
          ...history.slice(-24).map(({ role, content }) => ({ role, content })),
          { role: 'user', content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(110_000)
    });
    if (!providerResponse.ok || !providerResponse.body) {
      const detail = await providerResponse.text().catch(() => '');
      return sendJson(res, providerResponse.status === 429 ? 429 : 502, { error: providerResponse.status === 429 ? 'eChat AI is busy. Please try again shortly.' : `eChat AI could not answer (${providerResponse.status}). ${detail.slice(0, 180)}` });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const reader = providerResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    const emit = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const token = JSON.parse(raw)?.choices?.[0]?.delta?.content;
          if (typeof token === 'string' && token) { answer += token; emit('token', token); }
        } catch { /* Ignore incomplete provider frames. */ }
      }
    }
    if (!answer.trim()) throw new Error('eChat AI returned an empty response. Please try again.');
    await chatRef.collection('messages').add({ role: 'assistant', content: answer, createdAt: Date.now() });
    const title = String(chat.data()?.title || 'New chat') === 'New chat' ? prompt.slice(0, 48) : String(chat.data()?.title || 'New chat');
    await chatRef.set({ title, updatedAt: Date.now() }, { merge: true });
    emit('done', { title });
    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'eChat AI failed.' })}\n\n`);
      return res.end();
    }
    return handleError(res, error, 'v2-ai-chat');
  }
}

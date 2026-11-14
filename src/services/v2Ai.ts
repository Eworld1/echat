import { auth } from './firebase';

export type V2AiChat = { id: string; title: string; createdAt: number; updatedAt: number };
export type V2AiMessage = { id: string; role: 'user' | 'assistant'; content: string; createdAt: number; feedback?: 'like' | 'dislike' };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to use eChat AI.');
  const token = await user.getIdToken();
  const response = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'eChat AI request failed.');
  return payload as T;
}

export const v2Ai = {
  async list() { return (await request<{ chats: V2AiChat[] }>('/api/v2/ai/chats')).chats; },
  async create() { return (await request<{ chat: V2AiChat }>('/api/v2/ai/chats', { method: 'POST', body: '{}' })).chat; },
  async load(chatId: string) { return request<{ chat: V2AiChat; messages: V2AiMessage[] }>(`/api/v2/ai/chats/${encodeURIComponent(chatId)}`); },
  async rename(chatId: string, title: string) { return request(`/api/v2/ai/chats/${encodeURIComponent(chatId)}`, { method: 'PATCH', body: JSON.stringify({ title }) }); },
  async remove(chatId: string) { return request(`/api/v2/ai/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }); },
  async feedback(chatId: string, messageId: string, feedback: 'like' | 'dislike') {
    return request(`/api/v2/ai/chats/${encodeURIComponent(chatId)}`, { method: 'PATCH', body: JSON.stringify({ messageId, feedback }) });
  },
  async stream(chatId: string, message: string, signal: AbortSignal, onToken: (token: string) => void) {
    const user = auth.currentUser;
    if (!user) throw new Error('Sign in to use eChat AI.');
    const token = await user.getIdToken();
    const response = await fetch('/api/v2/ai/chat', { method: 'POST', signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId, message }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(typeof payload.error === 'string' ? payload.error : 'eChat AI could not answer.');
    }
    if (!response.body) throw new Error('Streaming is unavailable in this browser.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (!data) continue;
        const payload = JSON.parse(data) as { error?: string } | string;
        if (event === 'token' && typeof payload === 'string') onToken(payload);
        if (event === 'error' && typeof payload === 'object') throw new Error(payload.error || 'eChat AI failed.');
      }
    }
  }
};

import type { ApiRequest, ApiResponse } from '../../../serverless/live.js';
import { applyLiveCors, firestore, handleError, handleLiveOptions, sendJson, verifyLiveUser } from '../../../serverless/live.js';

type ChatMessage = { role: 'user' | 'assistant'; content: string; createdAt: number; feedback?: 'like' | 'dislike' };
type Emit = (event: string, data: unknown) => void;

function offlineAnswer(prompt: string, history: ChatMessage[]): string {
  const question = prompt.trim();
  const q = question.toLowerCase();
  const prior = [...history].reverse().find(message => message.role === 'user')?.content;
  const followup = prior ? `\n\nI’m also keeping your earlier question in mind: “${prior.slice(0, 180)}”.` : '';

  if (/\b(echat|what is e.?chat|about echat)\b/.test(q)) return 'eChat is a social app for connecting with people. You can share posts, stories and Reels, chat with friends, join calls, discover live broadcasts, play games, and customize your profile. Sign up with your email or phone from the sign-in screen, or log in with the account you already use.';
  if (/\b(sign ?up|create (an? )?account|register|log ?in|login|password|reset password|forgot password)\b/.test(q)) return 'To get started, open eChat and choose Sign up to create an account, or Log in if you already have one. If you forgot your password, choose “Forgotten password?” on the login page and follow the reset link sent to your account email. Check your spam folder if it does not arrive.';
  if (/\b(account|my account|account help|account issue)\b/.test(q)) return 'I can help with sign-in, password reset, profile details, account access, and settings. If you cannot log in, use “Forgotten password?” on the login page. For profile or privacy changes, open your profile menu and choose Settings. Tell me which part is giving you trouble and I’ll guide you.';
  if (/\b(go live|live access|broadcast|request go live|request access)\b/.test(q)) return 'To go live, open Go Live or Broadcast Studio, allow camera and microphone access, add a title, and choose Start Live. If you see “Request Go Live access,” your account needs approval under the current access settings. Send the request from that screen; an administrator can review it. Some accounts may also become eligible after meeting the account-age rule. A blocked account cannot bypass that restriction.';
  if (/\b(story|stories|status)\b/.test(q)) return 'To share a story, open the Stories or Moments area, choose Create Story, add a photo or video, and publish it. Stories are temporary; check the audience and privacy options before sharing.';
  if (/\b(reel|reels|short video)\b/.test(q)) return 'To post a Reel, choose Create and select Reel, pick a supported video, add a caption, then tap Post. If it does not upload, check your connection, file format and size, and try again on a stable network.';
  if (/\b(friend|friends|follow|following|request)\b/.test(q)) return 'Open Friends to search for people or review friend requests. Use the Follow button on a profile or live card to follow a creator; their public updates can then appear in your Following feed. You can manage requests and connections from the Friends page.';
  if (/\b(chat|message|messenger|voice note)\b/.test(q)) return 'Open Chat or Messages, select a friend, and type in the message box. Use the attachment or voice-note controls to share media or audio. You can open a conversation from a friend’s profile as well.';
  if (/\b(call|voice call|video call)\b/.test(q)) return 'Open a conversation with your friend and choose the voice-call or video-call control in the chat header. Allow microphone or camera access when prompted. If a call does not connect, check browser permissions and your network, then try again.';
  if (/\b(game|games|chess|ludo|checkers|trivia)\b/.test(q)) return 'Open the V2 menu and choose Games. Select a game, choose an available play mode, and use Restart to begin again. Online Ludo rooms can be shared with friends; other games support solo or local play where offered.';
  if (/\b(avatar|profile picture|profile|bio|cover photo)\b/.test(q)) return 'Open your profile to edit your name, bio, profile photo, or cover image. In V2, choose Avatars to customize an avatar and save it to your account. You can switch between your avatar and profile photo from the avatar page.';
  if (/\b(setting|privacy|notification|blocked users)\b/.test(q)) return 'Open Settings from your profile menu to manage your account and preferences. Review privacy and notification choices there, and use Blocked Users to review or unblock accounts you have blocked.';
  if (/\b(caption|write|post|announcement|social media)\b/.test(q)) return `Here’s a ready-to-edit draft:\n\n“${question.replace(/^(please\s+)?(help me\s+)?(write|create|draft)\s+(a\s+)?(caption|post|announcement)?\s*(for|about)?\s*/i, '').trim() || 'A little progress each day adds up. Grateful for the journey and everyone sharing it with me.'}”\n\nYou can make it warmer by adding a personal detail, a place, or a question for your audience.`;
  if (/\b(homework|explain|study|school|lesson|math|science|history)\b/.test(q)) return 'I can help you work through it step by step. Start by identifying what the question asks, list what you already know, and solve one part at a time. Share the exact homework question and your class level, and I’ll tailor an explanation you can learn from.';
  if (/\b(business|business idea|start a business|entrepreneur|small business)\b/.test(q)) return 'A practical Sierra Leone business idea is a neighborhood delivery and ordering service for local food sellers. Start in one area, take orders by WhatsApp or eChat, agree clear delivery fees with sellers, and track repeat customers. Validate demand with a small pilot before investing in equipment or a larger app.';
  if (/\b(sierra leone|freetown|bo city|kenema|makeni|salone)\b/.test(q)) return 'Sierra Leone is a West African country on the Atlantic coast. Freetown is its capital; Bo, Kenema, and Makeni are other major cities. English is the official language, and Krio is widely used. If you tell me whether you need travel, history, culture, education, or business information, I can focus the answer.';
  if (/\b(hello|hi|hey|good morning|good afternoon|good evening)\b/.test(q)) return 'Hello! I’m eChat AI. I can help with eChat features, write captions and posts, explain school topics, brainstorm business ideas, or answer general questions. What would you like to do?';
  return `I can still help with that. I’m best at eChat guidance, writing captions and posts, explaining homework topics, brainstorming business ideas, and Sierra Leone information. Tell me a little more about what you need, or choose one of those and I’ll get started.${followup}`;
}

function streamText(text: string, emit: Emit) {
  const chunks = text.match(/[\s\S]{1,36}/gu) || [text];
  for (const chunk of chunks) emit('token', chunk);
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  applyLiveCors(req, res);
  if (handleLiveOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'That request could not be completed. Please try again.' });

  try {
    const { user } = await verifyLiveUser(req);
    const chatId = String(req.body?.chatId || '').trim();
    const prompt = String(req.body?.message || '').trim().slice(0, 8000);
    const messageId = String(req.body?.clientMessageId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    if (!chatId || !prompt) return sendJson(res, 400, { error: 'Add a message and try again.' });
    const chatRef = firestore.collection('users').doc(user.uid).collection('v2AiChats').doc(chatId);
    const chat = await chatRef.get();
    if (!chat.exists) return sendJson(res, 404, { error: 'This conversation could not be found. Start a new chat and try again.' });
    const historySnapshot = await chatRef.collection('messages').orderBy('createdAt', 'desc').limit(30).get();
    const history = historySnapshot.docs.reverse().map(doc => doc.data() as ChatMessage).filter(message => message.role === 'user' || message.role === 'assistant');
    await chatRef.collection('messages').doc(messageId).set({ role: 'user', content: prompt, createdAt: Date.now() });

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const emit: Emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    let answer = '';
    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      console.info('[eChat AI] Using fallback mode', { reason: 'missing_key' });
      answer = offlineAnswer(prompt, history);
      streamText(answer, emit);
    } else {
      try {
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
          signal: AbortSignal.timeout(40_000)
        });

        if (!providerResponse.ok || !providerResponse.body) {
          console.warn('[eChat AI] Using fallback mode', { reason: 'provider_unavailable', status: providerResponse.status });
          answer = offlineAnswer(prompt, history);
          streamText(answer, emit);
        } else {
          const reader = providerResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
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
          if (!answer.trim()) {
            console.warn('[eChat AI] Using fallback mode', { reason: 'empty_provider_response' });
            answer = offlineAnswer(prompt, history);
            emit('replace', null);
            streamText(answer, emit);
          }
        }
      } catch (providerError) {
        console.warn('[eChat AI] Using fallback mode', { reason: providerError instanceof Error && providerError.name === 'TimeoutError' ? 'provider_timeout' : 'provider_error' });
        answer = offlineAnswer(prompt, history);
        emit('replace', null);
        streamText(answer, emit);
      }
    }

    if (!answer.trim()) answer = offlineAnswer(prompt, history);
    await chatRef.collection('messages').doc(`assistant_${messageId}`).set({ role: 'assistant', content: answer, createdAt: Date.now() });
    const title = String(chat.data()?.title || 'New chat') === 'New chat' ? prompt.slice(0, 48) : String(chat.data()?.title || 'New chat');
    await chatRef.set({ title, updatedAt: Date.now() }, { merge: true });
    emit('done', { title });
    res.end();
  } catch (error) {
    return handleError(res, error, 'v2-ai-chat');
  }
}

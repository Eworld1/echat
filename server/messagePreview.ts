/**
 * Safe one-line preview of a chat message for notifications, push and chat lists.
 * Never returns base64 / data: URLs: voice -> "🎤 Voice message", photo -> "📷 Photo",
 * video -> "🎥 Video", files -> "📎 File", text -> first 50 characters.
 */
export interface PreviewSource {
  text?: string | null;
  mediaType?: string | null;
  mediaUrl?: string | null;
  attachments?: { mimeType?: string }[] | null;
}

const MAX_TEXT = 50;

export function messagePreview(message: PreviewSource): string {
  const text = String(message.text || '').trim();
  const media = String(message.mediaType || '').toLowerCase();
  const mimes = (message.attachments || []).map(item => String(item?.mimeType || '').toLowerCase());
  if (text.startsWith('[SIGNAL]')) return '📞 Incoming call';
  if (text.startsWith('[CALL]')) return `📞 ${stripData(text.slice(6)) || 'Call'}`;
  if (text.startsWith('__echat_missed_call__')) return text.includes('video') ? '📞 Missed video call' : '📞 Missed voice call';
  if (text.startsWith('[VOICE]') || text.startsWith('[AUDIO]') || /^data:audio\//i.test(text) || media === 'audio' || (mimes.length && mimes.every(m => m.startsWith('audio/')))) return '🎤 Voice message';
  if (text.startsWith('[VIDEO]') || /^data:video\//i.test(text) || media === 'video' || (mimes.length && mimes.every(m => m.startsWith('video/')))) return '🎥 Video';
  if (text.startsWith('[IMAGE]') || /^data:image\//i.test(text) || media === 'image' || (mimes.length && mimes.every(m => m.startsWith('image/')))) return mimes.length > 1 ? `📷 ${mimes.length} photos` : '📷 Photo';
  if (text.startsWith('[FILE]') || text.startsWith('data:') || media === 'file' || mimes.length) return mimes.length > 1 ? `📎 ${mimes.length} files` : '📎 File';
  const clean = stripData(text);
  if (!clean) return message.mediaUrl ? '📷 Photo' : 'New message';
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT).trimEnd()}…` : clean;
}

/** Removes any data: URL / [TAG]payload that slipped into text, and squashes whitespace. */
function stripData(value: string): string {
  return value
    .replace(/\[(VOICE|AUDIO|IMAGE|VIDEO|FILE)\]\S*/g, '')
    .replace(/data:[a-z]+\/[\w.+-]+;base64,[A-Za-z0-9+/=]*/gi, '')
    .replace(/data:\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cleans notification text saved before this fix ("Ama: [VOICE]data:audio/webm;base64,...."). */
export function cleanNotificationText(message: string): string {
  if (!/data:|\[(VOICE|AUDIO|IMAGE|VIDEO|FILE|SIGNAL|CALL)\]|__echat_missed_call__/.test(message)) return message;
  const split = message.indexOf(': ');
  if (split > 0 && split < 80) return `${message.slice(0, split)}: ${messagePreview({ text: message.slice(split + 2) })}`;
  return messagePreview({ text: message });
}

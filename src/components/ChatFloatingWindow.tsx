import React, { useState, useEffect, useRef } from 'react';
import { User, Message } from '../types';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { assetUrl } from '../services/apiBase';
import { VoiceRecorder } from './VoiceRecorder';
import { VideoLinkCard } from './VideoLinkCard';
import { LinkPreviewCard } from './LinkPreviewCard';
import {
  Phone,
  Video,
  X,
  Minus,
  Send,
  Image,
  Smile,
  Mic,
  Check,
  CheckCheck,
  Play,
  Pause,
  Pencil,
  Download
  , Volume2, VolumeX, MoreVertical, Copy, CornerUpLeft, Trash2
} from 'lucide-react';
import { playSound, setChatSoundVolume } from '../utils/sounds';

interface ChatFloatingWindowProps {
  partner: User;
  onClose: () => void;
}

export const ChatFloatingWindow: React.FC<ChatFloatingWindowProps> = ({ partner: initialPartner, onClose }) => {
  const { user } = useAuth();
  const [partner, setPartner] = useState(initialPartner);
  const {
    onlineUserIds,
    typingUsers,
    sendTyping,
    markSeen,
    startCall,
    onNewMessage,
    onMessageUpdated,
    onMessageDeleted
  } = useSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [voiceVolume, setVoiceVolume] = useState(100);
  const [voiceBoost, setVoiceBoost] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('echat_chat_sound') !== 'false');
  const [messageMenuId, setMessageMenuId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const isPartnerOnline = onlineUserIds.includes(partner.id);
  const isPartnerTyping = Boolean(typingUsers[partner.id]);

  useEffect(() => setPartner(initialPartner), [initialPartner]);
  useEffect(() => {
    const key = 'echat_active_chat';
    if (!isMinimized) localStorage.setItem(key, partner.id);
    else if (localStorage.getItem(key) === partner.id) localStorage.removeItem(key);
    return () => { if (localStorage.getItem(key) === partner.id) localStorage.removeItem(key); };
  }, [partner.id, isMinimized]);
  useEffect(() => {
    const updatePartner = (event: Event) => {
      const updated = (event as CustomEvent<Partial<User>>).detail;
      if (updated?.id === partner.id) setPartner(current => ({ ...current, ...updated }));
    };
    window.addEventListener('echat:profile-updated', updatePartner);
    return () => window.removeEventListener('echat:profile-updated', updatePartner);
  }, [partner.id]);

  // Load chat history
  const loadMessages = async () => {
    if (!user) return;
    try {
      const history = await api.getMessages(partner.id);
      setMessages(Array.isArray(history) ? history : []);
      markSeen(partner.id);
      await api.markMessagesSeen(partner.id);
    } catch (err) {
      console.error('Error fetching messages:', err);
      setMessages([]);
    }
  };

  useEffect(() => {
    loadMessages();
  }, [partner.id]);

  // Subscribe to real-time incoming messages
  useEffect(() => {
    const unsubscribe = onNewMessage((msg) => {
      if (
        (msg.senderId === partner.id && msg.receiverId === user?.id) ||
        (msg.senderId === user?.id && msg.receiverId === partner.id)
      ) {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          const pendingIndex = msg.senderId === user?.id ? prev.findIndex(m => m.id.startsWith('pending-') && m.senderId === msg.senderId && m.receiverId === msg.receiverId && m.text === msg.text && Math.abs(m.createdAt - msg.createdAt) < 15_000) : -1;
          if (pendingIndex < 0) return [...prev, msg];
          return [...prev.slice(0, pendingIndex), ...prev.slice(pendingIndex + 1), msg];
        });

        if (msg.senderId === partner.id) {
          markSeen(partner.id);
          api.markMessagesSeen(partner.id);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [partner.id, user?.id]);

  useEffect(() => onMessageUpdated(message => {
    setMessages(current => current.map(item => item.id === message.id ? message : item));
    setEditingMessageId(null);
  }), [onMessageUpdated]);

  useEffect(() => onMessageDeleted(messageId => setMessages(current => current.filter(item => item.id !== messageId))), [onMessageDeleted]);

  const wasPartnerTyping = useRef(false);
  const lastTypingSound = useRef(0);
  useEffect(() => {
    if (isPartnerTyping && !wasPartnerTyping.current && Date.now() - lastTypingSound.current >= 3000) {
      playSound('typing');
      lastTypingSound.current = Date.now();
    }
    wasPartnerTyping.current = isPartnerTyping;
  }, [isPartnerTyping]);

  useEffect(() => {
    const syncSound = () => setSoundEnabled(localStorage.getItem('echat_chat_sound') !== 'false');
    window.addEventListener('echat:chat-sound-settings', syncSound);
    return () => window.removeEventListener('echat:chat-sound-settings', syncSound);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPartnerTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = '48px';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;

    // Trigger typing indicator
    sendTyping(partner.id, true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(partner.id, false);
    }, 1500);
  };

  const handleSend = async (mediaData?: { mediaUrl: string; mediaType: 'image' | 'video' | 'audio'; audioDuration?: number }, attachments?: { url: string; name: string; mimeType: string; size: number }[]) => {
    if ((!inputText.trim() && !mediaData && !attachments?.length) || !user) return;

    const payload = {
      receiverId: partner.id,
      text: inputText.trim() || undefined,
      ...(mediaData && {
        mediaUrl: mediaData.mediaUrl,
        mediaType: mediaData.mediaType,
        audioDuration: mediaData.audioDuration
      }),
      ...(attachments?.length ? { attachments } : {})
    };

    const pendingId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pendingMessage: Message = { id: pendingId, ...payload, senderId: user.id, status: 'sent', createdAt: Date.now() };
    setMessages(prev => [...prev, pendingMessage]);
    setInputText('');
    sendTyping(partner.id, false);

    try {
      const sent = await api.sendMessage(payload);
      setMessages(prev => [...prev.filter(m => m.id !== pendingId && m.id !== sent.id), sent]);
      playSound('message_out');
    } catch (err) {
      console.error('Failed to send message:', err);
      setMessages(prev => prev.filter(message => message.id !== pendingId));
      if (payload.text) setInputText(current => current || payload.text || '');
      alert(err instanceof Error ? err.message : 'Message could not be sent. Please try again.');
    }
  };

  const handleVoiceSend = (audioUrl: string, durationSecs: number) => {
    setIsRecordingVoice(false);
    handleSend({
      mediaUrl: audioUrl,
      mediaType: 'audio',
      audioDuration: durationSecs
    });
  };

  const handleEditMessage = async (messageId: string) => {
    try {
      const updated = await api.editMessage(messageId, editingMessageText.trim());
      setMessages(current => current.map(item => item.id === updated.id ? updated : item));
      setEditingMessageId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not edit this message.');
    }
  };

  const startEditing = (message: Message) => {
    setMessageMenuId(null);
    if (!message.text || message.mediaUrl || message.mediaType || message.attachments?.length) {
      alert('Only text messages can be edited.');
      return;
    }
    if (Date.now() - message.createdAt > 15 * 60 * 1000) {
      alert('You can no longer edit this message.');
      return;
    }
    setEditingMessageId(message.id);
    setEditingMessageText(message.text);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const deleteMessageForMe = async (messageId: string) => {
    try {
      await api.deleteMessage(messageId);
      setMessages(current => current.filter(item => item.id !== messageId));
      setMessageMenuId(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not delete this message.');
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    if (files.length > 10) { alert('Choose up to 10 files at a time.'); return; }
    if (files.some(file => file.size > 15 * 1024 * 1024)) { alert('Each file must be 15 MB or smaller.'); return; }
    setIsUploadingFiles(true);
    setUploadProgress(0);
    try {
      const attachments = [];
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        attachments.push({ url: await api.uploadFile(file), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size });
        setUploadProgress(Math.round(((index + 1) / files.length) * 100));
      }
      await handleSend(undefined, attachments);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not upload the selected files.');
    } finally {
      setIsUploadingFiles(false);
      setUploadProgress(0);
    }
  };

  const playVoiceMessage = (msgId: string, url?: string) => {
    if (!url) return;
    if (playingAudioId === msgId) {
      audioPlayerRef.current?.pause();
      setPlayingAudioId(null);
    } else {
      if (audioPlayerRef.current) audioPlayerRef.current.pause();
      const audio = new Audio(url);
      audioPlayerRef.current = audio;
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const context: AudioContext = new Ctx(); const source = context.createMediaElementSource(audio); const gain = context.createGain();
        gain.gain.value = Math.min(2, voiceVolume / 100 * (voiceBoost ? 1.8 : 1)); source.connect(gain).connect(context.destination);
        voiceAudioContextRef.current = context; voiceGainRef.current = gain; void context.resume();
      } catch { audio.volume = 1; }
      setPlayingAudioId(msgId);
      audio.play().catch(() => {});
      audio.onended = () => setPlayingAudioId(null);
    }
  };

  const emojis = ['👍', '❤️', '😂', '🔥', '🎉', '👏', '😍', '🙌', '✨', '👋', '💯'];

  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        className="fixed bottom-0 right-4 sm:right-20 z-40 bg-white border border-slate-200 rounded-t-2xl shadow-xl px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50 transition w-64"
      >
        <div className="relative">
          <img src={partner.avatar} alt={partner.name} className="w-8 h-8 rounded-full object-cover" />
          {isPartnerOnline && (
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-slate-800 truncate">{partner.name}</p>
          <p className="text-[10px] text-slate-500">{isPartnerOnline ? 'Active now' : 'Offline'}</p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-slate-400 hover:text-slate-700 p-1"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 h-[100dvh] w-full min-w-0 rounded-t-2xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 pb-[env(safe-area-inset-bottom)] sm:inset-auto sm:bottom-0 sm:right-16 sm:h-[min(460px,calc(100dvh-env(safe-area-inset-bottom)))] sm:w-[350px] sm:rounded-2xl sm:pb-0">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-white border-b border-slate-100 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative">
            <img src={partner.avatar} alt={partner.name} className="w-9 h-9 rounded-full object-cover" />
            {isPartnerOnline && (
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 rounded-full ring-2 ring-white" />
            )}
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-slate-900 truncate leading-tight">{partner.name}</h4>
            <p className="text-[11px] font-medium text-slate-500 leading-tight">
              {isPartnerOnline ? 'Active now' : 'Offline'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 text-blue-600">
          <button type="button" onClick={() => { const enabled = !soundEnabled; setSoundEnabled(enabled); localStorage.setItem('echat_chat_sound', String(enabled)); }} aria-label={soundEnabled ? 'Turn chat sounds off' : 'Turn chat sounds on'} title={soundEnabled ? 'Chat sounds on' : 'Chat sounds off'} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </button>
          <button
            onClick={() => startCall(partner.id, partner.name, partner.avatar, 'audio')}
            className="p-1.5 hover:bg-blue-50 rounded-full transition cursor-pointer"
            title="Start Audio Call"
          >
            <Phone size={17} />
          </button>
          <button
            onClick={() => startCall(partner.id, partner.name, partner.avatar, 'video')}
            className="p-1.5 hover:bg-blue-50 rounded-full transition cursor-pointer"
            title="Start Video Call"
          >
            <Video size={17} />
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-full transition"
            title="Minimize"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-full transition"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 space-y-2 bg-[#FAFBFD]">
        {messages.map((msg, idx) => {
          const isMe = msg.senderId === user?.id;
          return (
            <div
              key={msg.id || idx}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
              onTouchStart={() => { clearLongPress(); longPressTimerRef.current = window.setTimeout(() => setMessageMenuId(msg.id), 550); }}
              onTouchEnd={clearLongPress}
              onTouchMove={clearLongPress}
            >
              <div
                className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-xs ${
                  isMe
                    ? 'bg-blue-600 text-white rounded-br-xs'
                    : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-xs'
                }`}
              >
                {/* Media Image or Video */}
                {msg.mediaUrl && msg.mediaType === 'image' && (
                  <img
                    src={msg.mediaUrl}
                    alt="attachment"
                    className="rounded-xl max-h-48 w-full object-cover mb-1.5 cursor-pointer"
                    onClick={() => window.open(msg.mediaUrl, '_blank')}
                  />
                )}

                {msg.mediaUrl && msg.mediaType === 'video' && (
                  <video
                    src={msg.mediaUrl}
                    controls
                    className="rounded-xl max-h-48 w-full object-cover mb-1.5"
                  />
                )}

                {msg.attachments?.map((attachment, attachmentIndex) => {
                  const url = assetUrl(attachment.url);
                  const isImage = attachment.mimeType.startsWith('image/');
                  const isVideo = attachment.mimeType.startsWith('video/');
                  return <div key={`${msg.id}-file-${attachmentIndex}`} className="mb-2 min-w-36 max-w-full">
                    {isImage ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={attachment.name} loading="lazy" className="max-h-48 rounded-lg object-cover" /></a>
                      : isVideo ? <video src={url} controls playsInline className="max-h-48 max-w-full rounded-lg" />
                      : <a href={url} download={attachment.name} className="flex items-center gap-2 rounded-lg border border-current/20 p-2 text-xs underline"><Download size={14} />{attachment.name}</a>}
                    <div className="mt-1 flex items-center justify-between gap-3 text-[10px] opacity-70"><span className="truncate">{attachment.name}</span><span className="shrink-0">{(attachment.size / (1024 * 1024)).toFixed(2)} MB</span><a href={url} download={attachment.name} aria-label={`Download ${attachment.name}`} className="shrink-0 underline">Download</a></div>
                  </div>;
                })}

                {/* Voice Note Audio Player */}
                {msg.mediaType === 'audio' && (
                  <div className="flex items-center gap-2 py-1">
                    <button
                      onClick={() => playVoiceMessage(msg.id, msg.mediaUrl)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center transition ${
                        isMe ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
                      }`}
                    >
                      {playingAudioId === msg.id ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
                    </button>
                    <div className="flex items-center gap-0.5">
                      <span className="w-1 h-3 bg-current opacity-60 rounded-full" />
                      <span className="w-1 h-5 bg-current opacity-90 rounded-full" />
                      <span className="w-1 h-2 bg-current opacity-60 rounded-full" />
                      <span className="w-1 h-6 bg-current rounded-full" />
                      <span className="w-1 h-4 bg-current opacity-80 rounded-full" />
                    </div>
                    <span className="text-[11px] font-mono font-medium opacity-90">
                      {msg.audioDuration ? `${msg.audioDuration}s` : 'Voice note'}
                    </span>
                    <label className="ml-2 flex items-center gap-1 text-[10px] opacity-90">Vol<input aria-label="Voice note volume" type="range" min="0" max="200" value={voiceVolume} onChange={event => { const volume = Number(event.target.value); setVoiceVolume(volume); if (voiceGainRef.current) voiceGainRef.current.gain.value = Math.min(2, volume / 100 * (voiceBoost ? 1.8 : 1)); }} className="w-14" /></label>
                    <button type="button" onClick={() => { setVoiceBoost(value => !value); if (voiceGainRef.current) voiceGainRef.current.gain.value = Math.min(2, voiceVolume / 100 * (voiceBoost ? 1 : 1.8)); }} className="rounded bg-black/20 px-1.5 py-1 text-[10px] font-bold">Boost {voiceBoost ? 'On' : 'Off'}</button>
                  </div>
                )}

                {/* Text Content */}
                {msg.text && editingMessageId === msg.id ? (
                  <div className="min-w-52 space-y-2">
                    <textarea autoFocus value={editingMessageText} onChange={event => setEditingMessageText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleEditMessage(msg.id); } if (event.key === 'Escape') setEditingMessageId(null); }} maxLength={4000} rows={3} className="w-full rounded-lg border border-white/30 bg-white/10 p-2 text-sm text-current outline-none" />
                    <div className="flex justify-end gap-2"><button onClick={() => setEditingMessageId(null)} className="rounded-lg px-2 py-1 text-xs">Cancel</button><button onClick={() => void handleEditMessage(msg.id)} disabled={!editingMessageText.trim()} className="rounded-lg bg-white/20 px-2 py-1 text-xs font-bold disabled:opacity-50">Save</button></div>
                  </div>
                ) : msg.text && <><p className="leading-relaxed break-words">{msg.text}</p>{msg.editedAt && <span className="mt-1 block text-[10px] opacity-70">Edited · {new Date(msg.editedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}<VideoLinkCard text={msg.text} /><LinkPreviewCard text={msg.text} compact /></>}
              </div>

              {/* Status and Timestamp */}
              <div className="flex items-center gap-1 mt-0.5 px-1 text-[10px] text-slate-400 font-medium">
                <span>{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                {isMe && (
                  <span className="ml-0.5">
                    {msg.status === 'seen' ? (
                      <span className="flex items-center text-blue-500 font-semibold" title="Seen">
                        <CheckCheck size={13} />
                      </span>
                    ) : msg.status === 'delivered' ? (
                      <span className="text-slate-400" title="Delivered">
                        <CheckCheck size={13} />
                      </span>
                    ) : (
                      <span className="text-slate-400" title="Sent">
                        <Check size={13} />
                      </span>
                    )}
                  </span>
                )}
                <div className="relative ml-1">
                  <button type="button" onClick={() => setMessageMenuId(current => current === msg.id ? null : msg.id)} className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-full hover:bg-slate-200" aria-label="Message options"><MoreVertical size={15} /></button>
                  {messageMenuId === msg.id && <div className={`absolute bottom-full z-20 mb-1 min-w-36 rounded-xl border border-slate-200 bg-white p-1 text-slate-800 shadow-xl ${isMe ? 'right-0' : 'left-0'}`}>
                    {isMe && msg.text && <button type="button" onClick={() => startEditing(msg)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-slate-100"><Pencil size={14} />Edit message</button>}
                    <button type="button" onClick={() => { if (msg.text) void navigator.clipboard?.writeText(msg.text); setMessageMenuId(null); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-slate-100"><Copy size={14} />Copy text</button>
                    <button type="button" onClick={() => { setInputText(value => `${value}${value ? '\n' : ''}> ${msg.text || 'Message'}\n`); setMessageMenuId(null); }} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold hover:bg-slate-100"><CornerUpLeft size={14} />Reply</button>
                    <button type="button" onClick={() => void deleteMessageForMe(msg.id)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50"><Trash2 size={14} />Delete for me</button>
                  </div>}
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicator bubble */}
        {isPartnerTyping && (
          <div className="flex items-center gap-2 text-slate-500 text-xs py-1">
            <img src={partner.avatar} alt={partner.name} className="w-6 h-6 rounded-full object-cover" />
            <div className="bg-white border border-slate-200 px-3 py-1.5 rounded-full flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Emoji Picker Popover */}
      {showEmojiPicker && (
        <div className="p-2 border-t border-slate-200 bg-white grid grid-cols-6 gap-2">
          {emojis.map((emoji) => (
            <button
              key={emoji}
              onClick={() => {
                setInputText(prev => prev + emoji);
                setShowEmojiPicker(false);
              }}
              className="text-lg p-1 hover:bg-slate-100 rounded-lg transition"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Footer / Input Area */}
      <div className="sticky bottom-0 z-50 w-full shrink-0 box-border p-2.5 bg-white border-t border-slate-100 touch-pan-y">
        {isUploadingFiles && <div className="mb-2"><div className="mb-1 flex justify-between text-[10px] text-slate-500"><span>Uploading attachments…</span><span>{uploadProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} /></div></div>}
        {isRecordingVoice ? (
          <VoiceRecorder
            onSendVoice={handleVoiceSend}
            onCancel={() => setIsRecordingVoice(false)}
          />
        ) : (
          <div className="flex w-full min-w-0 items-end gap-1.5">
            <label className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center text-blue-600 hover:bg-blue-50 rounded-full cursor-pointer transition">
              <Image size={18} />
              <input
                type="file"
                accept="image/*,video/*,.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />
            </label>

            <button
              onClick={() => setIsRecordingVoice(true)}
              className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center text-blue-600 hover:bg-blue-50 rounded-full transition"
              title="Record Voice Note"
            >
              <Mic size={18} />
            </button>

            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center text-slate-500 hover:bg-slate-100 rounded-full transition"
              title="Emoji"
            >
              <Smile size={18} />
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex min-w-0 flex-1 items-end gap-1"
            >
              <textarea
                rows={1}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Aa"
                className="min-h-12 max-h-[120px] min-w-0 flex-1 resize-none overflow-y-auto bg-slate-100 hover:bg-slate-200/80 focus:bg-white text-slate-800 text-base leading-6 px-4 py-3 rounded-3xl border border-transparent focus:border-blue-400 focus:outline-hidden transition"
              />

              {inputText.trim() || isUploadingFiles ? <button
                type="submit"
                disabled={!inputText.trim() || isUploadingFiles}
                aria-label="Send message"
                className="flex h-12 w-12 min-w-12 shrink-0 touch-manipulation items-center justify-center bg-blue-600 text-white rounded-full shadow-md hover:bg-blue-700 disabled:opacity-50 transition"
              >
                <Send size={19} />
              </button> : <button type="button" onClick={() => setIsRecordingVoice(true)} aria-label="Record voice message" className="flex h-12 w-12 min-w-12 shrink-0 touch-manipulation items-center justify-center bg-blue-600 text-white rounded-full shadow-md"><Mic size={19} /></button>}
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

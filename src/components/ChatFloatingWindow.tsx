import React, { useState, useEffect, useRef } from 'react';
import { User, Message } from '../types';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { VoiceRecorder } from './VoiceRecorder';
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
  Pause
} from 'lucide-react';

interface ChatFloatingWindowProps {
  partner: User;
  onClose: () => void;
}

export const ChatFloatingWindow: React.FC<ChatFloatingWindowProps> = ({ partner, onClose }) => {
  const { user } = useAuth();
  const {
    onlineUserIds,
    typingUsers,
    sendTyping,
    markSeen,
    startCall,
    onNewMessage
  } = useSocket();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);

  const isPartnerOnline = onlineUserIds.includes(partner.id);
  const isPartnerTyping = Boolean(typingUsers[partner.id]);

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
          return [...prev, msg];
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isPartnerTyping]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);

    // Trigger typing indicator
    sendTyping(partner.id, true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(partner.id, false);
    }, 1500);
  };

  const handleSend = async (mediaData?: { mediaUrl: string; mediaType: 'image' | 'video' | 'audio'; audioDuration?: number }) => {
    if ((!inputText.trim() && !mediaData) || !user) return;

    const payload = {
      receiverId: partner.id,
      text: inputText.trim() || undefined,
      ...(mediaData && {
        mediaUrl: mediaData.mediaUrl,
        mediaType: mediaData.mediaType,
        audioDuration: mediaData.audioDuration
      })
    };

    setInputText('');
    sendTyping(partner.id, false);

    try {
      const sent = await api.sendMessage(payload);
      setMessages(prev => [...prev.filter(m => m.id !== sent.id), sent]);
    } catch (err) {
      console.error('Failed to send message:', err);
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      handleSend({
        mediaUrl: reader.result as string,
        mediaType: file.type.startsWith('video') ? 'video' : 'image'
      });
    };
    reader.readAsDataURL(file);
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
      setPlayingAudioId(msgId);
      audio.play();
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
    <div className="fixed bottom-0 right-2 sm:right-16 z-40 w-[94vw] sm:w-[350px] h-[460px] bg-white rounded-t-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-bottom-2">
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
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#FAFBFD]">
        {messages.map((msg, idx) => {
          const isMe = msg.senderId === user?.id;
          return (
            <div
              key={msg.id || idx}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
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
                  </div>
                )}

                {/* Text Content */}
                {msg.text && <p className="leading-relaxed break-words">{msg.text}</p>}
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
      <div className="p-2.5 bg-white border-t border-slate-100">
        {isRecordingVoice ? (
          <VoiceRecorder
            onSendVoice={handleVoiceSend}
            onCancel={() => setIsRecordingVoice(false)}
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <label className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full cursor-pointer transition">
              <Image size={18} />
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={handleImageUpload}
              />
            </label>

            <button
              onClick={() => setIsRecordingVoice(true)}
              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-full transition"
              title="Record Voice Note"
            >
              <Mic size={18} />
            </button>

            <button
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-full transition"
              title="Emoji"
            >
              <Smile size={18} />
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex-1 flex items-center gap-1"
            >
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                placeholder="Aa"
                className="flex-1 bg-slate-100 hover:bg-slate-200/80 focus:bg-white text-slate-800 text-sm px-3 py-1.5 rounded-full border border-transparent focus:border-blue-400 focus:outline-hidden transition"
              />

              <button
                type="submit"
                disabled={!inputText.trim()}
                className="p-1.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-40 disabled:hover:bg-blue-600 transition"
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};

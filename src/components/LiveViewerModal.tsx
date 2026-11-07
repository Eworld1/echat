import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { LiveStream, LiveComment } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import {
  X,
  Users,
  Radio,
  Send,
  Heart,
  Flame,
  ThumbsUp,
  Smile,
  Volume2,
  VolumeX,
  Share2
} from 'lucide-react';

interface LiveViewerModalProps {
  session?: LiveStream;
  stream?: LiveStream;
  onClose: () => void;
}

export const LiveViewerModal: React.FC<LiveViewerModalProps> = ({ session, stream, onClose }) => {
  const currentStream = stream || session;
  if (!currentStream) return null;

  const { user } = useAuth();
  const { onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveStopped } = useSocket();

  const [liveData, setLiveData] = useState<LiveStream>(currentStream);
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<LiveComment[]>(currentStream.comments || []);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; left: number }[]>([]);
  const [isMuted, setIsMuted] = useState(false);

  const commentsEndRef = useRef<HTMLDivElement | null>(null);

  // Notify server we joined
  useEffect(() => {
    api.joinLive();
    return () => {
      api.leaveLive();
    };
  }, []);

  // Socket listeners for real-time live events
  useEffect(() => {
    const unsubComment = onLiveComment((comment) => {
      setComments(prev => [...prev.slice(-50), comment]);
    });

    const unsubReaction = onLiveReaction((data) => {
      const emoji = data?.emoji || '❤️';
      const id = 'react_' + Math.random();
      setFloatingReactions(prev => [
        ...prev.slice(-20),
        { id, emoji, left: Math.floor(Math.random() * 70) + 15 }
      ]);
      setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== id));
      }, 2500);
    });

    const unsubViewers = onLiveViewersUpdated((count) => {
      setLiveData(prev => ({ ...prev, viewersCount: count }));
    });

    const unsubEnded = onLiveStopped((_streamId) => {
      alert('The host has ended this live broadcast. Thank you for watching!');
      onClose();
    });

    return () => {
      unsubComment();
      unsubReaction();
      unsubViewers();
      unsubEnded();
    };
  }, [currentStream.id, onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveStopped, onClose]);

  // Scroll to latest comment
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim()) return;
    try {
      await api.sendLiveComment(commentInput.trim());
      setCommentInput('');
    } catch (err) {
      console.error('Failed to send comment:', err);
    }
  };

  const handleSendReaction = (emoji: string) => {
    // Show immediate client-side burst
    const id = 'react_' + Math.random();
    setFloatingReactions(prev => [
      ...prev.slice(-20),
      { id, emoji, left: Math.floor(Math.random() * 70) + 15 }
    ]);
    setTimeout(() => {
      setFloatingReactions(prev => prev.filter(r => r.id !== id));
    }, 2500);

    // Broadcast through server
    api.sendLiveReaction(emoji);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-950 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Stream Header */}
        <div className="p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/95 text-white">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={liveData.hostAvatar}
                alt={liveData.hostName}
                className="w-10 h-10 rounded-full object-cover border-2 border-rose-500 shadow-md"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-rose-500 rounded-full ring-2 ring-slate-900 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white">{liveData.hostName}</span>
                <VerifiedBadge size={14} />
                <span className="bg-rose-600 text-white text-[10px] font-black uppercase px-2 py-0.5 rounded flex items-center gap-1 shadow-sm">
                  <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
                  LIVE
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate max-w-xs sm:max-w-md">
                {liveData.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-full text-xs font-semibold text-slate-200 border border-slate-700">
              <Users size={13} className="text-rose-400" />
              <span>{liveData.viewersCount || 1} watching</span>
            </div>

            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-2 text-slate-300 hover:text-white rounded-full hover:bg-slate-800 transition"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition cursor-pointer"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Video Canvas & Live Chat Stream */}
        <div className="flex-1 min-h-[360px] sm:min-h-[460px] relative bg-black flex flex-col md:flex-row overflow-hidden">
          
          {/* Main Video Viewport */}
          <div className="flex-1 relative flex items-center justify-center bg-radial from-slate-900 via-slate-950 to-black overflow-hidden">
            {/* Visualizer and Live Host Graphic */}
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="relative mb-4">
                <img
                  src={liveData.hostAvatar}
                  alt={liveData.hostName}
                  className="w-28 h-28 rounded-full object-cover ring-4 ring-rose-500/80 shadow-2xl"
                />
                <div className="absolute inset-0 rounded-full border-4 border-rose-500 animate-ping opacity-35" />
              </div>
              <h3 className="text-xl font-black text-white flex items-center gap-2 justify-center">
                {liveData.hostName}
                <VerifiedBadge size={16} />
              </h3>
              <p className="text-xs text-rose-400 font-bold uppercase tracking-wider mt-1">
                Broadcasting Live on EChat
              </p>
              <p className="text-xs text-slate-400 mt-2 max-w-sm">
                "{liveData.title}"
              </p>
            </div>

            {/* Floating Emojis Burst */}
            <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
              {floatingReactions.map(r => (
                <span
                  key={r.id}
                  className="absolute bottom-16 text-3xl animate-bounce drop-shadow-md transition-all duration-1000"
                  style={{ left: `${r.left}%` }}
                >
                  {r.emoji}
                </span>
              ))}
            </div>

            {/* Quick Reaction Bar on Bottom Left */}
            <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 bg-black/60 backdrop-blur-md p-1.5 rounded-2xl border border-white/10">
              <button
                onClick={() => handleSendReaction('❤️')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-rose-500 hover:scale-110 flex items-center justify-center transition cursor-pointer text-base"
                title="Send Love"
              >
                ❤️
              </button>
              <button
                onClick={() => handleSendReaction('🔥')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-amber-500 hover:scale-110 flex items-center justify-center transition cursor-pointer text-base"
                title="Send Fire"
              >
                🔥
              </button>
              <button
                onClick={() => handleSendReaction('👏')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-emerald-500 hover:scale-110 flex items-center justify-center transition cursor-pointer text-base"
                title="Send Claps"
              >
                👏
              </button>
              <button
                onClick={() => handleSendReaction('👍')}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-blue-500 hover:scale-110 flex items-center justify-center transition cursor-pointer text-base"
                title="Send Thumbs Up"
              >
                👍
              </button>
            </div>
          </div>

          {/* Right Side: Live Chat Feed */}
          <div className="w-full md:w-80 bg-slate-900/90 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col h-64 md:h-auto">
            <div className="px-3.5 py-2.5 border-b border-slate-800 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Live Chat Stream
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {comments.map(c => (
                <div key={c.id} className="text-xs bg-slate-800/70 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <img src={c.userAvatar} alt={c.userName} className="w-6 h-6 rounded-full object-cover shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-rose-400 mr-1.5">{c.userName}:</span>
                    <span className="text-slate-200">{c.text}</span>
                  </div>
                </div>
              ))}
              <div ref={commentsEndRef} />
            </div>

            {/* Comment Form */}
            <form onSubmit={handleSendComment} className="p-2.5 border-t border-slate-800 flex gap-2">
              <input
                type="text"
                value={commentInput}
                onChange={e => setCommentInput(e.target.value)}
                placeholder="Say something in live chat..."
                className="flex-1 px-3 py-2 bg-slate-800 text-xs text-white rounded-xl border border-slate-700 focus:outline-hidden focus:border-rose-500"
              />
              <button
                type="submit"
                className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition cursor-pointer"
              >
                <Send size={15} />
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  );
};

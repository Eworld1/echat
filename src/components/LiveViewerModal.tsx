import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { liveRtcConfig } from '../utils/liveRtc';
import { api } from '../services/api';
import { LiveStream, LiveComment } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { useBackButton } from '../hooks/useBackButton';
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
  useBackButton(Boolean(currentStream), onClose, 'live-viewer');
  if (!currentStream) return null;

  const { user } = useAuth();
  const { onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveStopped, onLiveSignal, onLiveCaption, socket } = useSocket();

  const [liveData, setLiveData] = useState<LiveStream>(currentStream);
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<LiveComment[]>(currentStream.comments || []);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; left: number }[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState<MediaStream | null>(null);
  const [showCaptions, setShowCaptions] = useState(true);
  const [captionSize, setCaptionSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [liveCaption, setLiveCaption] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const commentsEndRef = useRef<HTMLDivElement | null>(null);

  // Notify server we joined
  useEffect(() => {
    api.joinLive();
    return () => {
      api.leaveLive();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let peer: RTCPeerConnection | null = null;
    void api.getCallIceConfig().catch(() => liveRtcConfig).then(iceConfig => {
      if (cancelled) return;
      peer = new RTCPeerConnection(iceConfig);
      peerRef.current = peer;
      peer.ontrack = event => {
        const incoming = event.streams[0] || new MediaStream([event.track]);
        setRemoteVideo(incoming);
        if (videoRef.current) videoRef.current.srcObject = incoming;
      };
      peer.onicecandidate = event => {
        if (event.candidate) socket.emit('live:signal', {
          targetUserId: currentStream.hostId,
          streamId: currentStream.id,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      };
      socket.emit('live:signal', { targetUserId: currentStream.hostId, streamId: currentStream.id, signal: { type: 'watch' } });
    });
    const unsubscribeSignal = onLiveSignal(async message => {
      if (message.streamId !== currentStream.id || message.fromUserId !== currentStream.hostId) return;
      const activePeer = peer;
      if (!activePeer) return;
      try {
        const signal = message.signal;
        if (signal.type === 'offer' && signal.description) {
          await activePeer.setRemoteDescription(new RTCSessionDescription(signal.description));
          while (queuedCandidatesRef.current.length) {
            const candidate = queuedCandidatesRef.current.shift();
            if (candidate) await activePeer.addIceCandidate(new RTCIceCandidate(candidate));
          }
          const answer = await activePeer.createAnswer();
          await activePeer.setLocalDescription(answer);
          socket.emit('live:signal', { targetUserId: currentStream.hostId, streamId: currentStream.id, signal: { type: 'answer', description: activePeer.localDescription } });
        } else if (signal.type === 'candidate' && signal.candidate) {
          if (activePeer.remoteDescription) await activePeer.addIceCandidate(new RTCIceCandidate(signal.candidate));
          else queuedCandidatesRef.current.push(signal.candidate);
        }
      } catch (error) {
        console.warn('Could not connect to live video:', error);
      }
    });
    return () => {
      unsubscribeSignal();
      cancelled = true;
      peer?.close();
      peerRef.current = null;
      queuedCandidatesRef.current = [];
      setRemoteVideo(null);
    };
  }, [currentStream.id, currentStream.hostId, onLiveSignal, socket]);

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

  useEffect(() => onLiveCaption(data => { if (data.streamId === currentStream.id) setLiveCaption(data.text); }), [onLiveCaption, currentStream.id]);

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
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-black animate-in fade-in duration-200">
      <div className="bg-black w-full h-full min-w-0 min-h-0 shadow-2xl overflow-hidden flex flex-col">
        
        {/* Stream Header */}
        <div className="absolute top-0 left-0 right-0 z-40 p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/70 text-white">
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
        <div className="flex-1 min-h-0 w-full h-full relative bg-black overflow-hidden">
          
          {/* Main Video Viewport */}
            <div className="absolute inset-0 w-full h-full relative bg-black overflow-hidden">
            <video ref={videoRef} autoPlay playsInline muted={isMuted} className={`absolute inset-0 w-full h-full object-cover object-center ${remoteVideo ? 'block' : 'hidden'}`} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
            {showCaptions && liveCaption && <div className={`absolute bottom-20 left-1/2 z-30 line-clamp-2 max-w-[85%] -translate-x-1/2 rounded bg-black/80 px-3 py-1.5 text-center font-semibold text-white ${captionSize === 'sm' ? 'text-sm' : captionSize === 'lg' ? 'text-xl' : 'text-base'}`}>{liveCaption}</div>}
            <div className="absolute bottom-4 right-4 z-40 flex gap-1 rounded-lg bg-black/75 p-1"><button onClick={() => setShowCaptions(value => !value)} className="px-2 py-1 text-xs font-bold text-white">CC {showCaptions ? 'On' : 'Off'}</button>{showCaptions && <select aria-label="Caption text size" value={captionSize} onChange={event => setCaptionSize(event.target.value as typeof captionSize)} className="bg-transparent text-xs text-white"><option value="sm">Small</option><option value="base">Medium</option><option value="lg">Large</option></select>}</div>
            {!remoteVideo && <div className="flex flex-col items-center justify-center p-8 text-center">
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
                Connecting to live video…
              </p>
              <p className="text-xs text-slate-400 mt-2 max-w-sm">
                "{liveData.title}"
              </p>
            </div>}

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
          <div className="absolute right-0 bottom-0 top-auto w-full md:w-80 bg-slate-900/75 backdrop-blur-sm border-l border-slate-800/70 flex flex-col max-h-[45%] md:top-0 md:max-h-none">
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

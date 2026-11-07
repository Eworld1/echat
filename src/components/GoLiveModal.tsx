import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { api } from '../services/api';
import { LiveStream, LiveComment } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Radio,
  Users,
  Heart,
  Send,
  X,
  Lock,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  Clock,
  Flame,
  ThumbsUp,
  Smile,
  Check
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface GoLiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLiveStarted?: (session: LiveStream) => void;
  onStreamStarted?: (session: LiveStream) => void;
  onLiveEnded?: () => void;
  onStreamEnded?: () => void;
}

export const GoLiveModal: React.FC<GoLiveModalProps> = ({
  isOpen,
  onClose,
  onLiveStarted,
  onStreamStarted,
  onLiveEnded,
  onStreamEnded
}) => {
  const { user, isDeveloper } = useAuth();
  const { onLiveComment, onLiveReaction, onLiveViewersUpdated } = useSocket();

  const [streamTitle, setStreamTitle] = useState(`${user?.name || 'User'} is Live on EChat! 🔥`);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [currentSession, setCurrentSession] = useState<LiveStream | null>(null);
  const [streamDuration, setStreamDuration] = useState(0);
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; left: number }[]>([]);

  // Camera & Mic hardware controls
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate account age in days
  const userCreatedAt = user?.createdAt || Date.now();
  const accountAgeDays = Math.floor((Date.now() - userCreatedAt) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, 60 - accountAgeDays);
  const isEligible = isDeveloper || accountAgeDays >= 60;

  // Initialize camera preview if eligible and open
  useEffect(() => {
    if (!isOpen || !isEligible) return;

    let isMounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true
        });
        if (isMounted) {
          mediaStreamRef.current = stream;
          if (videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = stream;
          }
          setHasCameraPermission(true);
        }
      } catch (err) {
        console.warn('Camera access not granted or unavailable, using broadcast studio simulator:', err);
        if (isMounted) {
          setHasCameraPermission(false);
        }
      }
    }

    startCamera();

    return () => {
      isMounted = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [isOpen, isEligible]);

  // Listen for socket events while live
  useEffect(() => {
    if (!isBroadcasting) return;

    const unsubComment = onLiveComment((comment) => {
      setComments(prev => [...prev.slice(-40), comment]);
    });

    const unsubReaction = onLiveReaction((data) => {
      const emoji = data?.emoji || '❤️';
      const id = 'react_' + Math.random();
      setFloatingReactions(prev => [
        ...prev.slice(-15),
        { id, emoji, left: Math.floor(Math.random() * 70) + 15 }
      ]);
      setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== id));
      }, 2500);
    });

    const unsubViewers = onLiveViewersUpdated((count) => {
      setCurrentSession(prev => prev ? { ...prev, viewersCount: count } : null);
    });

    return () => {
      unsubComment();
      unsubReaction();
      unsubViewers();
    };
  }, [isBroadcasting, onLiveComment, onLiveReaction, onLiveViewersUpdated]);

  // Stream duration timer
  useEffect(() => {
    if (isBroadcasting) {
      timerRef.current = setInterval(() => {
        setStreamDuration(d => d + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setStreamDuration(0);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isBroadcasting]);

  if (!isOpen) return null;

  const toggleVideo = () => {
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsVideoMuted(!track.enabled);
      }
    } else {
      setIsVideoMuted(!isVideoMuted);
    }
  };

  const toggleAudio = () => {
    if (mediaStreamRef.current) {
      const track = mediaStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setIsAudioMuted(!track.enabled);
      }
    } else {
      setIsAudioMuted(!isAudioMuted);
    }
  };

  const handleStartBroadcast = async () => {
    try {
      const res = await api.startLive(streamTitle);
      if (res.success && res.live) {
        setCurrentSession(res.live);
        setComments(res.live.comments || []);
        setIsBroadcasting(true);
        onLiveStarted?.(res.live);
        onStreamStarted?.(res.live);
        confetti({ particleCount: 50, spread: 70 });
      }
    } catch (err: any) {
      alert(err.message || 'Failed to start live stream');
    }
  };

  const handleEndBroadcast = async () => {
    if (!confirm('Are you sure you want to end your live stream?')) return;
    try {
      await api.stopLive();
      setIsBroadcasting(false);
      setCurrentSession(null);
      onLiveEnded?.();
      onStreamEnded?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to end live stream:', err);
      setIsBroadcasting(false);
      onClose();
    }
  };

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

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      
      {/* CASE A: User is GATED (< 60 days and not Developer) */}
      {!isEligible ? (
        <div className="bg-white w-full max-w-md rounded-3xl p-6 sm:p-8 shadow-2xl border border-slate-200 text-center relative overflow-hidden">
          {/* Decorative Background Glow */}
          <div className="absolute -top-16 -right-16 w-40 h-40 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-16 -left-16 w-40 h-40 bg-rose-400/20 rounded-full blur-3xl pointer-events-none" />

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition"
          >
            <X size={18} />
          </button>

          <div className="w-18 h-18 rounded-3xl bg-amber-50 text-amber-500 border border-amber-200/80 flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Lock size={32} />
          </div>

          <span className="text-[11px] font-extrabold uppercase tracking-wider bg-amber-100 text-amber-800 px-3 py-1 rounded-full">
            Feature Locked (60-Day Policy)
          </span>

          <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-3">
            Go Live Unlocks After 60 Days
          </h2>

          <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
            Go Live unlocks after <strong>60 days</strong> on EChat. Keep posting, engaging, and sharing stories to unlock!
          </p>

          {/* Account Age Progress Bar */}
          <div className="my-5 p-4 bg-slate-50 border border-slate-200/90 rounded-2xl text-left space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Clock size={14} className="text-amber-500" />
                Account Age:
              </span>
              <span className="text-blue-600">{accountAgeDays} / 60 days</span>
            </div>

            <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 to-blue-600 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, (accountAgeDays / 60) * 100))}%` }}
              />
            </div>

            <p className="text-[11px] text-slate-400">
              {daysRemaining > 0
                ? `${daysRemaining} more days remaining until live video broadcasts unlock.`
                : 'Unlocked! Processing verification status...'}
            </p>
          </div>

          <div className="space-y-2 text-left bg-blue-50/60 border border-blue-100 rounded-xl p-3 text-[11px] text-blue-900 font-medium">
            <div className="flex items-center gap-2">
              <ShieldCheck size={14} className="text-blue-600 shrink-0" />
              <span>Protects the community against impersonation and spam</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-amber-500 shrink-0" />
              <span>Developer accounts bypass this rule for official live streams</span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-full mt-5 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-sm shadow-md transition cursor-pointer"
          >
            I Understand
          </button>
        </div>
      ) : (
        /* CASE B: User is ELIGIBLE (Developer or >= 60 days) */
        <div className="bg-slate-950 w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
          
          {/* Top Bar */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 text-white">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src={user?.avatar}
                  alt={user?.name}
                  className="w-10 h-10 rounded-full object-cover border-2 border-rose-500"
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-rose-500 rounded-full ring-2 ring-slate-900 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold">{user?.name}</span>
                  {(user?.isVerified || isDeveloper) && <VerifiedBadge size={14} />}
                  {isDeveloper && (
                    <span className="bg-purple-600/90 text-white text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase">
                      Developer Bypass
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  {isBroadcasting ? (
                    <span className="flex items-center gap-1 text-rose-500 font-bold animate-pulse">
                      <Radio size={12} /> LIVE • {formatDuration(streamDuration)}
                    </span>
                  ) : (
                    <span>Broadcast Studio Setup</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {isBroadcasting && (
                <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-full text-xs font-semibold text-slate-300">
                  <Users size={12} className="text-rose-400" />
                  <span>{currentSession?.viewersCount || 1} watching</span>
                </div>
              )}
              {!isBroadcasting ? (
                <button
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition"
                >
                  <X size={20} />
                </button>
              ) : (
                <button
                  onClick={handleEndBroadcast}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition shadow-md cursor-pointer"
                >
                  End Stream
                </button>
              )}
            </div>
          </div>

          {/* Main Broadcast Stage */}
          <div className="flex-1 min-h-[360px] sm:min-h-[460px] relative bg-black flex flex-col md:flex-row overflow-hidden">
            
            {/* Video Viewport */}
            <div className="flex-1 relative flex items-center justify-center bg-radial from-slate-900 to-black overflow-hidden">
              
              {/* Video Element (Live Camera) */}
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${isVideoMuted ? 'hidden' : 'block'}`}
              />

              {/* Fallback Camera Simulation if no camera attached / permission denied */}
              {isVideoMuted || hasCameraPermission === false && (
                <div className="flex flex-col items-center justify-center p-8 text-center text-slate-300">
                  <div className="relative mb-4">
                    <img
                      src={user?.avatar}
                      alt="Host"
                      className="w-24 h-24 rounded-full object-cover ring-4 ring-rose-500/80 shadow-2xl"
                    />
                    <div className="absolute inset-0 rounded-full border-4 border-rose-500 animate-ping opacity-25" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{user?.name}</h3>
                  <p className="text-xs text-slate-400 max-w-xs mt-1">
                    {isVideoMuted ? 'Camera video is temporarily paused' : 'Broadcasting HD Studio Feed with Audio & Interactive Chat'}
                  </p>
                </div>
              )}

              {/* Floating Live Badge Over Video */}
              {isBroadcasting && (
                <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
                  <span className="bg-rose-600 text-white text-xs font-black uppercase px-2.5 py-1 rounded-md tracking-wider flex items-center gap-1 shadow-lg animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                    LIVE
                  </span>
                  <span className="bg-black/60 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-md font-mono">
                    {formatDuration(streamDuration)}
                  </span>
                </div>
              )}

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

              {/* Hardware Control Buttons Overlay */}
              <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-auto">
                <div className="flex items-center gap-2 bg-black/60 backdrop-blur-md p-1.5 rounded-2xl border border-white/10">
                  <button
                    onClick={toggleVideo}
                    className={`p-2 rounded-xl transition cursor-pointer ${
                      isVideoMuted ? 'bg-rose-600 text-white' : 'bg-white/15 text-white hover:bg-white/25'
                    }`}
                    title={isVideoMuted ? 'Turn on Camera' : 'Turn off Camera'}
                  >
                    {isVideoMuted ? <VideoOff size={18} /> : <Video size={18} />}
                  </button>

                  <button
                    onClick={toggleAudio}
                    className={`p-2 rounded-xl transition cursor-pointer ${
                      isAudioMuted ? 'bg-rose-600 text-white' : 'bg-white/15 text-white hover:bg-white/25'
                    }`}
                    title={isAudioMuted ? 'Unmute Mic' : 'Mute Mic'}
                  >
                    {isAudioMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                </div>

                {!isBroadcasting ? (
                  <button
                    onClick={handleStartBroadcast}
                    className="px-6 py-2.5 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold text-sm rounded-2xl shadow-xl shadow-rose-600/40 flex items-center gap-2 transition hover:scale-105 cursor-pointer"
                  >
                    <Radio size={18} />
                    Go Live Now
                  </button>
                ) : null}
              </div>
            </div>

            {/* Right Side: Live Comments & Stream Info */}
            <div className="w-full md:w-80 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col h-64 md:h-auto">
              {/* Title Header */}
              <div className="p-3 border-b border-slate-800">
                {!isBroadcasting ? (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Stream Title
                    </label>
                    <input
                      type="text"
                      value={streamTitle}
                      onChange={e => setStreamTitle(e.target.value)}
                      placeholder="What is your live stream about?"
                      className="w-full px-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-hidden focus:border-rose-500"
                    />
                  </div>
                ) : (
                  <div>
                    <h4 className="text-xs font-bold text-white truncate">{streamTitle}</h4>
                    <p className="text-[11px] text-slate-400">Live audience interaction feed</p>
                  </div>
                )}
              </div>

              {/* Comments Feed */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {comments.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    Live comments from your viewers will appear here in real-time.
                  </div>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="text-xs bg-slate-800/60 p-2 rounded-xl border border-slate-800 flex items-start gap-2">
                      <img src={c.userAvatar} alt={c.userName} className="w-6 h-6 rounded-full object-cover shrink-0" />
                      <div className="min-w-0">
                        <span className="font-bold text-rose-400 mr-1.5">{c.userName}:</span>
                        <span className="text-slate-200">{c.text}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Host Comment Input */}
              {isBroadcasting && (
                <form onSubmit={handleSendComment} className="p-2 border-t border-slate-800 flex gap-2">
                  <input
                    type="text"
                    value={commentInput}
                    onChange={e => setCommentInput(e.target.value)}
                    placeholder="Say something to your viewers..."
                    className="flex-1 px-3 py-1.5 bg-slate-800 text-xs text-white rounded-xl border border-slate-700 focus:outline-hidden focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    className="p-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl transition cursor-pointer"
                  >
                    <Send size={14} />
                  </button>
                </form>
              )}
            </div>

          </div>

        </div>
      )}

    </div>
  );
};

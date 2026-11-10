import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { liveRtcConfig } from '../utils/liveRtc';
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
  , Captions
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
  const { onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveSignal, sendLiveCaption, socket } = useSocket();

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
  const [videoQuality, setVideoQuality] = useState<'360p' | '720p' | '1080p' | '4k'>('720p');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState('');
  const [availablePages, setAvailablePages] = useState<{ id: string; name: string }[]>([]);
  const [taggedPageIds, setTaggedPageIds] = useState<string[]>([]);
  const [pageSearch, setPageSearch] = useState('');
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionLanguage, setCaptionLanguage] = useState('en-US');
  const [liveCaption, setLiveCaption] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [cameraRetry, setCameraRetry] = useState(0);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const livePeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const livePendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const lastCaptionSentRef = useRef(0);
  const screenStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!isBroadcasting || !currentSession || !captionsEnabled) { recognitionRef.current?.stop?.(); recognitionRef.current = null; return; }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition(); recognitionRef.current = recognition;
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = captionLanguage === 'auto' ? navigator.language || 'en-US' : captionLanguage;
    recognition.onresult = (event: any) => {
      const text = String(event.results[event.results.length - 1]?.[0]?.transcript || '').trim();
      if (!text) return;
      setLiveCaption(text);
      const now = Date.now();
      if (now - lastCaptionSentRef.current >= 1000 && event.results[event.results.length - 1]?.isFinal) { lastCaptionSentRef.current = now; sendLiveCaption(currentSession.id, text); }
    };
    recognition.onend = () => { if (recognitionRef.current === recognition && captionsEnabled) { try { recognition.start(); } catch {} } };
    try { recognition.start(); } catch {}
    return () => { recognitionRef.current = null; try { recognition.stop(); } catch {} };
  }, [isBroadcasting, currentSession?.id, captionsEnabled, captionLanguage, sendLiveCaption]);

  const startScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenVideo = screen.getVideoTracks()[0];
      if (!screenVideo) throw new Error('No screen video source was selected');
      const current = mediaStreamRef.current;
      if (current) {
        current.getVideoTracks().forEach(track => { current.removeTrack(track); track.stop(); });
        for (const peer of livePeersRef.current.values()) {
          const sender = peer.getSenders().find(item => item.track?.kind === 'video');
          if (sender) await sender.replaceTrack(screenVideo);
        }
        current.addTrack(screenVideo);
        const screenAudio = screen.getAudioTracks()[0];
        if (screenAudio) current.addTrack(screenAudio);
        if (videoPreviewRef.current) { videoPreviewRef.current.srcObject = current; videoPreviewRef.current.play().catch(() => {}); }
      } else mediaStreamRef.current = screen;
      screenStreamRef.current = screen;
      setHasCameraPermission(true);
      screenVideo.onended = async () => {
        screenStreamRef.current = null;
        try {
          const camera = await navigator.mediaDevices.getUserMedia({ video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : true, audio: false });
          const track = camera.getVideoTracks()[0]; const active = mediaStreamRef.current;
          if (active && track) { for (const peer of livePeersRef.current.values()) { const sender = peer.getSenders().find(item => item.track?.kind === 'video'); if (sender) await sender.replaceTrack(track).catch(() => {}); } active.getVideoTracks().forEach(old => { active.removeTrack(old); old.stop(); }); active.addTrack(track); if (videoPreviewRef.current) { videoPreviewRef.current.srcObject = active; videoPreviewRef.current.play().catch(() => {}); } }
        } catch { setSourceError('Capture card not found - check USB / OBS Virtual Camera is running.'); }
      };
    } catch (error) {
      const e = error as DOMException;
      if (e.name !== 'NotAllowedError') console.warn('Screen share source unavailable; choose a camera or capture card instead.', error);
    }
  };

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
      if (screenStreamRef.current && !selectedCameraId) return;
      try {
        setSourceError('');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : {}),
            width: { ideal: ({ '360p': 640, '720p': 1280, '1080p': 1920, '4k': 3840 } as const)[videoQuality] },
            height: { ideal: ({ '360p': 360, '720p': 720, '1080p': 1080, '4k': 2160 } as const)[videoQuality] }
          },
          audio: { ...(selectedMicrophoneId ? { deviceId: { exact: selectedMicrophoneId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (isMounted) {
          mediaStreamRef.current = stream;
          const liveTrack = stream.getVideoTracks()[0];
          for (const peer of livePeersRef.current.values()) {
            const sender = peer.getSenders().find(item => item.track?.kind === 'video');
            if (sender && liveTrack) await sender.replaceTrack(liveTrack).catch(() => {});
          }
          setDevices(await navigator.mediaDevices.enumerateDevices());
          if (videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = stream;
            videoPreviewRef.current.play().catch(() => {});
          }
          setHasCameraPermission(true);
        }
      } catch (err) {
        console.warn('Camera or microphone access is unavailable:', err);
        if (selectedCameraId) {
          setSourceError('Capture card not found - check USB / OBS Virtual Camera is running. Switching to your phone camera.');
          try {
            const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (isMounted) { mediaStreamRef.current?.getTracks().forEach(track => track.stop()); mediaStreamRef.current = fallback; if (videoPreviewRef.current) videoPreviewRef.current.srcObject = fallback; setHasCameraPermission(true); setSelectedCameraId(''); }
            return;
          } catch { }
        }
        if (isMounted) {
          setHasCameraPermission(false);
          setSourceError('Camera or microphone access is unavailable.');
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
  }, [isOpen, isEligible, videoQuality, selectedCameraId, selectedMicrophoneId, cameraRetry]);

  useEffect(() => {
    if (!isOpen) return;
    api.getPages().then(pages => setAvailablePages(pages.map(page => ({ id: page.id, name: page.name })))).catch(() => setAvailablePages([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isBroadcasting || !currentSession) return;
    const stopSignalListener = onLiveSignal(async message => {
      if (message.streamId !== currentSession.id) return;
      const signal = message.signal;
      try {
        if (signal.type === 'watch') {
          const stream = mediaStreamRef.current;
          if (!stream) return;
          livePeersRef.current.get(message.fromUserId)?.close();
          const iceConfig = await api.getCallIceConfig().catch(() => liveRtcConfig);
          const peer = new RTCPeerConnection(iceConfig);
          livePeersRef.current.set(message.fromUserId, peer);
          stream.getTracks().forEach(track => peer.addTrack(track, stream));
          peer.onicecandidate = event => {
            if (event.candidate) socket.emit('live:signal', { targetUserId: message.fromUserId, streamId: currentSession.id, signal: { type: 'candidate', candidate: event.candidate } });
          };
          peer.onconnectionstatechange = () => {
            if (peer.connectionState === 'closed' || peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
              peer.close();
              if (livePeersRef.current.get(message.fromUserId) === peer) livePeersRef.current.delete(message.fromUserId);
            }
          };
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.emit('live:signal', { targetUserId: message.fromUserId, streamId: currentSession.id, signal: { type: 'offer', description: peer.localDescription } });
        } else {
          const peer = livePeersRef.current.get(message.fromUserId);
          if (!peer) return;
          if (signal.type === 'answer' && signal.description) {
            await peer.setRemoteDescription(new RTCSessionDescription(signal.description));
            const pending = livePendingCandidatesRef.current.get(message.fromUserId) || [];
            livePendingCandidatesRef.current.delete(message.fromUserId);
            for (const candidate of pending) await peer.addIceCandidate(new RTCIceCandidate(candidate));
          }
          if (signal.type === 'candidate' && signal.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(new RTCIceCandidate(signal.candidate));
            else livePendingCandidatesRef.current.set(message.fromUserId, [...(livePendingCandidatesRef.current.get(message.fromUserId) || []), signal.candidate]);
          }
        }
      } catch (error) {
        console.warn('Could not establish the live video connection:', error);
      }
    });
    return () => {
      stopSignalListener();
      livePeersRef.current.forEach(peer => peer.close());
      livePeersRef.current.clear();
      livePendingCandidatesRef.current.clear();
    };
  }, [isBroadcasting, currentSession?.id, onLiveSignal, socket]);

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
      if (!mediaStreamRef.current?.getVideoTracks().length) {
        alert('Allow camera access before starting a live video.');
        return;
      }
      const res = await api.startLive(streamTitle, taggedPageIds);
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

  const changeVideoQuality = async (quality: '360p' | '720p' | '1080p' | '4k') => {
    setVideoQuality(quality);
    const track = mediaStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const dimensions = ({
      '360p': { width: 640, height: 360 },
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '4k': { width: 3840, height: 2160 }
    } as const)[quality];
    try { await track.applyConstraints({ width: { ideal: dimensions.width }, height: { ideal: dimensions.height } }); }
    catch { alert('This camera or device cannot provide that quality. Choose a lower option.'); }
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
        <div className="bg-slate-950 w-full max-w-4xl h-[90dvh] max-h-[90vh] rounded-3xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col">
          
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

            <label className="flex items-center gap-2 text-xs text-slate-300">
              Quality
              <select value={videoQuality} onChange={e => void changeVideoQuality(e.target.value as typeof videoQuality)} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-white">
                <option value="360p">360p</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K</option>
              </select>
            </label>

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
          <div className="flex-1 min-h-0 relative bg-black flex flex-col md:flex-row overflow-hidden">
            
            {/* Video Viewport */}
            <div className="flex-1 relative w-full h-[38%] md:h-full min-h-[180px] md:min-h-0 min-w-0 flex items-center justify-center bg-black overflow-hidden">
              
              {/* Video Element (Live Camera) */}
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className={`absolute inset-0 w-full h-full object-cover object-center ${isVideoMuted ? 'hidden' : 'block'}`}
                style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
              />

              {/* Fallback Camera Simulation if no camera attached / permission denied */}
              {(isVideoMuted || hasCameraPermission === false || hasCameraPermission === null) && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-950 p-8 text-center text-slate-300">
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
                    {isVideoMuted ? 'Camera video is temporarily paused' : hasCameraPermission === false ? 'Camera access is blocked. Allow camera access and try again.' : 'Starting camera preview…'}
                  </p>
                  {hasCameraPermission === false && <button type="button" onClick={() => { setSourceError(''); setHasCameraPermission(null); setCameraRetry(value => value + 1); }} className="mt-3 rounded-lg bg-rose-600 px-3 py-2 text-xs font-bold text-white">Retry Camera</button>}
                </div>
              )}

              {/* Floating Live Badge Over Video */}
              {liveCaption && captionsEnabled && <div className="absolute bottom-20 left-1/2 z-30 max-w-[85%] -translate-x-1/2 rounded bg-black/80 px-3 py-1.5 text-center text-sm font-semibold text-white">{liveCaption}</div>}
              <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[10px] font-bold text-white"><img src="/logo-192.png" alt="" className="h-5 w-5 rounded-full" />EchatSl</div>
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
              <div className="absolute bottom-4 left-4 right-4 z-20 flex items-center justify-start pointer-events-auto">
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

              </div>
            </div>

            {/* Right Side: Live Comments & Stream Info */}
            <div className="w-full md:w-80 bg-slate-900 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col h-[45%] min-h-0 md:h-auto">
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

              {!isBroadcasting && (
                <div className="max-h-[25vh] shrink-0 space-y-2 overflow-y-auto border-b border-slate-800 p-3">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Camera
                    <select value={selectedCameraId} onChange={event => setSelectedCameraId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs normal-case text-white">
                      <option value="">Default camera</option>{devices.filter(device => device.kind === 'videoinput').map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Camera'}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => void startScreenShare()} className="w-full rounded-lg border border-sky-700 bg-sky-950/60 px-3 py-2 text-left text-xs font-bold text-sky-200 hover:bg-sky-900">Share screen or capture card</button>
                  <p className="text-[10px] text-slate-500">External webcams, Elgato and OBS Virtual Camera appear in the Camera list.</p>
                  {sourceError && <p role="alert" className="rounded-lg bg-rose-950/70 p-2 text-[10px] text-rose-200">{sourceError}</p>}
                  <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={captionsEnabled} onChange={event => setCaptionsEnabled(event.target.checked)} />Auto-captions</label>
                  {captionsEnabled && <select value={captionLanguage} onChange={event => setCaptionLanguage(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white"><option value="en-US">English</option><option value="auto">Auto (browser default)</option><option value="es-ES">Spanish</option><option value="fr-FR">French</option></select>}
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Microphone
                    <select value={selectedMicrophoneId} onChange={event => setSelectedMicrophoneId(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs normal-case text-white">
                      <option value="">Default microphone</option>{devices.filter(device => device.kind === 'audioinput').map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
                    </select>
                  </label>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Tag Pages ({taggedPageIds.length}/22)</label>
                    <input value={pageSearch} onChange={event => setPageSearch(event.target.value)} placeholder="Search pages" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-white placeholder:text-slate-500" />
                    <div className="mt-1 max-h-24 overflow-y-auto">{availablePages.filter(page => page.name.toLowerCase().includes(pageSearch.toLowerCase())).map(page => {
                      const checked = taggedPageIds.includes(page.id);
                      return <label key={page.id} className="flex cursor-pointer items-center gap-2 py-1 text-xs text-slate-300"><input type="checkbox" checked={checked} disabled={!checked && taggedPageIds.length >= 22} onChange={() => setTaggedPageIds(current => checked ? current.filter(id => id !== page.id) : [...current, page.id].slice(0, 22))} />{page.name}</label>;
                    })}</div>
                  </div>
                </div>
              )}

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

          {!isBroadcasting && <div className="sticky bottom-0 z-40 flex shrink-0 gap-2 border-t border-slate-800 bg-slate-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-5 py-3 font-bold text-slate-200">Cancel</button>
            <button type="button" onClick={handleStartBroadcast} disabled={!mediaStreamRef.current?.getVideoTracks().length || hasCameraPermission === false} className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-5 py-3 text-base font-extrabold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"><Radio size={18} className="mr-2 inline" />Go Live</button>
          </div>}

        </div>
      )}

    </div>
  );
};

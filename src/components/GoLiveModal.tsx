import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { liveRtcConfig } from '../utils/liveRtc';
import { api } from '../services/api';
import { auth } from '../services/firebase';
import { LiveStream, LiveComment, LiveCategory, LiveLocation } from '../types';
import { addLiveComment, blockLiveUser, deleteLiveComment, listenLiveComments, LIVE_CATEGORIES, LIVE_LOCATIONS, timeoutLiveUser } from '../services/liveDiscovery';
import { collection, query, where } from 'firebase/firestore';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { VerifiedBadge } from './VerifiedBadge';
import { SoftwareLivePreview } from './SoftwareLivePreview';
import { avatarSrc } from './UserAvatar';
import {
  Video,
  VideoOff,
  Mic,
  MicOff,
  Radio,
  Users,
  Copy,
  Eye,
  EyeOff,
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
  Check,
  Trash2,
  Ban,
  MoreVertical,
  Captions,
  RotateCcw,
  SwitchCamera
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { useBackButton } from '../hooks/useBackButton';
import { GO_LIVE, getGoLiveEligibility } from '../config/featureFlags';
// @ts-ignore The SDK package is installed by Vercel's production install; local package typings may be absent in managed workspaces.
import { Room, Track } from 'livekit-client';

type VideoQuality = '720p' | '480p' | '360p';
const QUALITY_DIMENSIONS: Record<VideoQuality, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '480p': { width: 854, height: 480 },
  '360p': { width: 640, height: 360 }
};

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
  const { user, isDeveloper, isLoading: authLoading, logout } = useAuth();
  const { onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveSignal, sendLiveCaption, socket } = useSocket();

  const [streamTitle, setStreamTitle] = useState(`${user?.name || 'User'} is Live on EChat! 🔥`);
  const [streamCategory, setStreamCategory] = useState<LiveCategory>('Just Chatting');
  const [streamLocation, setStreamLocation] = useState<LiveLocation | ''>(() => {
    const profileCity = (user?.location || '').toLowerCase();
    return LIVE_LOCATIONS.find(city => city !== 'Other' && profileCity.includes(city.toLowerCase())) || '';
  });
  const [streamUnderReview, setStreamUnderReview] = useState(false);
  const [commentMenuId, setCommentMenuId] = useState<string | null>(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [currentSession, setCurrentSession] = useState<LiveStream | null>(null);
  const [streamDuration, setStreamDuration] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [endConfirmationOpen, setEndConfirmationOpen] = useState(false);
  const [endingLive, setEndingLive] = useState(false);
  const [endSummary, setEndSummary] = useState<{ duration: number; viewers: number; comments: number; message: string } | null>(null);
  const [studioMode, setStudioMode] = useState<'camera' | 'software'>('camera');
  const [streamKey, setStreamKey] = useState('');
  const [streamKeyServerUrl, setStreamKeyServerUrl] = useState('');
  const [streamKeyIngestConfigured, setStreamKeyIngestConfigured] = useState(false);
  const [streamKeyLoading, setStreamKeyLoading] = useState(false);
  const [streamKeyVisible, setStreamKeyVisible] = useState(false);
  const [streamKeyError, setStreamKeyError] = useState('');
  const [streamKeyNotice, setStreamKeyNotice] = useState('');
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<LiveComment[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; left: number }[]>([]);

  // Camera & Mic hardware controls
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('720p');
  const videoQualityRef = useRef<VideoQuality>('720p');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [liveConfig, setLiveConfig] = useState<{ ready: boolean; missing: string[]; liveKitUrlLooksValid: boolean; webhookUrl: string; liveKitAuthOk?: boolean | null; liveKitError?: string } | null>(null);
  const [streamKeyRetry, setStreamKeyRetry] = useState(0);
  const [rtmpDetails, setRtmpDetails] = useState<{ title: string; category: string; location: string }>({ title: '', category: 'Just Chatting', location: '' });
  const [rtmpDetailsNotice, setRtmpDetailsNotice] = useState('');
  const [rtmpDetailsSaving, setRtmpDetailsSaving] = useState(false);
  const [softwareLive, setSoftwareLive] = useState<LiveStream | null>(null);
  const [rtmpPoll, setRtmpPoll] = useState<{ publishing: boolean; ingressStatus: number; held: boolean } | null>(null);
  const [softwareNow, setSoftwareNow] = useState(() => Date.now());
  const lastReactionCountRef = useRef<number | null>(null);
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
  const [liveStartError, setLiveStartError] = useState('');
  const [cameraRetry, setCameraRetry] = useState(0);
  const [accessInfo, setAccessInfo] = useState<Awaited<ReturnType<typeof api.getLiveAccess>> | null>(null);
  const [accessLoading, setAccessLoading] = useState(true);
  const [accessReason, setAccessReason] = useState('');
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [accessNotice, setAccessNotice] = useState('');
  const [accessErrorCode, setAccessErrorCode] = useState('');
  const [accessCheckAttempts, setAccessCheckAttempts] = useState(0);
  const [authWaitExpired, setAuthWaitExpired] = useState(false);

  const firebaseUser = auth.currentUser;
  const developerUid = String(import.meta.env.VITE_SUPER_ADMIN_UID || '').trim();
  const configuredDeveloper = Boolean(firebaseUser && developerUid && firebaseUser.uid === developerUid);
  const developerIdentity = Boolean(isDeveloper || configuredDeveloper);
  const signedIn = Boolean(user || firebaseUser);

  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const livePeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const livePendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const endSummaryTimerRef = useRef<number | null>(null);
  const endingLiveRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const lastCaptionSentRef = useRef(0);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const liveKitRoomRef = useRef<Room | null>(null);
  const streamKeyOwnerRef = useRef(firebaseUser?.uid || user?.id || '');
  streamKeyOwnerRef.current = firebaseUser?.uid || user?.id || '';

  useBackButton(isOpen, () => {
    if (endingLive) return;
    if (isBroadcasting) setEndConfirmationOpen(true);
    else onClose();
  }, 'go-live-studio');

  useEffect(() => () => {
    if (endSummaryTimerRef.current) clearTimeout(endSummaryTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen && endSummaryTimerRef.current) {
      clearTimeout(endSummaryTimerRef.current);
      endSummaryTimerRef.current = null;
    }
  }, [isOpen]);

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

  const goLiveEligibility = getGoLiveEligibility({ role: user?.role, isAdmin: user?.isAdmin, isDeveloper: developerIdentity, createdAt: user?.createdAt || (accessInfo?.accountAgeDays ? Date.now() - accessInfo.accountAgeDays * 86400000 : 0) });
  const isLiveBlocked = Boolean(user?.isBlocked || accessInfo?.liveAccess === 'blocked');
  const hasLivePermission = Boolean(goLiveEligibility.developer || (!isLiveBlocked && goLiveEligibility.canGoLive));

  const checkLiveAccess = async () => {
    if (authLoading || !signedIn) return;
    setAccessLoading(true);
    setAccessError('');
    setAccessErrorCode('');
    try {
      if (developerIdentity) {
        const info = { liveAccess: 'approved' as const, mode: 'approved_only' as const, canGoLive: true, request: null, accountAgeDays: 0, daysUntilEligible: 0, autoApproved: false };
        setAccessInfo(info);
        console.info('[Go Live] Access check', { uid: firebaseUser?.uid || user?.id, liveAccess: info.liveAccess, role: user?.role || 'super_admin', accountAgeDays: info.accountAgeDays });
        return;
      }
      const info = await api.getLiveAccess(true);
      setAccessInfo(info);
      setAccessCheckAttempts(0);
      if (info.autoApproved) setAccessNotice('You are now eligible! Your account has been approved for Go Live.');
      console.info('[Go Live] Access check', { uid: firebaseUser?.uid || user?.id, liveAccess: info.liveAccess, role: user?.role || 'user', accountAgeDays: info.accountAgeDays });
    } catch (error) {
      const liveError = error as Error & { code?: string };
      setAccessError(error instanceof Error ? error.message : 'Could not check Go Live access.');
      setAccessErrorCode(liveError.code || 'unknown');
      setAccessCheckAttempts(count => count + 1);
      console.error('[Go Live] Access check failed', { uid: firebaseUser?.uid || user?.id, code: liveError.code || 'unknown', error });
    } finally {
      setAccessLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !authLoading) { setAuthWaitExpired(false); return; }
    const timeout = window.setTimeout(() => setAuthWaitExpired(true), 3000);
    return () => window.clearTimeout(timeout);
  }, [isOpen, authLoading]);

  // Whole days only: the exact age changes every millisecond, which re-ran this effect on every render (render loop).
  const accountAgeWholeDays = Math.floor(goLiveEligibility.ageDaysExact || 0);
  useEffect(() => {
    if (!isOpen) return;
    setAccessLoading(true);
    setAccessError('');
    setAccessNotice('');
    if (authLoading) return;
    if (!signedIn) { setAccessInfo(null); setAccessLoading(false); return; }

    const blocked = Boolean(user?.isBlocked);
    const permitted = goLiveEligibility.developer || (!blocked && goLiveEligibility.canGoLive);
    const info = {
      liveAccess: blocked ? 'blocked' as const : permitted ? 'approved' as const : 'none' as const,
      mode: 'approved_only' as const,
      canGoLive: permitted,
      request: null,
      accountAgeDays: goLiveEligibility.ageDaysExact,
      daysUntilEligible: goLiveEligibility.daysLeft,
      autoApproved: false
    };
    setAccessInfo(info);
    setAccessLoading(false);
    console.info('[Go Live] Local eligibility check', { uid: firebaseUser?.uid || user?.id, role: user?.role || 'user', accountAgeDays: info.accountAgeDays, canGoLive: info.canGoLive });
  }, [isOpen, user?.id, user?.role, user?.isAdmin, user?.isBlocked, user?.createdAt, authLoading, developerIdentity, signedIn, accountAgeWholeDays, goLiveEligibility.daysLeft, goLiveEligibility.developer, goLiveEligibility.canGoLive]);

  const sendAccessRequest = async () => {
    setAccessBusy(true); setAccessError('');
    try {
      await api.requestLiveAccess(accessReason);
      setAccessReason('');
      setAccessNotice('Request sent to Admin');
      const updated = await api.getLiveAccess();
      setAccessInfo(updated);
    } catch (error) { setAccessError(error instanceof Error ? error.message : 'Could not send your request.'); }
    finally { setAccessBusy(false); }
  };

  const cancelAccessRequest = async () => {
    setAccessBusy(true); setAccessError('');
    try { await api.cancelLiveAccessRequest(); setAccessInfo(await api.getLiveAccess()); }
    catch (error) { setAccessError(error instanceof Error ? error.message : 'Could not cancel your request.'); }
    finally { setAccessBusy(false); }
  };

  // Initialize camera preview if eligible and open
  useEffect(() => {
    if (!isOpen || !hasLivePermission || studioMode !== 'camera') return;

    let isMounted = true;
    async function startCamera() {
      if (screenStreamRef.current && !selectedCameraId) return;
      try {
        setSourceError('');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: { ideal: facingModeRef.current } }),
            width: { ideal: QUALITY_DIMENSIONS[videoQualityRef.current].width },
            height: { ideal: QUALITY_DIMENSIONS[videoQualityRef.current].height },
            frameRate: { ideal: 30 }
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
      const streams = new Set([mediaStreamRef.current, screenStreamRef.current].filter((stream): stream is MediaStream => Boolean(stream)));
      for (const stream of streams) {
        stream.getTracks().forEach(track => {
          track.onended = null;
          track.stop();
        });
      }
      mediaStreamRef.current = null;
      screenStreamRef.current = null;
      if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null;
    };
    // Quality changes resize the running track (changeVideoQuality) instead of restarting the camera,
    // so switching quality while live no longer drops the published LiveKit track.
  }, [isOpen, hasLivePermission, studioMode, selectedCameraId, selectedMicrophoneId, cameraRetry]);

  useEffect(() => {
    if (!isOpen || studioMode !== 'software') return;
    if (!signedIn) {
      setStreamKey('');
      setStreamKeyError('');
      return;
    }
    const ownerId = firebaseUser?.uid || user?.id || '';
    let active = true;
    setStreamKeyLoading(true);
    setStreamKey('');
    setStreamKeyError('');
    setStreamKeyNotice('');
    void api.getLiveStreamKey().then(result => {
      if (!active || streamKeyOwnerRef.current !== ownerId) return;
      setStreamKey(result.streamKey);
      setStreamKeyServerUrl(result.serverUrl);
      setStreamKeyIngestConfigured(result.ingestConfigured);
      setStreamKeyVisible(false);
    }).catch(error => {
      if (active && streamKeyOwnerRef.current === ownerId) setStreamKeyError(error instanceof Error ? error.message : 'Could not load your stream key.');
    }).finally(() => {
      if (active) setStreamKeyLoading(false);
    });
    return () => { active = false; };
  }, [isOpen, studioMode, signedIn, firebaseUser?.uid, user?.id, streamKeyRetry]);

  useEffect(() => {
    if (!isOpen) return;
    api.getPages().then(pages => setAvailablePages(pages.map(page => ({ id: page.id, name: page.name })))).catch(() => setAvailablePages([]));
  }, [isOpen]);

  useEffect(() => {
    if (!isBroadcasting || !currentSession) return;
    if (currentSession.liveKitRoom) return;
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
      setPeakViewers(prev => Math.max(prev, count));
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

  /** Turn camera or mic on/off. While live, the LiveKit publication is muted too so viewers see/hear the change. */
  const setTrackMuted = async (kind: 'video' | 'audio', muted: boolean) => {
    const track = kind === 'video' ? mediaStreamRef.current?.getVideoTracks()[0] : mediaStreamRef.current?.getAudioTracks()[0];
    const publication = liveKitRoomRef.current?.localParticipant.getTrackPublication(kind === 'video' ? Track.Source.Camera : Track.Source.Microphone);
    try {
      if (publication?.track) await (muted ? publication.track.mute() : publication.track.unmute());
    } catch (error) {
      console.warn('[Go Live] Could not update the LiveKit track mute state', error);
    }
    if (track) track.enabled = !muted;
    if (kind === 'video') setIsVideoMuted(muted); else setIsAudioMuted(muted);
  };

  const toggleVideo = () => { void setTrackMuted('video', !isVideoMuted); };
  const toggleAudio = () => { void setTrackMuted('audio', !isAudioMuted); };

  /** Front/back camera. Works before and during a live: the new track replaces the published one. */
  const switchCamera = async () => {
    if (switchingCamera) return;
    const stream = mediaStreamRef.current;
    const oldTrack = stream?.getVideoTracks()[0];
    const next = facingModeRef.current === 'user' ? 'environment' : 'user';
    setSwitchingCamera(true);
    setSourceError('');
    const dims = QUALITY_DIMENSIONS[videoQualityRef.current];
    const getCamera = (facing: 'user' | 'environment') => navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: facing }, width: { ideal: dims.width }, height: { ideal: dims.height }, frameRate: { ideal: 30 } },
      audio: false
    });
    try {
      // Many phones can only open one camera at a time, so release the current one first.
      oldTrack?.stop();
      let camera: MediaStream;
      try {
        camera = await getCamera(next);
      } catch (error) {
        // Restore the previous camera so the preview/broadcast keeps going, then report the failure.
        const restored = await getCamera(facingModeRef.current).catch(() => null);
        if (restored) await applyNewVideoTrack(restored.getVideoTracks()[0], oldTrack);
        throw error;
      }
      const newTrack = camera.getVideoTracks()[0];
      await applyNewVideoTrack(newTrack, oldTrack);
      facingModeRef.current = next;
      setFacingMode(next);
      setSelectedCameraId('');
    } catch (error) {
      console.warn('[Go Live] Could not switch camera', error);
      setSourceError('Could not switch camera. This device may have only one camera.');
    } finally {
      setSwitchingCamera(false);
    }
  };

  const applyNewVideoTrack = async (newTrack: MediaStreamTrack | undefined, oldTrack: MediaStreamTrack | undefined) => {
    const stream = mediaStreamRef.current;
    if (!newTrack || !stream) return;
    newTrack.enabled = !isVideoMuted;
    if (oldTrack) stream.removeTrack(oldTrack);
    stream.addTrack(newTrack);
    const publication = liveKitRoomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera);
    if (publication?.track) await publication.track.replaceTrack(newTrack, { userProvidedTrack: true });
    for (const peer of livePeersRef.current.values()) {
      const sender = peer.getSenders().find(item => item.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack).catch(() => {});
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = stream;
      videoPreviewRef.current.play().catch(() => {});
    }
  };

  const handleStartBroadcast = async () => {
    setLiveStartError('');
    setEndSummary(null);
    let createdLiveId = '';
    let newRoom: Room | null = null;
    try {
      if (!mediaStreamRef.current?.getVideoTracks().length) {
        alert('Allow camera access before starting a live video.');
        return;
      }
      if (!streamLocation) {
        setLiveStartError('Choose a location before starting your live broadcast.');
        return;
      }
      const res = await api.startLive(streamTitle, taggedPageIds, { category: streamCategory, location: streamLocation });
      if (res.success && res.live) {
        const liveKitInfo = res as typeof res & { liveKitUrl?: string; liveKitToken?: string };
        if (!liveKitInfo.liveKitUrl || !liveKitInfo.liveKitToken) throw new Error('The live server did not return a LiveKit connection token.');
        createdLiveId = res.live.id;
        newRoom = new Room({ adaptiveStream: true, dynacast: true });
        await newRoom.connect(liveKitInfo.liveKitUrl, liveKitInfo.liveKitToken);
        const localTracks = mediaStreamRef.current?.getTracks() || [];
        for (const track of localTracks) {
          await newRoom.localParticipant.publishTrack(track, { source: track.kind === 'audio' ? Track.Source.Microphone : Track.Source.Camera });
        }
        liveKitRoomRef.current = newRoom;
        setCurrentSession(res.live);
        setComments([]);
        setPeakViewers(0);
        setIsBroadcasting(true);
        onLiveStarted?.(res.live);
        onStreamStarted?.(res.live);
        confetti({ particleCount: 50, spread: 70 });
      }
    } catch (err: unknown) {
      // Show the server's real reason. Only a network failure gets the connection hint.
      const message = err instanceof Error ? err.message : 'Failed to start live stream.';
      const isNetwork = err instanceof TypeError && /fetch|network/i.test(err.message);
      setLiveStartError(isNetwork ? 'Could not reach the live server. Check your connection and try Go Live again.' : /[.!?]$/.test(message) ? message : `${message}.`);
      if (!isNetwork) void api.getLiveConfigStatus().then(setLiveConfig).catch(() => {});
      newRoom?.disconnect();
      liveKitRoomRef.current?.disconnect();
      liveKitRoomRef.current = null;
      if (createdLiveId) await api.stopLive(createdLiveId).catch(() => {});
      console.error('[Go Live] Could not start broadcast', err);
    }
  };

  const handleEndBroadcast = () => {
    if (!endingLiveRef.current) setEndConfirmationOpen(true);
  };

  const confirmEndBroadcast = async () => {
    if (endingLiveRef.current || !currentSession) return;
    endingLiveRef.current = true;
    setEndingLive(true);
    setEndConfirmationOpen(false);
    const summary = {
      duration: streamDuration,
      viewers: Math.max(peakViewers, currentSession.viewersCount || 1),
      comments: comments.length
    };

    const streams = new Set([mediaStreamRef.current, screenStreamRef.current].filter((stream): stream is MediaStream => Boolean(stream)));
    for (const stream of streams) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }
    mediaStreamRef.current = null;
    screenStreamRef.current = null;
    livePeersRef.current.forEach(peer => peer.close());
    livePeersRef.current.clear();
    livePendingCandidatesRef.current.clear();
    liveKitRoomRef.current?.disconnect();
    liveKitRoomRef.current = null;
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null;
    setIsBroadcasting(false);
    setCurrentSession(null);

    let message = 'Live Ended';
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        await api.stopLive(currentSession.id, controller.signal);
      } finally {
        window.clearTimeout(timeout);
      }
    } catch (err: unknown) {
      console.error('Failed to end live stream:', err);
      message = 'Live ended locally';
    }
    onLiveEnded?.();
    onStreamEnded?.();
    setEndSummary({ ...summary, message });
    setEndingLive(false);
    endingLiveRef.current = false;
    endSummaryTimerRef.current = window.setTimeout(onClose, 4000);
  };

  const copyStreamValue = async (value: string, label: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.');
      await navigator.clipboard.writeText(value);
      setStreamKeyError('');
      setStreamKeyNotice(`${label} copied.`);
      if (label === 'Stream key') setStreamKeyVisible(false);
    } catch (error) {
      setStreamKeyError(error instanceof Error ? error.message : `Could not copy ${label.toLowerCase()}.`);
    }
  };

  const handleResetStreamKey = async () => {
    if (streamKeyLoading || !window.confirm('Reset your stream key? Your previous key will stop working.')) return;
    const ownerId = firebaseUser?.uid || user?.id || '';
    setStreamKeyLoading(true);
    setStreamKeyError('');
    setStreamKeyNotice('');
    try {
      const result = await api.resetLiveStreamKey();
      if (streamKeyOwnerRef.current !== ownerId) return;
      setStreamKey(result.streamKey);
      setStreamKeyServerUrl(result.serverUrl);
      setStreamKeyIngestConfigured(result.ingestConfigured);
      setStreamKeyVisible(true);
      setStreamKeyNotice('Stream key reset. Update the key in your streaming software.');
    } catch (error) {
      setStreamKeyError(error instanceof Error ? error.message : 'Could not reset your stream key.');
    } finally {
      setStreamKeyLoading(false);
    }
  };

  useEffect(() => {
    if (!isBroadcasting || !currentSession?.id) { setStreamUnderReview(false); return; }
    lastReactionCountRef.current = null;
    const stopDoc = onSnapshot(doc(db, 'liveStreams', currentSession.id), snapshot => {
      const data = snapshot.data();
      setStreamUnderReview(data?.underReview === true);
      const viewers = Number(data?.viewersCount || 0);
      setCurrentSession(prev => prev ? { ...prev, viewersCount: viewers } : prev);
      setPeakViewers(prev => Math.max(prev, viewers));
      const reactions = Number(data?.reactionsCount || 0);
      const previous = lastReactionCountRef.current;
      lastReactionCountRef.current = reactions;
      if (previous !== null && reactions > previous) burstReactions(String(data?.lastReaction?.emoji || '❤️'), reactions - previous);
    }, error => console.warn('[Go Live] Could not update live status:', error.code));
    const stopComments = listenLiveComments(currentSession.id, items => setComments(items), error => console.warn('[Go Live] Could not load live comments:', error.message));
    return () => { stopDoc(); stopComments(); };
  }, [isBroadcasting, currentSession?.id]);

  // Facebook-style presence: tell the server every 10 s that this live is still on air (lives/{hostId}
  // updatedAt). Viewers drop a live whose heartbeat is 30 s old, so a closed app never leaves a ghost live.
  const endBroadcastRef = useRef<() => void>(() => {});
  endBroadcastRef.current = () => { void confirmEndBroadcast(); };
  useEffect(() => {
    if (!isBroadcasting || !currentSession?.id || !currentSession.liveKitRoom) return;
    const streamId = currentSession.id;
    let stopped = false;
    const beat = () => api.sendLiveHeartbeat(streamId).catch(error => {
      // Ended somewhere else (admin, another device started a new live, timed out): stop here too.
      if (!stopped && (error as { code?: string })?.code === 'live-ended') endBroadcastRef.current();
    });
    void beat();
    const timer = window.setInterval(beat, 10_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void beat(); };
    // Closing / reloading the page ends the live right away for every viewer.
    const onPageHide = () => { void api.endLiveOnPageClose(streamId); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [isBroadcasting, currentSession?.id, currentSession?.liveKitRoom]);

  // Streaming-software tab: show when this user's RTMP broadcast is live (created by the LiveKit webhook).
  useEffect(() => {
    const hostId = firebaseUser?.uid || '';
    if (!isOpen || studioMode !== 'software' || !hostId) { setSoftwareLive(null); return; }
    return onSnapshot(query(collection(db, 'liveStreams'), where('hostId', '==', hostId), where('isActive', '==', true)), snapshot => {
      const live = snapshot.docs.map(item => ({ ...item.data(), id: item.id } as LiveStream & { source?: string })).find(item => item.source === 'rtmp');
      setSoftwareLive(live || null);
    }, () => setSoftwareLive(null));
  }, [isOpen, studioMode, firebaseUser?.uid]);

  // Like Facebook / YouTube Live: OBS starting IS going live. Every 3 s ask the server, which asks
  // LiveKit whether this user's ingress is receiving the stream, and starts / ends the live to match.
  useEffect(() => {
    if (!isOpen || studioMode !== 'software' || !signedIn) { setRtmpPoll(null); return; }
    let active = true;
    const check = () => api.getRtmpStatus().then(result => {
      if (!active) return;
      setRtmpPoll({ publishing: result.publishing, ingressStatus: result.ingressStatus, held: result.held });
      setSoftwareLive(previous => result.live ? { ...(previous?.id === result.live.id ? previous : {}), ...result.live } : null);
    }).catch(() => {});
    void check();
    const timer = window.setInterval(check, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [isOpen, studioMode, signedIn]);

  useEffect(() => {
    if (!softwareLive) return;
    const timer = window.setInterval(() => setSoftwareNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [softwareLive?.id]);

  useEffect(() => {
    if (!isOpen || studioMode !== 'software' || !signedIn) return;
    let active = true;
    void api.getLiveConfigStatus().then(status => { if (active) setLiveConfig(status); }).catch(() => {});
    void api.getRtmpStreamDetails().then(details => {
      if (!active) return;
      const profileCity = (user?.location || '').toLowerCase();
      setRtmpDetails({
        title: details.title || `${user?.name || 'User'} is Live on EChat!`,
        category: details.category || 'Just Chatting',
        location: details.location || LIVE_LOCATIONS.find(city => city !== 'Other' && profileCity.includes(city.toLowerCase())) || ''
      });
    }).catch(() => {});
    return () => { active = false; };
  }, [isOpen, studioMode, signedIn, user?.name, user?.location]);

  const burstReactions = (emoji: string, amount: number) => {
    const bursts = Math.min(amount, 8);
    for (let index = 0; index < bursts; index += 1) {
      const id = `react_${Date.now()}_${index}_${Math.random()}`;
      setFloatingReactions(prev => [...prev.slice(-15), { id, emoji, left: Math.floor(Math.random() * 70) + 15 }]);
      setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
    }
  };

  const saveRtmpDetails = async () => {
    setRtmpDetailsSaving(true);
    setRtmpDetailsNotice('');
    try {
      const saved = await api.saveRtmpStreamDetails(rtmpDetails);
      setRtmpDetails({ title: saved.title, category: saved.category, location: saved.location });
      setRtmpDetailsNotice('Saved. These details are used the next time you start streaming.');
    } catch (error) {
      setRtmpDetailsNotice(error instanceof Error ? error.message : 'Could not save your stream details.');
    } finally {
      setRtmpDetailsSaving(false);
    }
  };

  const endSoftwareLive = async () => {
    if (!softwareLive || !window.confirm('End this live? Viewers will see Live Ended. Also stop streaming in your app.')) return;
    try { await api.stopLive(softwareLive.id); } catch (error) { alert(error instanceof Error ? error.message : 'Could not end the live.'); }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Keep every hook above this visibility check. GoLiveModal stays mounted on /home
  // while closed, so returning before the effects below used to change its hook count
  // as soon as a user opened the studio (React error #310).
  if (!isOpen) return null;
  if (endingLive) {
    return (
      <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/85 p-4 text-white">
        <div role="status" className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-6 py-5 font-bold shadow-2xl">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-rose-500 border-t-transparent"/>Ending live stream…
        </div>
      </div>
    );
  }
  if (endSummary) {
    return (
      <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/85 p-4 text-white">
        <section role="status" className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-rose-600"><Radio size={26}/></div>
          <h2 className="text-2xl font-black">{endSummary.message}</h2>
          <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-xl bg-slate-800 p-3"><strong className="block text-lg">{formatDuration(endSummary.duration)}</strong><span className="text-slate-400">Duration</span></div>
            <div className="rounded-xl bg-slate-800 p-3"><strong className="block text-lg">{endSummary.viewers}</strong><span className="text-slate-400">Peak viewers</span></div>
            <div className="rounded-xl bg-slate-800 p-3"><strong className="block text-lg">{endSummary.comments}</strong><span className="text-slate-400">Comments</span></div>
          </div>
          <button type="button" onClick={() => { if (endSummaryTimerRef.current) clearTimeout(endSummaryTimerRef.current); endSummaryTimerRef.current = null; onClose(); }} className="mt-5 min-h-12 w-full rounded-xl bg-rose-600 px-4 font-extrabold text-white">Back to Home</button>
        </section>
      </div>
    );
  }

  /** Resizes the camera track in place. The same track is published to LiveKit, so viewers get the new quality. */
  const changeVideoQuality = async (quality: VideoQuality) => {
    const previous = videoQualityRef.current;
    videoQualityRef.current = quality;
    setVideoQuality(quality);
    const track = mediaStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const dimensions = QUALITY_DIMENSIONS[quality];
    try {
      await track.applyConstraints({ width: { ideal: dimensions.width }, height: { ideal: dimensions.height }, frameRate: { ideal: 30 } });
    } catch {
      videoQualityRef.current = previous;
      setVideoQuality(previous);
      setSourceError('This camera cannot provide that quality. Choose another option.');
    }
  };

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim() || !currentSession?.id || !user) return;
    try {
      await addLiveComment(currentSession.id, { userId: user.id, userName: user.name, userAvatar: user.avatar || '', text: commentInput.trim().slice(0, 500), createdAt: Date.now() });
      setCommentInput('');
    } catch (err) {
      console.error('Failed to send comment:', err);
    }
  };

  const moderateLiveComment = async (comment: LiveComment, action: 'delete' | 'timeout' | 'block') => {
    if (!currentSession?.id) return;
    try {
      if (action === 'delete') await deleteLiveComment(currentSession.id, comment.id);
      if (action === 'timeout') await timeoutLiveUser(currentSession.id, user?.id || '', comment.userId, 10);
      if (action === 'block' && user?.id) await blockLiveUser(user.id, comment.userId);
      setCommentMenuId(null);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not moderate this comment.'); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      
      {!hasLivePermission ? (
        <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-2xl sm:p-8">
          <button onClick={onClose} aria-label="Close Go Live access" className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-full text-slate-500 hover:bg-slate-100"><X size={19}/></button>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl bg-rose-50 text-rose-600"><Radio size={30}/></div>
          <h2 className="text-2xl font-black text-slate-900">Go Live on Echat</h2>
          {accessNotice && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-700">{accessNotice}</p>}
          {authLoading ? (authWaitExpired ? <>
            <p role="status" className="mt-5 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">Sign-in is taking longer than expected. Please reopen Go Live after your account finishes loading.</p>
            <button onClick={onClose} className="mt-4 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-extrabold text-white">Continue to Echat</button>
          </> : <div className="mt-5 flex items-center justify-center gap-3 text-sm font-semibold text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-rose-600 border-t-transparent"/>Checking login…</div>) : !signedIn ? <>
            <p className="mt-3 text-sm leading-6 text-slate-600">Log in to check your Go Live eligibility.</p>
            <button onClick={onClose} className="mt-5 min-h-12 w-full rounded-xl bg-blue-600 px-4 font-extrabold text-white">Log In to Go Live</button>
          </> : accessLoading && !accessInfo ? <div className="mt-5 flex items-center justify-center gap-3 text-sm font-semibold text-slate-600"><span className="h-5 w-5 animate-spin rounded-full border-2 border-rose-600 border-t-transparent"/>Checking Go Live access…</div> : isLiveBlocked ? <>
            <p className="mt-3 text-sm leading-6 text-rose-700">Your Go Live access has been blocked. Contact an administrator if you think this is a mistake.</p>
          </> : <>
            <p className="mt-3 text-sm leading-6 text-slate-700">{GO_LIVE.message}</p>
            <p className="mt-2 text-sm font-bold text-slate-800">Your account is {goLiveEligibility.accountAgeDays} days old.</p>
            <p className="mt-1 text-sm font-bold text-slate-800">You can Go Live in {goLiveEligibility.daysLeft} {goLiveEligibility.daysLeft === 1 ? 'day' : 'days'} (after 60 days).</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">Keep chatting, posting and growing your account!</p>
            {accessError && <p role="alert" className="mt-3 rounded-xl bg-amber-50 p-3 text-left text-sm text-amber-800">We could not refresh your live-access status, but your account-age restriction is still active.</p>}
          </>}
          {accessError && accessInfo && <p role="alert" className="mt-3 rounded-xl bg-rose-50 p-3 text-left text-sm text-rose-700">{accessError}</p>}
        </div>
      ) : (
        <div className="bg-slate-950 w-full max-w-4xl h-[90dvh] max-h-[90vh] rounded-3xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col">
          
          {/* Top Bar */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 text-white">
            <div className="flex items-center gap-3">
              <div className="relative">
                <img
                  src={avatarSrc(user?.avatar, user?.name || 'You')}
                  alt={user?.name}
                  className="w-10 h-10 rounded-full object-cover border-2 border-rose-500"
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-rose-500 rounded-full ring-2 ring-slate-900 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold">{user?.name}</span>
                  {(user?.isVerified || isDeveloper) && <VerifiedBadge size={14} />}
                  {goLiveEligibility.developer && (
                    <span className="max-w-40 truncate rounded bg-purple-600/90 px-1.5 py-0.5 text-[8px] font-extrabold uppercase text-white">
                      ADMIN — Instant Live Access
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
                <option value="720p">720p</option><option value="480p">480p</option><option value="360p">360p</option>
              </select>
            </label>

            <div className="flex items-center gap-3">
              {isBroadcasting && (
                <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-full text-xs font-semibold text-slate-300">
                  <Users size={12} className="text-rose-400" />
                  <span>{currentSession?.viewersCount ?? 0} watching</span>
                </div>
              )}
              {!isBroadcasting && (
                <button
                  onClick={onClose}
                  className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-slate-800 transition"
                >
                  <X size={20} />
                </button>
              )}
            </div>
          </div>
          {accessNotice && <p role="status" className="bg-emerald-950 px-4 py-2 text-center text-sm font-bold text-emerald-200">{accessNotice}</p>}

          {!isBroadcasting && (
            <div role="tablist" aria-label="Live source" className="flex shrink-0 border-b border-slate-800 bg-slate-900 px-3 pt-2 text-sm text-slate-300">
              <button type="button" role="tab" aria-selected={studioMode === 'camera'} onClick={() => setStudioMode('camera')} className={`min-h-11 border-b-2 px-4 font-bold ${studioMode === 'camera' ? 'border-rose-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>📱 Phone Camera</button>
              <button type="button" role="tab" aria-selected={studioMode === 'software'} onClick={() => setStudioMode('software')} className={`min-h-11 border-b-2 px-4 font-bold ${studioMode === 'software' ? 'border-rose-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>🎥 Streaming Software</button>
            </div>
          )}

          {/* Main Broadcast Stage */}
          <div className={`flex-1 min-h-0 relative bg-black flex flex-col md:flex-row overflow-hidden ${!isBroadcasting && studioMode === 'software' ? 'hidden' : ''}`}>
            
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
                      src={avatarSrc(user?.avatar, user?.name || 'You')}
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
              <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[10px] font-bold text-white"><img src="/logo-mark-blue.svg" alt="" className="h-5 w-5" />Echat</div>
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

                  <button
                    onClick={() => void switchCamera()}
                    disabled={switchingCamera || !hasCameraPermission}
                    className="p-2 rounded-xl transition cursor-pointer bg-white/15 text-white hover:bg-white/25 disabled:opacity-50"
                    title={facingMode === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                    aria-label="Switch camera"
                  >
                    <SwitchCamera size={18} />
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
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Category
                        <select value={streamCategory} onChange={event => setStreamCategory(event.target.value as LiveCategory)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs normal-case text-white">
                          {LIVE_CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </label>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Location
                        <select value={streamLocation} onChange={event => setStreamLocation(event.target.value as LiveLocation | '')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-xs normal-case text-white">
                          <option value="">Choose city</option>{LIVE_LOCATIONS.map(item => <option key={item} value={item}>{item}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h4 className="text-xs font-bold text-white truncate">{streamTitle}</h4>
                    <p className="text-[11px] text-slate-400">{currentSession?.category || streamCategory} · {currentSession?.location || streamLocation || 'Location not set'} · Live audience interaction feed</p>
                    {streamUnderReview && <p role="status" className="mt-2 rounded-lg bg-amber-500/15 px-2.5 py-2 text-xs font-bold text-amber-300">Your live is under review after reports from viewers.</p>}
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
              <div className={`flex-1 overflow-y-auto p-3 space-y-2 ${isBroadcasting ? 'pb-16' : ''}`}>
                {comments.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    Live comments from your viewers will appear here in real-time.
                  </div>
                ) : (
                  comments.map(c => (
                    <div key={c.id} className="relative text-xs bg-slate-800/60 p-2 rounded-xl border border-slate-800 flex items-start gap-2">
                      <img src={avatarSrc(c.userAvatar, c.userName)} alt={c.userName} className="w-6 h-6 rounded-full object-cover shrink-0" />
                      <div className="min-w-0">
                        <span className="font-bold text-rose-400 mr-1.5">{c.userName}:</span>
                        <span className="text-slate-200">{c.text}</span>
                      </div>
                      <button type="button" aria-label={`Moderate ${c.userName}'s message`} onClick={() => setCommentMenuId(id => id === c.id ? null : c.id)} className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white"><MoreVertical size={15}/></button>
                      {commentMenuId === c.id && <div className="absolute right-2 top-9 z-20 w-48 rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-xl"><button type="button" onClick={() => void moderateLiveComment(c, 'delete')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white hover:bg-white/10"><Trash2 size={14}/>Delete message</button><button type="button" onClick={() => void moderateLiveComment(c, 'timeout')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white hover:bg-white/10"><Clock size={14}/>Timeout 10 minutes</button><button type="button" onClick={() => void moderateLiveComment(c, 'block')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-rose-300 hover:bg-white/10"><Ban size={14}/>Block user</button></div>}
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

          {!isBroadcasting && studioMode === 'software' && <section role="tabpanel" aria-label="Streaming Software" className="flex-1 min-h-0 overflow-y-auto bg-slate-950 p-4 text-white">
            <div className="mx-auto max-w-2xl space-y-4">
              <div>
                <h2 className="text-lg font-extrabold">Stream from any streaming app</h2>
                <p className="mt-1 text-sm text-slate-400">One Server URL and one Stream Key work in any app that supports a Custom RTMP server. Your key is private to your account.</p>
              </div>

              {softwareLive ? (
                <div role="status" aria-label="You are live" className="space-y-3 rounded-xl border border-rose-700 bg-rose-950/60 p-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex items-center gap-1.5 rounded-md bg-rose-600 px-2 py-1 text-xs font-black uppercase"><span className="h-2 w-2 animate-ping rounded-full bg-white"/>Live</span>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-extrabold">YOU ARE LIVE <span className="ml-1 font-mono text-rose-200">{formatDuration(Math.max(0, Math.floor((softwareNow - (softwareLive.startedAt || softwareNow)) / 1000)))}</span></p>
                      <p className="truncate text-xs text-rose-200">{softwareLive.title} · {softwareLive.viewersCount ?? 0} watching</p>
                    </div>
                    <button type="button" onClick={() => void endSoftwareLive()} className="min-h-10 rounded-xl bg-white px-3 text-sm font-extrabold text-rose-700">End Live</button>
                  </div>
                  {firebaseUser?.uid && <SoftwareLivePreview streamId={softwareLive.id} hostId={firebaseUser.uid} />}
                </div>
              ) : rtmpPoll?.held ? (
                <p role="status" className="rounded-xl border border-amber-700/70 bg-amber-950/60 p-3 text-xs leading-5 text-amber-200">You ended your live, but your streaming app is still sending video. <strong>Stop streaming in your app</strong>, then start again to go live.</p>
              ) : rtmpPoll?.publishing || rtmpPoll?.ingressStatus === 1 ? (
                <p role="status" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs leading-5 text-rose-100"><span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500"/>Status: <strong>Receiving your stream…</strong> Going live now.</p>
              ) : (
                <p role="status" className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs leading-5 text-slate-400">Status: <strong className="text-slate-200">Waiting for your stream.</strong> Start streaming in your app — you go live automatically (checked every 3 seconds). When it stops, viewers see Live Ended.</p>
              )}

              {liveConfig && !liveConfig.ready && <div role="alert" className="rounded-xl border border-amber-700/70 bg-amber-950/60 p-3 text-sm leading-5 text-amber-200">
                <p className="font-bold">Live server setup is incomplete.</p>
                <p className="mt-1">Missing on the server: <code className="font-mono">{liveConfig.missing.join(', ')}</code>. An admin must add these in Vercel → Project → Settings → Environment Variables, then redeploy.</p>
              </div>}
              {liveConfig?.ready && liveConfig.liveKitAuthOk === false && <div role="alert" className="rounded-xl border border-amber-700/70 bg-amber-950/60 p-3 text-sm leading-5 text-amber-200">
                <p className="font-bold">Live server keys are not working.</p>
                <p className="mt-1">{liveConfig.liveKitError || 'LiveKit rejected the server keys. Check LIVEKIT_API_KEY and LIVEKIT_API_SECRET in Vercel, then redeploy.'}</p>
              </div>}
              {liveConfig?.ready && !liveConfig.liveKitUrlLooksValid && <p role="alert" className="rounded-xl border border-amber-700/70 bg-amber-950/60 p-3 text-sm text-amber-200">LIVEKIT_URL should start with wss:// (for example wss://your-project.livekit.cloud).</p>}

              <label className="block text-xs font-bold uppercase tracking-wide text-slate-400">RTMP Server URL
                <div className="mt-1 flex gap-2">
                  <input readOnly value={streamKeyServerUrl || (streamKeyLoading ? 'Loading…' : '')} placeholder={streamKeyError ? 'Unavailable - see the message below' : 'Not available yet'} className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 font-mono text-sm normal-case text-white"/>
                  <button type="button" disabled={!streamKeyServerUrl} onClick={() => void copyStreamValue(streamKeyServerUrl, 'Server URL')} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40"><Copy size={16}/>Copy URL</button>
                </div>
              </label>
              <div>
                <label htmlFor="live-stream-key" className="block text-xs font-bold uppercase tracking-wide text-slate-400">Stream Key</label>
                {streamKeyLoading && !streamKey && <p role="status" className="mt-2 text-sm text-slate-400">Loading your private key…</p>}
                {streamKey && <div className="mt-1 flex min-w-0 gap-2">
                  <input id="live-stream-key" readOnly type={streamKeyVisible ? 'text' : 'password'} value={streamKey} autoComplete="off" className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 font-mono text-sm text-white"/>
                  <button type="button" onClick={() => setStreamKeyVisible(value => !value)} aria-label={streamKeyVisible ? 'Hide stream key' : 'Show stream key'} className="grid min-h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-700 hover:bg-slate-800">{streamKeyVisible ? <EyeOff size={17}/> : <Eye size={17}/>}</button>
                  <button type="button" onClick={() => void copyStreamValue(streamKey, 'Stream key')} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-bold text-white hover:bg-slate-800"><Copy size={16}/>Copy Key</button>
                </div>}
                <button type="button" onClick={() => void handleResetStreamKey()} disabled={streamKeyLoading} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-700 px-3 text-sm font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50"><RotateCcw size={15}/>{streamKeyLoading ? 'Please wait…' : 'Reset Key'}</button>
                <p className="mt-1 text-xs text-slate-500">Reset Key makes a new key. The old key stops working in every app.</p>
              </div>
              <p className="rounded-xl border border-rose-900/70 bg-rose-950/50 p-3 text-sm font-semibold text-rose-200">Never share your stream key. Anyone who has it can stream as you.</p>
              {streamKeyError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-rose-950/70 p-3 text-sm text-rose-200">
                <span className="min-w-0 flex-1">{liveConfig?.liveKitAuthOk === false && streamKeyError === liveConfig.liveKitError ? 'Your Server URL and Stream Key will appear here once the live server keys are fixed.' : streamKeyError}</span>
                <button type="button" disabled={streamKeyLoading} onClick={() => { setStreamKeyRetry(value => value + 1); void api.getLiveConfigStatus().then(setLiveConfig).catch(() => {}); }} className="min-h-9 shrink-0 rounded-lg border border-rose-800 px-3 text-xs font-bold text-rose-100 hover:bg-rose-900 disabled:opacity-50">Try again</button>
              </div>}
              {streamKeyNotice && <p role="status" className="rounded-xl bg-emerald-950/70 p-3 text-sm text-emerald-200">{streamKeyNotice}</p>}

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <h3 className="text-sm font-extrabold">How to stream</h3>
                <ol className="mt-2 list-inside list-decimal space-y-1.5 text-sm leading-6 text-slate-300">
                  <li>In your streaming app, choose <strong>Custom RTMP</strong> (may be called “Custom server” or “RTMP”).</li>
                  <li>Paste the <strong>Server URL</strong>.</li>
                  <li>Paste the <strong>Stream Key</strong>.</li>
                  <li>Press <strong>Start Streaming</strong>. You appear in Live Now within a few seconds.</li>
                </ol>
                <p className="mt-3 text-xs text-slate-400"><strong className="text-slate-300">Works with:</strong> OBS Studio, Streamlabs, vMix, XSplit, Prism Live Studio, Restream / StreamYard (RTMP out), Larix Broadcaster and any app with a Custom RTMP server.</p>
                <p className="mt-1 text-xs text-slate-500">Tip: use H.264 video + AAC audio, 2-second keyframe interval, 2,500–4,500 kbps for 720p.</p>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                <h3 className="text-sm font-extrabold">Stream details</h3>
                <p className="text-xs text-slate-400">Shown in Live Now when your app starts streaming.</p>
                <input value={rtmpDetails.title} onChange={event => setRtmpDetails(value => ({ ...value, title: event.target.value }))} maxLength={120} placeholder="Stream title" className="w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white"/>
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="Category" value={rtmpDetails.category} onChange={event => setRtmpDetails(value => ({ ...value, category: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-800 px-2 py-2 text-sm text-white">{LIVE_CATEGORIES.map(item => <option key={item} value={item}>{item}</option>)}</select>
                  <select aria-label="Location" value={rtmpDetails.location} onChange={event => setRtmpDetails(value => ({ ...value, location: event.target.value }))} className="rounded-xl border border-slate-700 bg-slate-800 px-2 py-2 text-sm text-white"><option value="">Choose city</option>{LIVE_LOCATIONS.map(item => <option key={item} value={item}>{item}</option>)}</select>
                </div>
                <button type="button" onClick={() => void saveRtmpDetails()} disabled={rtmpDetailsSaving} className="min-h-10 rounded-xl bg-rose-600 px-4 text-sm font-bold text-white disabled:opacity-50">{rtmpDetailsSaving ? 'Saving…' : 'Save details'}</button>
                {rtmpDetailsNotice && <p role="status" className="text-xs text-slate-300">{rtmpDetailsNotice}</p>}
              </div>
            </div>
          </section>}

          {!isBroadcasting && studioMode === 'camera' && <div className="sticky bottom-0 z-40 shrink-0 border-t border-slate-800 bg-slate-950 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {liveStartError && <p role="alert" className="mb-2 rounded-lg border border-rose-800 bg-rose-950/70 p-2 text-xs leading-5 text-rose-200">{liveStartError}</p>}
            {liveStartError && liveConfig && !liveConfig.ready && <p className="mb-2 rounded-lg border border-amber-700/70 bg-amber-950/60 p-2 text-xs leading-5 text-amber-200">Live server setup is incomplete. Missing: <code className="font-mono">{liveConfig.missing.join(', ')}</code></p>}
            <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 px-5 py-3 font-bold text-slate-200">Cancel</button>
            <button type="button" onClick={handleStartBroadcast} disabled={!mediaStreamRef.current?.getVideoTracks().length || hasCameraPermission === false} className="flex-1 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 px-5 py-3 text-base font-extrabold text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-50"><Radio size={18} className="mr-2 inline" />Go Live</button>
            </div>
          </div>}

        </div>
      )}

      {isBroadcasting && (
        <button
          type="button"
          onClick={handleEndBroadcast}
          aria-label="End live stream"
          className="fixed left-1/2 z-[9999] flex min-h-12 min-w-[140px] -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-rose-600 px-6 text-base font-black text-white shadow-2xl ring-2 ring-white/80 hover:bg-rose-700 focus:outline-none focus:ring-4 focus:ring-rose-300"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 5.25rem)' }}
        >
          <X size={20}/> End Live
        </button>
      )}

      {endConfirmationOpen && (
        <div className="fixed inset-0 z-[10000] grid place-items-center bg-black/75 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="end-live-title" aria-describedby="end-live-description" className="w-full max-w-sm rounded-2xl border border-slate-700 bg-slate-900 p-5 text-white shadow-2xl">
            <h2 id="end-live-title" className="text-lg font-extrabold">End Live?</h2>
            <p id="end-live-description" className="mt-2 text-sm leading-6 text-slate-300">Your viewers will see Live Ended.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setEndConfirmationOpen(false)} disabled={endingLive} className="min-h-12 flex-1 rounded-xl border border-slate-600 px-4 font-bold text-slate-200 disabled:opacity-60">Cancel</button>
              <button type="button" onClick={() => void confirmEndBroadcast()} disabled={endingLive} className="min-h-12 flex-1 rounded-xl bg-rose-600 px-4 font-extrabold text-white disabled:opacity-60">{endingLive ? 'Ending…' : 'End Live'}</button>
            </div>
          </section>
        </div>
      )}

    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { liveRtcConfig } from '../utils/liveRtc';
import { api } from '../services/api';
import { LiveStream, LiveComment } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { avatarSrc } from './UserAvatar';
import { useBackButton } from '../hooks/useBackButton';
import { addLiveComment, blockLiveUser, deleteLiveComment, followCreator, listenFollowerCount, listenFollowingState, listenHostLive, listenLiveComments, timeoutLiveUser, unfollowCreator, type HostLiveState } from '../services/liveDiscovery';
import { useLiveProfile, withLive } from '../services/liveProfiles';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { LiveUserActions } from './LiveUserActions';
import { isLowDataMode } from '../services/lowData';
import { Ban, Bookmark, ChevronDown, Maximize, Minimize, MoreVertical, Pause, Play, RotateCw, Settings2, ThumbsDown, Trash2 } from 'lucide-react';
// @ts-ignore The SDK package is installed by Vercel's production install; local package typings may be absent in managed workspaces.
import { Room, RoomEvent, Track, VideoQuality } from 'livekit-client';
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
  const currentStream = stream || session || null;
  useBackButton(Boolean(currentStream), onClose, 'live-viewer');

  const { user } = useAuth();
  const { onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveStopped, onLiveSignal, onLiveCaption, socket } = useSocket();

  const [liveDataState, setLiveData] = useState<LiveStream | null>(currentStream);
  // ONE id everywhere: the player follows lives/{hostId} (the same document the feed card and the
  // notification come from) and joins the room it names. Only status 'ended' there ends the player.
  const [hostLive, setHostLive] = useState<HostLiveState>({ loaded: false, stream: null, ended: false, stale: false, source: 'firestore' });
  useEffect(() => {
    if (!currentStream?.liveKitRoom) return;
    console.info('[Live] Opening player', { liveId: currentStream.hostId, streamId: currentStream.id, roomName: currentStream.liveKitRoom });
    setHostLive({ loaded: false, stream: null, ended: false, stale: false, source: 'firestore' });
    return listenHostLive(currentStream.hostId, currentStream.id, setHostLive);
  }, [currentStream?.hostId, currentStream?.id, currentStream?.liveKitRoom]);
  // LiveKit lives wait for the host document, so nothing ever joins an old stream id from a card.
  // Streaming-app live: ask the server to re-check OBS with LiveKit, so "Live Ended" shows soon after it stops.
  const isSoftwareLive = (hostLive.stream?.source || currentStream?.source) === 'rtmp';
  useEffect(() => {
    if (!isSoftwareLive) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void api.syncLives(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [isSoftwareLive]);
  const streamId = currentStream?.liveKitRoom ? (hostLive.loaded ? hostLive.stream?.id || currentStream.id : '') : currentStream?.id || '';
  const hostProfile = useLiveProfile(currentStream?.hostId);
  const liveData = liveDataState ? withLive({ ...liveDataState, ...(hostLive.stream ? { title: hostLive.stream.title || liveDataState.title, category: hostLive.stream.category || liveDataState.category, id: hostLive.stream.id } : {}) }, hostProfile ? { id: hostProfile.id, name: hostProfile.name, avatar: hostProfile.avatar, isVerified: hostProfile.isVerified } : undefined) : null;
  const hostName = liveData ? ((liveData as { name?: string }).name || liveData.hostName) : '';
  const hostAvatar = liveData ? ((liveData as { avatar?: string }).avatar || liveData.hostAvatar) : '';
  const [commentInput, setCommentInput] = useState('');
  const [comments, setComments] = useState<LiveComment[]>(currentStream?.comments || []);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; left: number }[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [remoteVideo, setRemoteVideo] = useState<MediaStream | null>(null);
  const [showCaptions, setShowCaptions] = useState(true);
  const [captionSize, setCaptionSize] = useState<'sm' | 'base' | 'lg'>('base');
  const [liveCaption, setLiveCaption] = useState('');
  const [commentMenuId, setCommentMenuId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const queuedCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const commentsEndRef = useRef<HTMLDivElement | null>(null);
  // LiveKit lives end ONLY when lives/{hostId} says status 'ended' (host tapped End Live, OBS stopped,
  // or the server timed the host out). Slow video, an empty room or a token error never end it.
  // Old socket-only lives keep their socket "live stopped" event.
  const [legacyEnded, setLegacyEnded] = useState(false);
  const liveEnded = currentStream?.liveKitRoom ? hostLive.ended : legacyEnded;
  const roomName = hostLive.stream?.liveKitRoom || '';
  // Video connection: 'connecting' → 'connected'; failures retry automatically 3 times, then "Tap to Retry".
  const [connectState, setConnectState] = useState<'connecting' | 'retrying' | 'connected' | 'waiting-video' | 'failed'>('connecting');
  const [connectAttempt, setConnectAttempt] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const retryNow = () => { setConnectAttempt(0); setConnectState('connecting'); setRetryNonce(value => value + 1); };

  // ---- Premium playback: quality menu, stats, reconnecting, portrait / landscape / fullscreen ----
  type QualityPref = 'auto' | '1080' | '720' | '480' | '360' | 'audio';
  const QUALITY_OPTIONS: Array<{ id: QualityPref; label: string }> = [
    { id: 'auto', label: 'Auto (recommended)' }, { id: '1080', label: '1080p HD' }, { id: '720', label: '720p' },
    { id: '480', label: '480p' }, { id: '360', label: '360p' }, { id: 'audio', label: 'Audio only' }
  ];
  const [qualityPref, setQualityPref] = useState<QualityPref>(() => {
    try { return (localStorage.getItem('echat:liveQuality') as QualityPref) || 'auto'; } catch { return 'auto'; }
  });
  const qualityPrefRef = useRef<QualityPref>(qualityPref);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [stats, setStats] = useState<{ height: number; kbps: number }>({ height: 0, kbps: 0 });
  const [reconnecting, setReconnecting] = useState(false);
  const videoPubRef = useRef<any>(null);
  const videoTrackRef = useRef<any>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [layout, setLayout] = useState<'portrait' | 'landscape' | 'desktop'>('portrait');
  const [chatOpen, setChatOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const autoFullscreenRef = useRef(false);
  const layoutRef = useRef<'portrait' | 'landscape' | 'desktop' | ''>('');

  /** Apply the viewer's choice. Auto = LiveKit adaptive stream (screen size + internet) up to 1080p. */
  const applyQuality = (pref: QualityPref) => {
    const publication = videoPubRef.current;
    if (!publication) return;
    try {
      publication.setEnabled(pref !== 'audio'); // Audio only: the server stops sending video (saves data)
      if (pref === 'auto' || pref === 'audio') publication.setVideoQuality(VideoQuality.HIGH);
      else {
        const height = Number(pref);
        publication.setVideoQuality(height >= 1080 ? VideoQuality.HIGH : height >= 720 ? VideoQuality.MEDIUM : VideoQuality.LOW);
        publication.setVideoDimensions({ width: Math.round(height * 16 / 9), height });
      }
    } catch (error) { console.warn('[Live] Could not change quality', error); }
  };
  const chooseQuality = (pref: QualityPref) => {
    qualityPrefRef.current = pref;
    setQualityPref(pref);
    setQualityMenuOpen(false);
    try { localStorage.setItem('echat:liveQuality', pref); } catch { /* private mode */ }
    applyQuality(pref);
  };

  // What the viewer is actually getting: resolution + incoming video bitrate (updated every 2 s).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const height = video?.videoHeight || 0;
      if (video?.videoWidth && video.videoHeight) setVideoAspect(video.videoWidth / video.videoHeight);
      setStats({ height, kbps: Math.round((videoTrackRef.current?.currentBitrate || 0) / 1000) });
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  // Portrait (phone): video full width, chat below. Landscape (phone): full-screen video, chat overlay.
  // Computer: 16:9 video with chat at the side.
  useEffect(() => {
    const landscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 540px)');
    const wideQuery = window.matchMedia('(min-width: 768px)');
    const update = () => {
      const next = landscapeQuery.matches ? 'landscape' : wideQuery.matches ? 'desktop' : 'portrait';
      const previous = layoutRef.current;
      if (next === previous) return;
      layoutRef.current = next;
      setLayout(next);
      if (next === 'landscape') {
        setChatOpen(false);
        // Like YouTube: rotating the phone sideways goes full screen (when the browser allows it).
        const element = playerRef.current as (HTMLElement & { webkitRequestFullscreen?: () => void }) | null;
        if (element && !document.fullscreenElement && element.requestFullscreen) {
          element.requestFullscreen({ navigationUI: 'hide' }).then(() => { autoFullscreenRef.current = true; }).catch(() => {});
        }
      } else {
        setChatOpen(true);
        if (previous === 'landscape' && autoFullscreenRef.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        autoFullscreenRef.current = false;
      }
    };
    update();
    landscapeQuery.addEventListener('change', update);
    wideQuery.addEventListener('change', update);
    window.addEventListener('orientationchange', update);
    // Some browsers skip media-query change events during quick rotations; resize always fires.
    window.addEventListener('resize', update);
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      landscapeQuery.removeEventListener('change', update);
      wideQuery.removeEventListener('change', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      const element = playerRef.current;
      if (element?.requestFullscreen) await element.requestFullscreen({ navigationUI: 'hide' });
      else (videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.(); // iPhone
    } catch (error) { console.warn('[Live] Fullscreen unavailable', error); }
  };

  /** Rotate button: go full screen and lock landscape (Android); back to portrait on second tap. */
  const toggleRotate = async () => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    try {
      if (layout === 'landscape' || (document.fullscreenElement && orientation?.type?.startsWith('landscape'))) {
        orientation?.unlock?.();
        if (document.fullscreenElement) await document.exitFullscreen();
        return;
      }
      if (!document.fullscreenElement) await playerRef.current?.requestFullscreen?.({ navigationUI: 'hide' });
      await orientation?.lock?.('landscape');
    } catch {
      await toggleFullscreen(); // iPhone / desktop: no orientation lock → plain full screen
    }
  };
  // Socket helpers can change identity on every provider render; keep them in refs so the video
  // connection is NOT torn down and rebuilt each time (that caused reconnect loops / black video).
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const onLiveSignalRef = useRef(onLiveSignal);
  onLiveSignalRef.current = onLiveSignal;
  const [connectError, setConnectError] = useState('');
  // Low Data Mode: don't start the live video until the viewer taps "Tap to Join Live".
  const [videoJoined, setVideoJoined] = useState(() => !isLowDataMode());
  const pendingReactionsRef = useRef<{ emoji: string; count: number } | null>(null);
  const reactionTimerRef = useRef<number | null>(null);
  const lastReactionCountRef = useRef<number | null>(null);
  const isLiveKitStream = Boolean(currentStream?.liveKitRoom);

  // Count this viewer. LiveKit lives use per-stream presence on the live server; older socket lives use the legacy counter.
  useEffect(() => {
    if (!currentStream) return;
    if (!isLiveKitStream) {
      api.joinLive();
      return () => { api.leaveLive(); };
    }
    if (!streamId || liveEnded) return;
    const joinedId = streamId;
    // A failed join only means this view isn't counted yet; it never ends the player.
    void api.joinLiveStream(joinedId).then(result => setLiveData(prev => prev ? { ...prev, viewersCount: result.viewersCount } : prev)).catch(error => console.warn('[Live] Viewer count join failed:', (error as Error)?.message));
    const leave = () => { void api.leaveLiveStream(joinedId); };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [streamId, isLiveKitStream, liveEnded]);

  // Realtime live document: viewer count, hearts from everyone, and Live Ended.
  useEffect(() => {
    if (!currentStream || !isLiveKitStream || !streamId) return;
    lastReactionCountRef.current = null;
    const watchedId = streamId;
    return onSnapshot(doc(db, 'liveStreams', watchedId), snapshot => {
      const data = snapshot.data();
      if (!snapshot.exists() || !data) return; // "ended" is decided by lives/{hostId} only
      setVotes(previous => ({ ...previous, likesCount: Number(data.likesCount || 0), dislikesCount: Number(data.dislikesCount || 0) }));
      setLiveData(prev => prev ? { ...prev, viewersCount: Number(data.viewersCount || 0), title: String(data.title || prev.title) } : prev);
      const reactions = Number(data.reactionsCount || 0);
      const previous = lastReactionCountRef.current;
      lastReactionCountRef.current = reactions;
      const last = data.lastReaction as { emoji?: string; userId?: string } | undefined;
      // Our own taps already burst locally.
      if (previous !== null && reactions > previous && last?.userId !== user?.id) burstReactions(String(last?.emoji || '❤️'), reactions - previous);
    }, error => console.warn('[Live] Could not follow live status:', error.message));
  }, [streamId, isLiveKitStream, user?.id]);

  // Realtime comments (Firestore) for LiveKit lives.
  useEffect(() => {
    if (!currentStream || !isLiveKitStream || liveEnded || !streamId) return;
    setComments([]);
    return listenLiveComments(streamId, items => setComments(items), error => console.warn('[Live] Could not load comments:', error.message));
  }, [streamId, isLiveKitStream, liveEnded]);

  useEffect(() => () => {
    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
  }, []);

  const burstReactions = (emoji: string, amount: number) => {
    for (let index = 0; index < Math.min(amount, 8); index += 1) {
      const id = `react_${Date.now()}_${index}_${Math.random()}`;
      setFloatingReactions(prev => [...prev.slice(-20), { id, emoji, left: Math.floor(Math.random() * 70) + 15 }]);
      setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500);
    }
  };

  useEffect(() => {
    if (!currentStream || !videoJoined) return;
    let cancelled = false;
    let liveKitRoom: Room | null = null;
    const liveKitAudio: HTMLAudioElement[] = [];
    let peer: RTCPeerConnection | null = null;
    if (currentStream.liveKitRoom) {
      if (liveEnded || !hostLive.loaded || !streamId || !hostLive.stream) return;
      const connectingId = streamId;
      let videoTimer: number | null = null;
      const fail = (error: unknown) => {
        if (cancelled) return;
        console.warn('[Live] Could not connect to the live video:', error);
        setConnectError(error instanceof Error ? error.message : 'Could not connect to the live video.');
        if (connectAttempt < 3) {
          setConnectState('retrying');
          window.setTimeout(() => { if (!cancelled) { setConnectAttempt(value => value + 1); setRetryNonce(value => value + 1); } }, 2000 * (connectAttempt + 1));
        } else setConnectState('failed');
      };
      const connectLiveKit = async () => {
        try {
          setConnectState(connectAttempt ? 'retrying' : 'connecting');
          console.info(`[Live] Joining room: ${roomName}, liveId: ${currentStream.hostId}, streamId: ${connectingId}, status: ${hostLive.stream?.status || 'live'}, attempt: ${connectAttempt + 1}`);
          // A FRESH viewer token (canSubscribe) for the host's CURRENT room, looked up by host on the server.
          const credentials = await api.getLiveKitViewerToken(connectingId, currentStream.hostId);
          if (cancelled) return;
          // Adaptive stream: LiveKit picks the simulcast layer for this screen (pixel density aware) and
          // the server drops to a lower layer the moment the network slows — no freezing.
          liveKitRoom = new Room({ adaptiveStream: { pixelDensity: 'screen', pauseVideoInBackground: true }, dynacast: true });
          liveKitRoom.on(RoomEvent.Reconnecting, () => setReconnecting(true));
          liveKitRoom.on(RoomEvent.Reconnected, () => setReconnecting(false));
          liveKitRoom.on(RoomEvent.TrackSubscribed, (track: any, publication: any) => {
            // Small jitter buffer (100 ms) smooths network bumps without noticeable delay.
            try { track.setPlayoutDelay?.(0.1); } catch { /* older browsers */ }
            if (track.kind === Track.Kind.Video && videoRef.current) {
              videoPubRef.current = publication;
              videoTrackRef.current = track;
              track.attach(videoRef.current);
              applyQuality(qualityPrefRef.current);
              if (videoTimer) window.clearTimeout(videoTimer);
              setConnectState('connected');
              setConnectError('');
              setRemoteVideo(new MediaStream());
            } else if (track.kind === Track.Kind.Audio) {
              const audio = track.attach() as HTMLAudioElement;
              audio.autoplay = true;
              audio.setAttribute('playsinline', '');
              audio.muted = mutedRef.current;
              audio.volume = volumeRef.current;
              document.body.appendChild(audio);
              liveKitAudio.push(audio);
              audioElsRef.current.push(audio);
              if (!pausedRef.current) void audio.play().catch(() => {});
            }
          });
          liveKitRoom.on(RoomEvent.TrackUnsubscribed, (track: any) => {
            track.detach().forEach((element: HTMLElement) => element.remove());
            if (track.kind === Track.Kind.Video) setRemoteVideo(null);
          });
          // Dropped (network, room restart): reconnect instead of ending.
          liveKitRoom.on(RoomEvent.Disconnected, () => { setReconnecting(false); setRemoteVideo(null); if (!cancelled) fail(new Error('The live video connection dropped.')); });
          await liveKitRoom.connect(credentials.url, credentials.token);
          if (cancelled) return;
          // Connected: the host's tracks may take a few seconds (OBS keyframe / transcoding). Never "ended".
          videoTimer = window.setTimeout(() => { if (!cancelled) setConnectState(state => state === 'connected' ? state : 'waiting-video'); }, 15_000);
        } catch (error) {
          fail(error);
        }
      };
      void connectLiveKit();
      return () => {
        cancelled = true;
        if (videoTimer) window.clearTimeout(videoTimer);
        liveKitRoom?.disconnect();
        liveKitAudio.forEach(audio => { audio.pause(); audio.remove(); });
        audioElsRef.current = audioElsRef.current.filter(audio => !liveKitAudio.includes(audio));
        setRemoteVideo(null);
      };
    }
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
        if (event.candidate) socketRef.current.emit('live:signal', {
          targetUserId: currentStream.hostId,
          streamId: currentStream.id,
          signal: { type: 'candidate', candidate: event.candidate }
        });
      };
      socketRef.current.emit('live:signal', { targetUserId: currentStream.hostId, streamId: currentStream.id, signal: { type: 'watch' } });
    });
    const unsubscribeSignal = onLiveSignalRef.current(async message => {
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
          socketRef.current.emit('live:signal', { targetUserId: currentStream.hostId, streamId: currentStream.id, signal: { type: 'answer', description: activePeer.localDescription } });
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
  }, [currentStream?.id, currentStream?.hostId, streamId, roomName, hostLive.loaded, Boolean(hostLive.stream), liveEnded, videoJoined, retryNonce]);

  // Socket listeners for real-time live events
  useEffect(() => {
    if (!currentStream) return;
    const unsubComment = onLiveComment((comment) => {
      setComments(prev => prev.some(item => item.id === comment.id) ? prev : [...prev.slice(-50), comment]);
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

    // Legacy socket lives end via the socket event; LiveKit lives end via their Firestore document.
    const unsubEnded = onLiveStopped(() => {
      if (!currentStream.liveKitRoom) setLegacyEnded(true);
    });

    return () => {
      unsubComment();
      unsubReaction();
      unsubViewers();
      unsubEnded();
    };
  }, [currentStream?.id, onLiveComment, onLiveReaction, onLiveViewersUpdated, onLiveStopped]);

  useEffect(() => currentStream ? onLiveCaption(data => { if (data.streamId === streamId || data.streamId === currentStream.id) setLiveCaption(data.text); }) : undefined, [onLiveCaption, currentStream?.id, streamId]);

  // ---- YouTube-style player chrome: volume / pause (LiveKit plays audio in its own elements),
  // auto-hiding controls, comments sheet, description, likes, subscribe, save. ----
  const audioElsRef = useRef<HTMLAudioElement[]>([]);
  const [volume, setVolume] = useState(1);
  const [paused, setPaused] = useState(false);
  const mutedRef = useRef(isMuted); mutedRef.current = isMuted;
  const volumeRef = useRef(volume); volumeRef.current = volume;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<number | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [votes, setVotes] = useState({ myVote: 0, likesCount: 0, dislikesCount: 0 });
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const lastTapRef = useRef(0);

  useEffect(() => {
    for (const audio of audioElsRef.current) {
      audio.muted = isMuted;
      audio.volume = volume;
      if (paused) audio.pause(); else void audio.play().catch(() => {});
    }
    const video = videoRef.current;
    if (video) {
      video.volume = volume; // older socket lives carry their sound in the video element
      if (paused) video.pause(); else void video.play().catch(() => {});
    }
  }, [isMuted, volume, paused]);

  /** Show the controls; they hide again after 3 s (not while paused or a menu is open). */
  const showControls = () => {
    setControlsVisible(true);
    if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3000);
  };
  useEffect(() => { showControls(); return () => { if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const controlsShown = controlsVisible || paused || qualityMenuOpen || !remoteVideo;

  useEffect(() => {
    const hostId = currentStream?.hostId;
    if (!hostId) return;
    const stopCount = listenFollowerCount(hostId, setFollowerCount);
    const stopFollowing = user?.id && user.id !== hostId ? listenFollowingState(user.id, hostId, setFollowing) : () => {};
    try { setSaved((JSON.parse(localStorage.getItem('echat:savedLives') || '[]') as string[]).includes(hostId)); } catch { /* private mode */ }
    return () => { stopCount(); stopFollowing(); };
  }, [currentStream?.hostId, user?.id]);

  useEffect(() => {
    if (!streamId || !currentStream?.liveKitRoom || !user) return;
    void api.voteLive(streamId).then(setVotes).catch(() => {});
  }, [streamId, currentStream?.liveKitRoom, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 2200); return () => window.clearTimeout(timer); }, [toast]);

  // Scroll to latest comment
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments, commentsOpen]);

  if (!currentStream) return null;

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim() || !user) return;
    try {
      await addLiveComment(streamId, { userId: user.id, userName: user.name, userAvatar: user.avatar || '', text: commentInput.trim().slice(0, 500), createdAt: Date.now() });
      setCommentInput('');
    } catch (err) {
      console.error('Failed to send comment:', err);
    }
  };

  const moderateComment = async (comment: LiveComment, action: 'delete' | 'timeout' | 'block') => {
    try {
      if (action === 'delete') await deleteLiveComment(streamId, comment.id);
      if (action === 'timeout' && user) await timeoutLiveUser(streamId, user.id, comment.userId, 10);
      if (action === 'block' && user) await blockLiveUser(user.id, comment.userId);
      setCommentMenuId(null);
    } catch (error) { alert(error instanceof Error ? error.message : 'Could not moderate this comment.'); }
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

    if (!currentStream.liveKitRoom) { api.sendLiveReaction(emoji); return; }
    // Batch rapid taps into one request (max 20 per batch).
    const pending = pendingReactionsRef.current;
    pendingReactionsRef.current = pending && pending.emoji === emoji ? { emoji, count: Math.min(pending.count + 1, 20) } : { emoji, count: 1 };
    if (pending && pending.emoji !== emoji) void api.sendLiveStreamReaction(streamId, pending.emoji, pending.count).catch(() => {});
    if (reactionTimerRef.current) return;
    reactionTimerRef.current = window.setTimeout(() => {
      reactionTimerRef.current = null;
      const batch = pendingReactionsRef.current;
      pendingReactionsRef.current = null;
      if (batch) void api.sendLiveStreamReaction(streamId, batch.emoji, batch.count).catch(() => {});
    }, 1200);
  };

  const startedAt = hostLive.stream?.startedAt || liveData?.startedAt || 0;
  const liveFor = (() => {
    if (!startedAt) return '';
    const minutes = Math.max(0, Math.floor((now - startedAt) / 60000));
    return minutes < 1 ? 'Started just now' : minutes < 60 ? `Started ${minutes} min ago` : `Started ${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
  })();
  const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(n);
  const viewers = liveData?.viewersCount ?? 0;
  const handle = `@${(hostName || 'echat').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
  const isHost = user?.id === currentStream.hostId;
  const latestComment = comments[comments.length - 1];
  const portraitVideo = videoAspect < 1.2;

  const vote = async (value: 1 | -1) => {
    if (!user) { setToast('Sign in to like this live'); return; }
    if (!currentStream.liveKitRoom) { handleSendReaction('👍'); return; }
    const next = votes.myVote === value ? 0 : value;
    // Optimistic: counts move at once; the server's real-time count follows.
    setVotes(previous => ({
      myVote: next,
      likesCount: Math.max(0, previous.likesCount + (next === 1 ? 1 : 0) - (previous.myVote === 1 ? 1 : 0)),
      dislikesCount: Math.max(0, previous.dislikesCount + (next === -1 ? 1 : 0) - (previous.myVote === -1 ? 1 : 0))
    }));
    try { setVotes(await api.voteLive(streamId, next)); } catch (error) { setToast(error instanceof Error ? error.message : 'Could not update your like'); }
  };
  const toggleFollow = async () => {
    if (!user) { setToast('Sign in to subscribe'); return; }
    try {
      if (following) { await unfollowCreator(user.id, currentStream.hostId); setFollowing(false); setToast(`Unsubscribed from ${hostName}`); }
      else { await followCreator(user.id, currentStream.hostId); setFollowing(true); setToast(`Subscribed to ${hostName}`); }
    } catch (error) { setToast(error instanceof Error ? error.message : 'Could not update your subscription'); }
  };
  const share = async () => {
    const url = `${window.location.origin}/live/${encodeURIComponent(currentStream.hostId)}`;
    try {
      if (navigator.share) await navigator.share({ title: liveData?.title || `${hostName} is live on EChat`, url });
      else { await navigator.clipboard.writeText(url); setToast('Link copied'); }
    } catch { /* share sheet closed */ }
  };
  const toggleSave = () => {
    try {
      const list = new Set(JSON.parse(localStorage.getItem('echat:savedLives') || '[]') as string[]);
      if (list.has(currentStream.hostId)) list.delete(currentStream.hostId); else list.add(currentStream.hostId);
      localStorage.setItem('echat:savedLives', JSON.stringify([...list]));
      setSaved(list.has(currentStream.hostId));
      setToast(list.has(currentStream.hostId) ? 'Saved' : 'Removed from saved');
    } catch { setToast('Could not save on this device'); }
  };
  /** Tap = show/hide controls; double tap = ❤️ (like Instagram / YouTube Shorts). */
  const onVideoTap = () => {
    const nowTap = Date.now();
    if (nowTap - lastTapRef.current < 300) handleSendReaction('❤️');
    lastTapRef.current = nowTap;
    if (controlsVisible && remoteVideo) { setControlsVisible(false); if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current); }
    else showControls();
  };

  const chatList = (
    <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
      {comments.length === 0 && <p className="py-6 text-center text-sm text-neutral-400">No comments yet. Say hi 👋</p>}
      {comments.map(c => (
        <div key={c.id} className="relative flex items-start gap-3 text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
          <img src={avatarSrc(c.userAvatar, c.userName)} alt={c.userName} className="h-7 w-7 shrink-0 rounded-full object-cover" />
          <div className="min-w-0 flex-1">
            <span className="mr-1.5 text-xs font-semibold text-neutral-400">{c.userName}</span>
            <span className="break-words text-white">{c.text}</span>
          </div>
          {isHost ? <><button type="button" aria-label="Moderate chat message" onClick={() => setCommentMenuId(id => id === c.id ? null : c.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-neutral-400 hover:bg-white/10"><MoreVertical size={15}/></button>{commentMenuId === c.id && <div className="absolute right-2 top-8 z-20 w-48 rounded-xl border border-neutral-700 bg-neutral-900 p-1.5 shadow-xl"><button type="button" onClick={() => void moderateComment(c, 'delete')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white hover:bg-white/10"><Trash2 size={14}/>Delete message</button><button type="button" onClick={() => void moderateComment(c, 'timeout')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white hover:bg-white/10">Timeout 10 minutes</button><button type="button" onClick={() => void moderateComment(c, 'block')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-rose-300 hover:bg-white/10"><Ban size={14}/>Block user</button></div>}</> : <LiveUserActions targetUserId={c.userId} targetName={c.userName} streamId={streamId} compact actionsOnly onBlocked={() => setComments(items => items.filter(item => item.userId !== c.userId))}/>}
        </div>
      ))}
      <div ref={commentsEndRef} />
    </div>
  );
  const chatInput = (
    <form onSubmit={handleSendComment} className="flex items-center gap-2 border-t border-white/10 p-3">
      <img src={avatarSrc(user?.avatar, user?.name || 'You')} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
      <input type="text" value={commentInput} onChange={e => setCommentInput(e.target.value)} placeholder="Add a comment..." aria-label="Add a comment" maxLength={500}
        className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2.5 text-sm text-white placeholder:text-neutral-400 outline-none focus:bg-white/15" />
      <button type="submit" aria-label="Send comment" disabled={!commentInput.trim()} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-600 text-white disabled:opacity-40"><Send size={16} /></button>
    </form>
  );

  return (
    <div ref={playerRef} data-layout={layout} className="fixed inset-0 z-50 bg-[#0f0f0f] text-white animate-in fade-in duration-200">
      {liveEnded && (
        <div role="status" className="absolute inset-0 z-[70] grid place-items-center bg-black/90 p-6 text-center text-white">
          <div className="max-w-sm">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-neutral-800"><Radio size={28} className="text-rose-500"/></div>
            <h2 className="text-2xl font-black">Live Ended</h2>
            <p className="mt-2 text-sm text-neutral-300">{hostName || 'The host'} has ended this live video. Thanks for watching!</p>
            <button type="button" onClick={onClose} className="mt-5 min-h-12 w-full rounded-xl bg-rose-600 px-4 font-extrabold text-white">Close</button>
          </div>
        </div>
      )}
      {toast && <div role="status" className="absolute bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-xl">{toast}</div>}

      <div className={layout === 'landscape' ? 'relative h-full w-full' : layout === 'desktop' ? 'flex h-full w-full' : 'flex h-full w-full flex-col'}>
        {/* Main column: video (16:9, full width) + title + channel row + comments box */}
        <div className={layout === 'landscape' ? 'h-full w-full' : `min-w-0 flex-1 overflow-y-auto ${layout === 'desktop' ? 'p-6' : ''}`}>

          {/* ===== VIDEO ===== */}
          <div data-testid="live-video-pane" onClick={onVideoTap} onMouseMove={layout === 'desktop' ? showControls : undefined}
            className={`relative select-none overflow-hidden bg-black ${layout === 'landscape' ? 'h-full w-full' : `w-full ${layout === 'desktop' ? 'rounded-2xl' : ''}`}`}
            style={layout === 'landscape' ? undefined : { aspectRatio: '16 / 9' }}>
            {/* Portrait phone cameras: blurred fill behind so the 16:9 player has no black bars and no cut-off faces. */}
            {remoteVideo && portraitVideo && qualityPref !== 'audio' && <img aria-hidden="true" src={avatarSrc(hostAvatar, hostName)} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />}
            <video ref={videoRef} autoPlay playsInline muted={currentStream.liveKitRoom ? true : isMuted} className={`absolute inset-0 h-full w-full ${portraitVideo ? 'object-contain' : 'object-cover'} ${remoteVideo ? 'block' : 'hidden'}`} />
            {remoteVideo && qualityPref === 'audio' && <div className="absolute inset-0 grid place-items-center bg-neutral-950 text-center"><div><img src={avatarSrc(hostAvatar, hostName)} alt="" className="mx-auto h-16 w-16 rounded-full object-cover ring-4 ring-rose-500/70" /><p className="mt-2 text-sm font-bold">🎧 Audio only</p></div></div>}
            {showCaptions && liveCaption && <div className={`absolute bottom-16 left-1/2 z-30 line-clamp-2 max-w-[85%] -translate-x-1/2 rounded bg-black/80 px-3 py-1.5 text-center font-semibold ${captionSize === 'sm' ? 'text-sm' : captionSize === 'lg' ? 'text-xl' : 'text-base'}`}>{liveCaption}</div>}

            {!remoteVideo && <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
              <img src={avatarSrc(hostAvatar, hostName)} alt={hostName} className="h-14 w-14 rounded-full object-cover ring-4 ring-rose-500/80" />
              <p className="mt-2 text-xs font-bold uppercase tracking-wider text-rose-400">
                {!videoJoined ? 'Low Data Mode is ON'
                  : hostLive.stale ? 'Reconnecting to the host…'
                  : connectState === 'retrying' ? `Retrying… (${Math.min(connectAttempt + 1, 3)}/3)`
                  : connectState === 'failed' ? 'Could not load the live video'
                  : connectState === 'waiting-video' ? "Waiting for the host's video…"
                  : 'Connecting to live video…'}
              </p>
              {videoJoined && connectState !== 'failed' && <span aria-hidden="true" className="mt-2 h-5 w-5 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />}
              {videoJoined && (connectState === 'failed' || connectState === 'waiting-video') && <button type="button" onClick={event => { event.stopPropagation(); retryNow(); }} className="mt-3 min-h-10 rounded-full bg-rose-600 px-5 text-sm font-extrabold">Tap to Retry</button>}
              {!videoJoined && <button type="button" onClick={event => { event.stopPropagation(); setVideoJoined(true); }} className="mt-3 min-h-11 rounded-full bg-rose-600 px-5 text-sm font-extrabold">Tap to Join Live</button>}
              {connectError && connectState === 'failed' && <p role="alert" className="mt-1 max-w-sm text-xs text-rose-200">{connectError}</p>}
            </div>}
            {remoteVideo && (hostLive.stale || reconnecting) && <div role="status" className="absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-bold"><span className="h-3 w-3 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />Reconnecting to the host…</div>}

            {/* Floating hearts from everyone */}
            <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
              {floatingReactions.map(r => <span key={r.id} className="absolute bottom-14 text-3xl drop-shadow-md animate-bounce" style={{ left: `${r.left}%` }}>{r.emoji}</span>)}
            </div>

            {/* Landscape: live chat bubbles float over the video */}
            {layout === 'landscape' && !commentsOpen && <div className="pointer-events-none absolute bottom-16 left-3 z-20 w-[45%] space-y-1.5">
              {comments.slice(-4).map(c => <div key={c.id} className="w-fit max-w-full rounded-2xl bg-black/55 px-3 py-1.5 text-xs backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2"><span className="mr-1 font-semibold text-neutral-300">{c.userName}</span>{c.text}</div>)}
            </div>}

            {/* ===== CONTROLS (auto-hide after 3 s, tap to show) ===== */}
            <div className={`absolute inset-0 z-30 transition-opacity duration-300 ${controlsShown ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
              <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/70 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent" />
              <div className="absolute left-3 top-3 flex items-center gap-2">
                <span className="flex items-center gap-1 rounded bg-rose-600 px-1.5 py-0.5 text-[11px] font-black uppercase"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live</span>
                <span className="flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-bold"><Users size={11} />{compact(viewers)}</span>
                <span className="max-w-[45vw] truncate text-xs font-bold drop-shadow">{hostName}</span>
              </div>
              <button type="button" onClick={event => { event.stopPropagation(); onClose(); }} aria-label="Close live" className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-black/40 hover:bg-black/60"><X size={20} /></button>
              <div className="absolute inset-x-0 bottom-0 px-3 pb-2" onClick={event => event.stopPropagation()}>
                <div className="mb-1.5 h-1 w-full rounded-full bg-rose-600" aria-hidden="true" />
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => { setPaused(value => !value); showControls(); }} aria-label={paused ? 'Play' : 'Pause'} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">{paused ? <Play size={18} fill="white" /> : <Pause size={18} fill="white" />}</button>
                  <button type="button" onClick={() => { setIsMuted(value => !value); showControls(); }} aria-label={isMuted ? 'Unmute' : 'Mute'} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">{isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
                  <input type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : volume} aria-label="Volume" onChange={event => { const next = Number(event.target.value); setVolume(next); setIsMuted(next === 0); showControls(); }} className="hidden h-1 w-20 accent-white sm:block" />
                  <span className="ml-1 flex items-center gap-1 text-xs font-bold"><span className="h-2 w-2 rounded-full bg-rose-600" />LIVE</span>
                  <span className="ml-auto" />
                  <button type="button" onClick={() => setShowCaptions(value => !value)} aria-label="Captions" className={`h-9 rounded-full px-2 text-xs font-black hover:bg-white/10 ${showCaptions ? 'text-white' : 'text-neutral-400'}`}>CC</button>
                  {/* Quality: Auto / 1080p / 720p / 480p / 360p / Audio only */}
                  <div className="relative">
                    <button type="button" onClick={() => { setQualityMenuOpen(open => !open); showControls(); }} aria-label="Video quality" aria-expanded={qualityMenuOpen} className="flex h-9 items-center gap-1 rounded-full px-2 text-xs font-bold hover:bg-white/10">
                      <Settings2 size={16} />{qualityPref === 'auto' ? `Auto${stats.height ? ` (${stats.height}p)` : ''}` : qualityPref === 'audio' ? 'Audio' : `${qualityPref}p`}
                      {stats.height >= 1080 && qualityPref !== 'audio' && <span className="rounded bg-rose-600 px-1 text-[9px] font-black">HD</span>}
                    </button>
                    {qualityMenuOpen && <div role="menu" className="absolute bottom-11 right-0 z-40 w-52 rounded-xl bg-neutral-900/95 p-1.5 shadow-2xl">
                      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Quality · {stats.height ? `${stats.height}p` : '—'}{stats.kbps ? ` · ${(stats.kbps / 1000).toFixed(1)} Mbps` : ''}</p>
                      {QUALITY_OPTIONS.map(option => <button key={option.id} type="button" role="menuitemradio" aria-checked={qualityPref === option.id} onClick={() => chooseQuality(option.id)} className={`flex min-h-9 w-full items-center justify-between rounded-lg px-2 text-left text-xs font-semibold hover:bg-white/10 ${qualityPref === option.id ? 'text-rose-300' : 'text-white'}`}>{option.label}{qualityPref === option.id && <span>✓</span>}</button>)}
                    </div>}
                  </div>
                  {layout === 'landscape' && <button type="button" onClick={() => setCommentsOpen(open => !open)} aria-label={commentsOpen ? 'Hide chat' : 'Show chat'} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">💬</button>}
                  {layout !== 'desktop' && <button type="button" onClick={() => void toggleRotate()} aria-label="Rotate" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><RotateCw size={17} /></button>}
                  <button type="button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'} className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10">{isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}</button>
                </div>
              </div>
            </div>
          </div>

          {/* ===== TITLE + CHANNEL ROW + COMMENTS (like YouTube) ===== */}
          {layout !== 'landscape' && <div className={layout === 'desktop' ? 'pt-4' : 'px-3 pb-6 pt-3'}>
            <h1 className={`font-extrabold leading-tight ${layout === 'desktop' ? 'text-xl' : 'text-lg'} ${descOpen ? '' : 'line-clamp-2'}`}>{liveData?.title || `${hostName} is live`}</h1>
            <button type="button" onClick={() => setDescOpen(open => !open)} className="mt-1 text-left text-xs text-neutral-400">
              <span className="font-semibold text-neutral-300">{handle}</span> · {compact(viewers)} watching · {compact(votes.likesCount)} likes{liveFor ? ` · ${liveFor}` : ''} <span className="font-bold text-white">{descOpen ? ' less' : ' ...more'}</span>
            </button>
            {descOpen && <div className="mt-2 rounded-xl bg-white/10 p-3 text-sm text-neutral-200">
              <p>{liveData?.title}</p>
              <p className="mt-1 text-xs text-neutral-400">{liveData?.category || 'Just Chatting'}{liveData?.location ? ` · ${liveData.location}` : ''}{startedAt ? ` · Live since ${new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p>
            </div>}

            <div className="mt-3 flex items-center gap-3">
              <img src={avatarSrc(hostAvatar, hostName)} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-sm font-bold">{hostName}<VerifiedBadge size={13} /></p>
                <p className="text-xs text-neutral-400">{compact(followerCount)} {followerCount === 1 ? 'subscriber' : 'subscribers'}</p>
              </div>
              {!isHost && <button type="button" onClick={() => void toggleFollow()} aria-pressed={following} className={`ml-1 min-h-9 shrink-0 rounded-full px-4 text-sm font-bold ${following ? 'bg-white/15 text-white' : 'bg-white text-neutral-900'}`}>{following ? 'Subscribed' : 'Subscribe'}</button>}
            </div>
            <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
              <div className="flex shrink-0 items-center rounded-full bg-white/10">
                <button type="button" onClick={() => void vote(1)} aria-label="Like" aria-pressed={votes.myVote === 1} className="flex min-h-9 items-center gap-1.5 rounded-l-full px-3.5 text-sm font-semibold hover:bg-white/10"><ThumbsUp size={17} fill={votes.myVote === 1 ? 'white' : 'none'} />{compact(votes.likesCount)}</button>
                <span className="h-5 w-px bg-white/20" />
                <button type="button" onClick={() => void vote(-1)} aria-label="Dislike" aria-pressed={votes.myVote === -1} className="flex min-h-9 items-center rounded-r-full px-3.5 hover:bg-white/10"><ThumbsDown size={17} fill={votes.myVote === -1 ? 'white' : 'none'} /></button>
              </div>
              <button type="button" onClick={() => void share()} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/15"><Share2 size={16} />Share</button>
              <button type="button" onClick={toggleSave} aria-pressed={saved} className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/15"><Bookmark size={16} fill={saved ? 'white' : 'none'} />{saved ? 'Saved' : 'Save'}</button>
              <div className="flex shrink-0 items-center rounded-full bg-white/10 px-1"><LiveUserActions targetUserId={currentStream.hostId} targetName={hostName} streamId={streamId} compact actionsOnly onBlocked={onClose}/></div>
            </div>

            {/* Comments box → bottom sheet with the full live chat */}
            {layout === 'portrait' && <button type="button" onClick={() => setCommentsOpen(true)} aria-label="Open comments" className="mt-3 w-full rounded-xl bg-white/10 p-3 text-left hover:bg-white/15">
              <span className="flex items-center justify-between text-sm font-bold">Comments {comments.length}<ChevronDown size={16} className="text-neutral-400" /></span>
              {latestComment ? <span className="mt-2 flex items-start gap-2"><img src={avatarSrc(latestComment.userAvatar, latestComment.userName)} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" /><span className="line-clamp-2 text-sm text-neutral-200">{latestComment.text}</span></span>
                : <span className="mt-2 block text-sm text-neutral-400">Be the first to comment</span>}
            </button>}
          </div>}
        </div>

        {/* Computer: live chat at the side, like YouTube live */}
        {layout === 'desktop' && <aside data-testid="live-chat-pane" className="flex w-[360px] shrink-0 flex-col border-l border-white/10 bg-[#0f0f0f]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><h2 className="text-sm font-bold">Live chat</h2><span className="text-xs text-neutral-400">{comments.length}</span></div>
          {chatList}
          {chatInput}
        </aside>}
      </div>

      {/* Phone: comments bottom sheet (portrait) / side sheet (landscape) */}
      {layout !== 'desktop' && commentsOpen && <div data-testid="live-chat-pane" role="dialog" aria-label="Live chat"
        className={`absolute z-[60] flex flex-col bg-[#212121] shadow-2xl animate-in ${layout === 'landscape' ? 'bottom-0 right-0 top-0 w-[42%] max-w-sm slide-in-from-right' : 'inset-x-0 bottom-0 h-[62%] rounded-t-2xl slide-in-from-bottom'}`}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-base font-bold">Comments <span className="font-normal text-neutral-400">{comments.length}</span></h2>
          <button type="button" onClick={() => setCommentsOpen(false)} aria-label="Close comments" className="grid h-9 w-9 place-items-center rounded-full hover:bg-white/10"><X size={18} /></button>
        </div>
        {chatList}
        {chatInput}
      </div>}
    </div>
  );
};

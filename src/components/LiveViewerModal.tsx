import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { liveRtcConfig } from '../utils/liveRtc';
import { api } from '../services/api';
import { LiveStream, LiveComment } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { avatarSrc } from './UserAvatar';
import { useBackButton } from '../hooks/useBackButton';
import { addLiveComment, blockLiveUser, deleteLiveComment, listenHostLive, listenLiveComments, timeoutLiveUser, type HostLiveState } from '../services/liveDiscovery';
import { useLiveProfile, withLive } from '../services/liveProfiles';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import { LiveUserActions } from './LiveUserActions';
import { isLowDataMode } from '../services/lowData';
import { Ban, MoreVertical, Trash2 } from 'lucide-react';
// @ts-ignore The SDK package is installed by Vercel's production install; local package typings may be absent in managed workspaces.
import { Room, RoomEvent, Track } from 'livekit-client';
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
          liveKitRoom = new Room({ adaptiveStream: true, dynacast: true });
          liveKitRoom.on(RoomEvent.TrackSubscribed, (track: any) => {
            if (track.kind === Track.Kind.Video && videoRef.current) {
              track.attach(videoRef.current);
              if (videoTimer) window.clearTimeout(videoTimer);
              setConnectState('connected');
              setConnectError('');
              setRemoteVideo(new MediaStream());
            } else if (track.kind === Track.Kind.Audio) {
              const audio = track.attach() as HTMLAudioElement;
              audio.autoplay = true;
              audio.setAttribute('playsinline', '');
              document.body.appendChild(audio);
              liveKitAudio.push(audio);
              void audio.play().catch(() => {});
            }
          });
          liveKitRoom.on(RoomEvent.TrackUnsubscribed, (track: any) => {
            track.detach().forEach((element: HTMLElement) => element.remove());
            if (track.kind === Track.Kind.Video) setRemoteVideo(null);
          });
          // Dropped (network, room restart): reconnect instead of ending.
          liveKitRoom.on(RoomEvent.Disconnected, () => { setRemoteVideo(null); if (!cancelled) fail(new Error('The live video connection dropped.')); });
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

  // Scroll to latest comment
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-stretch bg-black animate-in fade-in duration-200">
      <div className="bg-black w-full h-full min-w-0 min-h-0 shadow-2xl overflow-hidden flex flex-col">
        {liveEnded && (
          <div role="status" className="absolute inset-0 z-[60] grid place-items-center bg-black/90 p-6 text-center text-white">
            <div className="max-w-sm">
              <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-slate-800"><Radio size={28} className="text-rose-500"/></div>
              <h2 className="text-2xl font-black">Live Ended</h2>
              <p className="mt-2 text-sm text-slate-300">{hostName || 'The host'} has ended this live video. Thanks for watching!</p>
              <button type="button" onClick={onClose} className="mt-5 min-h-12 w-full rounded-xl bg-rose-600 px-4 font-extrabold text-white">Close</button>
            </div>
          </div>
        )}
        
        {/* Stream Header */}
        <div className="absolute top-0 left-0 right-0 z-40 p-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/70 text-white">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src={hostAvatar || '/logo-mark-blue.svg'}
                alt={hostName}
                className="w-10 h-10 rounded-full object-cover border-2 border-rose-500 shadow-md"
              />
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-rose-500 rounded-full ring-2 ring-slate-900 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white">{hostName}</span>
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
            <span className="hidden rounded-full bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 sm:inline">{liveData.category || 'Just Chatting'}</span>
            <LiveUserActions targetUserId={liveData.hostId} targetName={hostName} streamId={liveData.id} compact actionsOnly onBlocked={onClose}/>
            <div className="flex items-center gap-1 bg-slate-800/80 px-2.5 py-1 rounded-full text-xs font-semibold text-slate-200 border border-slate-700">
              <Users size={13} className="text-rose-400" />
              <span>{liveData.viewersCount ?? 0} watching</span>
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
            {remoteVideo && hostLive.stale && <div role="status" className="absolute left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/75 px-3 py-1.5 text-xs font-bold text-white"><span className="h-3 w-3 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />Reconnecting to the host…</div>}
            {!remoteVideo && <div className="flex flex-col items-center justify-center p-8 text-center">
              <div className="relative mb-4">
                <img
                  src={hostAvatar || '/logo-mark-blue.svg'}
                  alt={hostName}
                  className="w-28 h-28 rounded-full object-cover ring-4 ring-rose-500/80 shadow-2xl"
                />
                <div className="absolute inset-0 rounded-full border-4 border-rose-500 animate-ping opacity-35" />
              </div>
              <h3 className="text-xl font-black text-white flex items-center gap-2 justify-center">
                {hostName}
                <VerifiedBadge size={16} />
              </h3>
              <p className="text-xs text-rose-400 font-bold uppercase tracking-wider mt-1">
                {!videoJoined ? 'Low Data Mode is ON'
                  : hostLive.stale ? 'Reconnecting to the host…'
                  : connectState === 'retrying' ? `Retrying… (${Math.min(connectAttempt + 1, 3)}/3)`
                  : connectState === 'failed' ? 'Could not load the live video'
                  : connectState === 'waiting-video' ? "Waiting for the host's video…"
                  : 'Connecting to live video…'}
              </p>
              {videoJoined && connectState !== 'failed' && <span aria-hidden="true" className="mt-3 h-6 w-6 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />}
              {videoJoined && (connectState === 'failed' || connectState === 'waiting-video') && <button type="button" onClick={retryNow} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-extrabold text-white hover:bg-rose-500">Tap to Retry</button>}
              {!videoJoined && <button type="button" onClick={() => setVideoJoined(true)} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-full bg-gradient-to-r from-rose-600 to-pink-600 px-6 text-sm font-extrabold text-white shadow-lg shadow-rose-600/30 hover:brightness-110"><Radio size={18} />Tap to Join Live</button>}
              {connectError && connectState === 'failed' && <p role="alert" className="mt-2 max-w-sm text-xs text-rose-200">{connectError}</p>}
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
                <div key={c.id} className="relative text-xs bg-slate-800/70 p-2.5 rounded-xl border border-slate-800 flex items-start gap-2.5">
                  <img src={avatarSrc(c.userAvatar, c.userName)} alt={c.userName} className="w-6 h-6 rounded-full object-cover shrink-0" />
                  <div className="min-w-0">
                    <span className="font-bold text-rose-400 mr-1.5">{c.userName}:</span>
                    <span className="text-slate-200">{c.text}</span>
                  </div>
                  {user?.id === liveData.hostId ? <><button type="button" aria-label="Moderate chat message" onClick={() => setCommentMenuId(id => id === c.id ? null : c.id)} className="ml-auto grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-white/10"><MoreVertical size={15}/></button>{commentMenuId === c.id && <div className="absolute right-2 top-9 z-20 w-48 rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-xl"><button type="button" onClick={() => void moderateComment(c, 'delete')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white hover:bg-white/10"><Trash2 size={14}/>Delete message</button><button type="button" onClick={() => void moderateComment(c, 'timeout')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-white hover:bg-white/10">Timeout 10 minutes</button><button type="button" onClick={() => void moderateComment(c, 'block')} className="flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-xs font-semibold text-rose-300 hover:bg-white/10"><Ban size={14}/>Block user</button></div>}</> : <LiveUserActions targetUserId={c.userId} targetName={c.userName} streamId={streamId} compact actionsOnly onBlocked={() => setComments(items => items.filter(item => item.userId !== c.userId))}/>}
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

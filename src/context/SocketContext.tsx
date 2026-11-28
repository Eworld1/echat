import { wsUrl } from '../services/apiBase';
import { api, type DirectMessage } from '../services/api';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { Message, Post, Story, LiveStream, LiveComment, Notification as AppNotification, User } from '../types';
import { auth, firestore } from '../services/firebase';
import { registerActivitySocket } from '../services/chatActivity';
import { playSound } from '../utils/sounds';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  where,
  arrayUnion,
  getDoc,
  setDoc
} from 'firebase/firestore';
import {
  CALL_ANSWER_TIMEOUT_MS,
  CALL_DELIVERY_TIMEOUT_MS,
  CALL_RING_MAX_AGE_MS,
  type CallDoc,
  callMediaErrorMessage,
  getCallMedia,
  remoteCandidates,
  unavailableMessage
} from '../services/calls';
import { callDiagnostics, describeIceServers, explainIceError, testTurnRelay } from '../services/callDiagnostics';
import { createWsAudioRelay, TYPE_ECHO, type WsAudioRelay } from '../services/wsAudioRelay';
export interface IncomingCall {
  id: string; // Firestore document ID
  callerId: string;
  callerName: string;
  callerAvatar: string;
  callType: 'audio' | 'video';
  offer: any;
}

export interface ActiveCall {
  id?: string; // Firestore document ID
  startedAt?: number;
  partnerId: string;
  partnerName: string;
  partnerAvatar: string;
  callType: 'audio' | 'video';
  isCaller: boolean;
  status: 'calling' | 'ringing' | 'connecting' | 'connected' | 'ended' | 'offline';
}

interface SocketContextType {
  isConnected: boolean;
  onlineUserIds: string[];
  typingUsers: Record<string, boolean>;
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  startCall: (targetUserId: string, targetName: string, targetAvatar: string, callType: 'audio' | 'video') => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  endCall: () => Promise<void>;
  sendTyping: (receiverId: string, isTyping: boolean) => void;
  markSeen: (senderId: string) => void;
  peerConnectionRef: React.MutableRefObject<RTCPeerConnection | null>;
  localStreamRef: React.MutableRefObject<MediaStream | null>;
  remoteStream: MediaStream | null;
  speakerEnabled: boolean;
  setSpeakerEnabled: (enabled: boolean) => void;
  registerCallAudioElement: (element: HTMLAudioElement | null) => void;
  socket: any;
  onNewMessage: (cb: (msg: Message) => void) => () => void;
  onDirectMessage: (cb: (event: { message: DirectMessage; partner: User }) => void) => () => void;
  onDirectMessagesRead: (cb: (event: { readerId: string; senderId: string; readAt: number }) => void) => () => void;
  onMessageUpdated: (cb: (msg: Message) => void) => () => void;
  onMessageDeleted: (cb: (messageId: string) => void) => () => void;
  onPostUpdated: (cb: (post: Post) => void) => () => void;
  onPostDeleted: (cb: (postId: string) => void) => () => void;
  onNotification: (cb: (notification: AppNotification) => void) => () => void;
  /** Short message about the call (person offline, not allowed...). */
  callNotice: string | null;
  clearCallNotice: () => void;
  onNewPost: (cb: (post: Post) => void) => () => void;
  onStoryCreated: (cb: (story: Story) => void) => () => void;
  onLiveStarted: (cb: (stream: LiveStream) => void) => () => void;
  onLiveStopped: (cb: (streamId: string) => void) => () => void;
  onLiveStreamUpdated: (cb: (stream: LiveStream) => void) => () => void;
  onLiveComment: (cb: (comment: LiveComment) => void) => () => void;
  onLiveReaction: (cb: (data: { emoji: string; userName?: string; userId?: string }) => void) => () => void;
  onLiveViewersUpdated: (cb: (count: number) => void) => () => void;
  onLiveSignal: (cb: (data: { streamId: string; fromUserId: string; signal: Record<string, any> }) => void) => () => void;
  onLiveCaption: (cb: (data: { streamId: string; text: string; createdAt: number }) => void) => () => void;
  sendLiveCaption: (streamId: string, text: string) => void;
  switchCallType: (callType: 'audio' | 'video') => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const TURN_URL: string = import.meta.env.VITE_TURN_URL ?? '';
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME?.trim() ?? '';
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL ?? '';
/** Shared WebRTC settings: try every route (direct, STUN, TURN relay) and bundle media on one port. */
const PEER_SETTINGS: RTCConfiguration = {
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  iceCandidatePoolSize: 10
};
const ICE_CONFIG: RTCConfiguration = {
  ...PEER_SETTINGS,
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    ...(TURN_URL && TURN_USERNAME && TURN_CREDENTIAL
      ? [{
          urls: TURN_URL,
          username: TURN_USERNAME,
          credential: TURN_CREDENTIAL
        }]
      : [])
  ]
};

function logCallSetupError(stage: string, error: unknown): void {
  const details = error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: typeof error, message: String(error) };
  console.error(`[Call] ${stage} failed`, details);
}

const hasTurn = (servers: RTCIceServer[] = []) => servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => /^turns?:/i.test(url)));
let iceConfigCache: { config: RTCConfiguration; expiresAt: number; userId: string } | null = null;
let iceConfigInFlight: Promise<RTCConfiguration> | null = null;

async function fetchIceConfigOnce(userId: string, timeoutMs: number): Promise<RTCConfiguration & { provider?: string; hasTurn?: boolean; ttlSeconds?: number }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await api.getCallIceConfig(controller.signal, userId);
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * STUN + TURN relay servers. The TURN credentials live in the server env (Render) and reach the
 * browser through GET /api/calls/ice-config. Fetched at sign-in and cached, retried once (slow mobile
 * data), and the signed-in user is sent explicitly so the request is never refused for a missing id.
 */
async function getCallIceConfig(userId = ''): Promise<RTCConfiguration> {
  if (iceConfigCache && iceConfigCache.expiresAt > Date.now() && (!userId || iceConfigCache.userId === userId)) return iceConfigCache.config;
  if (iceConfigInFlight) return iceConfigInFlight;
  iceConfigInFlight = (async () => {
    let lastError: unknown = null;
    for (const timeoutMs of [10000, 15000]) {
      try {
        const remote = await fetchIceConfigOnce(userId, timeoutMs);
        if (!Array.isArray(remote.iceServers) || remote.iceServers.length === 0) throw new Error('The call network configuration did not include any ICE servers');
        const config: RTCConfiguration = { ...PEER_SETTINGS, iceServers: remote.iceServers };
        const turn = hasTurn(remote.iceServers);
        callDiagnostics.set({ iceSource: `server (${remote.provider || 'unknown'})`, iceServers: describeIceServers(remote.iceServers), hasTurn: turn });
        console.info(`[Call] iceServers from server (${remote.provider || 'unknown'}), TURN ${turn ? 'YES' : 'NO'}:`, describeIceServers(remote.iceServers));
        if (turn) {
          iceConfigCache = { config, userId, expiresAt: Date.now() + Math.max(60, Math.min(remote.ttlSeconds || 3600, 6 * 3600)) * 1000 };
          return config;
        }
        console.error('[Call] The server returned NO TURN relay. Calls between different networks will fail. Check the TURN env vars on Render.');
        return hasTurn(ICE_CONFIG.iceServers) ? { ...config, iceServers: [...remote.iceServers, ...(ICE_CONFIG.iceServers || []).filter(server => hasTurn([server]))] } : config;
      } catch (error) {
        lastError = error;
        logCallSetupError(`Loading ICE configuration (${timeoutMs / 1000}s)`, error);
      }
    }
    callDiagnostics.set({ iceSource: `FALLBACK (server unreachable: ${lastError instanceof Error ? lastError.message : 'error'})`, iceServers: describeIceServers(ICE_CONFIG.iceServers), hasTurn: hasTurn(ICE_CONFIG.iceServers) });
    console.error('[Call] Could not load TURN servers from the server; using STUN only. Calls between different networks will likely fail.', describeIceServers(ICE_CONFIG.iceServers));
    return ICE_CONFIG;
  })();
  try {
    return await iceConfigInFlight;
  } finally {
    iceConfigInFlight = null;
  }
}

/** Console helper (also the "Test TURN" button in ?calldebug=1): can this device get a relay candidate? */
if (typeof window !== 'undefined') {
  (window as Window & { echatTestTurn?: () => Promise<unknown> }).echatTestTurn = async () => {
    iceConfigCache = null;
    const config = await getCallIceConfig(localStorage.getItem('echat_user_id') || '');
    const result = await testTurnRelay(config);
    callDiagnostics.note(result.detail);
    return result;
  };
}

/** "relay" when media goes through the TURN server, else "direct" (host / STUN-mapped). */
async function logCallRoute(pc: RTCPeerConnection): Promise<void> {
  try {
    const stats = await pc.getStats();
    let pair: (RTCStats & { localCandidateId?: string; remoteCandidateId?: string; nominated?: boolean; state?: string; selected?: boolean }) | undefined;
    stats.forEach(report => {
      if (report.type === 'transport' && (report as RTCStats & { selectedCandidatePairId?: string }).selectedCandidatePairId) {
        pair = stats.get((report as RTCStats & { selectedCandidatePairId?: string }).selectedCandidatePairId!) as typeof pair;
      }
    });
    if (!pair) stats.forEach(report => {
      const candidate = report as typeof pair;
      if (!pair && report.type === 'candidate-pair' && candidate && (candidate.selected || (candidate.nominated && candidate.state === 'succeeded'))) pair = candidate;
    });
    if (!pair) return;
    const local = stats.get(pair.localCandidateId || '') as { candidateType?: string; protocol?: string; relayProtocol?: string } | undefined;
    const remote = stats.get(pair.remoteCandidateId || '') as { candidateType?: string } | undefined;
    const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    callDiagnostics.set({ route: relayed ? `relay (TURN${local?.relayProtocol ? `/${local.relayProtocol}` : ''})` : `direct (${local?.candidateType || '?'} → ${remote?.candidateType || '?'})` });
    console.info(relayed
      ? `[Call] connected via relay (TURN${local?.relayProtocol ? `/${local.relayProtocol}` : ''})`
      : `[Call] connected direct (${local?.candidateType || '?'} → ${remote?.candidateType || '?'}, ${local?.protocol || 'udp'})`);
  } catch { /* stats are diagnostics only */ }
}

let callAudioContext: AudioContext | null = null;

function getCallAudioContext(): AudioContext | null {
  try {
    const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!callAudioContext || callAudioContext.state === 'closed') callAudioContext = new AudioCtx();
    return callAudioContext;
  } catch {
    return null;
  }
}

function unlockCallAudio(): void {
  const context = getCallAudioContext();
  if (context?.state === 'suspended') void context.resume().catch(() => {});
}

function startSynthRingtone(ringtoneId = 'classic', kind: 'incoming' | 'outgoing' = 'incoming'): () => void {
  const ctx = getCallAudioContext();
  if (!ctx) return () => {};
  try {
    let isStopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const oscillators = new Set<OscillatorNode>();
    const patterns: Record<string, number[]> = {
      classic: [440, 480],
      chime: [523, 659],
      digital: [660, 880],
      gentle: [392, 494]
    };
    const notes = kind === 'outgoing' ? [440, 480] : patterns[ringtoneId] || patterns.classic;
    const toneDuration = kind === 'outgoing' ? 2 : 1.8;
    const cycleDuration = kind === 'outgoing' ? 6000 : 3500;

    const playBeep = () => {
      if (isStopped || ctx.state !== 'running') return;
      try {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + toneDuration);
        gain.connect(ctx.destination);
        notes.forEach(frequency => {
          const oscillator = ctx.createOscillator();
          oscillator.frequency.value = frequency;
          oscillator.connect(gain);
          oscillators.add(oscillator);
          oscillator.onended = () => oscillators.delete(oscillator);
          oscillator.start();
          oscillator.stop(ctx.currentTime + toneDuration);
        });
      } catch {
        return;
      }
    };
    const playCycle = () => {
      if (isStopped) return;
      playBeep();
      timer = setTimeout(playCycle, cycleDuration);
    };
    const onStateChange = () => {
      if (ctx.state !== 'running' || isStopped) return;
      if (timer) clearTimeout(timer);
      playCycle();
    };
    ctx.addEventListener('statechange', onStateChange);
    playCycle();
    return () => {
      isStopped = true;
      if (timer) clearTimeout(timer);
      ctx.removeEventListener('statechange', onStateChange);
      oscillators.forEach(oscillator => {
        try { oscillator.stop(); } catch { /* ignore */ }
      });
      oscillators.clear();
    };
  } catch {
    return () => {};
  }
}

function startCallTone(kind: 'incoming' | 'outgoing'): () => void {
  if (localStorage.getItem('echat_sound') === 'false') return () => {};
  return startSynthRingtone(localStorage.getItem('echat_ringtone') || 'classic', kind);
}

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});

  // Call States
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [speakerEnabled, setSpeakerEnabledState] = useState(true);
  const remoteTracksRef = useRef<Map<string, MediaStreamTrack>>(new Map());
  const callAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const registerCallAudioElement = useCallback((element: HTMLAudioElement | null) => {
    callAudioElementRef.current = element;
    if (element && remoteStream) {
      element.srcObject = remoteStream;
      element.muted = !speakerEnabled;
      element.volume = speakerEnabled ? 1 : 0;
      void element.play().catch(() => {});
    }
  }, [remoteStream, speakerEnabled]);
  const setSpeakerEnabled = useCallback((enabled:boolean) => {
    setSpeakerEnabledState(enabled);
    const element=callAudioElementRef.current;
    if(element){element.muted=!enabled;element.volume=enabled?1:0;if(enabled)void element.play().catch(()=>{});}
  },[]);

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const loggedMissedCallIdsRef = useRef<Set<string>>(new Set());
  const currentCallDocIdRef = useRef<string | null>(null);
  const callUnsubscribeRef = useRef<(() => void) | null>(null);
  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const isSettingUpCallRef = useRef<boolean>(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const appliedRemoteCandidatesRef = useRef(0);
  /** Receiver: the caller's last offer we answered (a new one = ICE restart). */
  const appliedOfferSdpRef = useRef('');
  /** Voice relay over the Render WebSocket (when P2P + TURN can't connect), and the track it plays. */
  const relayRef = useRef<{ leave: () => void } | null>(null);
  const wsRelayRef = useRef<WsAudioRelay | null>(null);
  const relayJoinRef = useRef<{ callId: string; partnerId: string } | null>(null);
  /** Socket-level relay events (binary audio, join/peer/error/pong) handled next to startRelay. */
  const relayEventRef = useRef<(event: { binary?: ArrayBuffer; json?: { type: string; [key: string]: unknown } }) => void>(() => {});
  const relayStartingRef = useRef(false);
  const relayActiveRef = useRef(false);
  const relayTracksRef = useRef(new Map<string, MediaStreamTrack>());
  const startRelayRef = useRef<(callId: string, reason: string) => void>(() => {});
  const connectedAtRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showIncomingCall = useCallback((call: IncomingCall | null) => {
    incomingCallRef.current = call;
    setIncomingCall(call);
  }, []);
  const updateActiveCall = useCallback((patch: Partial<ActiveCall>) => {
    const current = activeCallRef.current;
    if (!current) return;
    const updated = { ...current, ...patch };
    activeCallRef.current = updated;
    setActiveCall(updated);
  }, []);

  useEffect(() => {
    const unlock = () => {
      unlockCallAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchstart', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const publishRemoteTracks = useCallback((extraTrack?: MediaStreamTrack) => {
    // Relay mode: play only what LiveKit delivers (the silent P2P receivers would add a black video).
    if (relayActiveRef.current) {
      for (const [id, track] of relayTracksRef.current) if (track.readyState === 'ended') relayTracksRef.current.delete(id);
      const relayStream = new MediaStream([...relayTracksRef.current.values()]);
      setRemoteStream(relayStream);
      const relayAudio = callAudioElementRef.current;
      if (relayAudio && relayStream.getAudioTracks().length) {
        relayAudio.srcObject = relayStream;
        relayAudio.muted = !speakerEnabled;
        relayAudio.volume = speakerEnabled ? 1 : 0;
        void relayAudio.play().catch(() => {});
      }
      return;
    }
    const pc = peerConnectionRef.current;
    for (const receiver of pc?.getReceivers() || []) {
      const track = receiver.track;
      if (track && track.readyState !== 'ended') remoteTracksRef.current.set(track.id, track);
    }
    if (extraTrack && extraTrack.readyState !== 'ended') remoteTracksRef.current.set(extraTrack.id, extraTrack);
    for (const [id, track] of remoteTracksRef.current) if (track.readyState === 'ended') remoteTracksRef.current.delete(id);
    const stream = new MediaStream([...remoteTracksRef.current.values()]);
    setRemoteStream(stream);
    const audio = callAudioElementRef.current;
    if (audio && stream.getAudioTracks().length) {
      audio.srcObject = stream;
      audio.muted = !speakerEnabled;
      audio.volume = speakerEnabled ? 1 : 0;
      void audio.play().catch(() => {});
    }
  }, [speakerEnabled]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Subscriptions
  const messageListeners = useRef<Set<(msg: Message) => void>>(new Set());
  const directMessageListeners = useRef<Set<(event: { message: DirectMessage; partner: User }) => void>>(new Set());
  const directMessagesReadListeners = useRef<Set<(event: { readerId: string; senderId: string; readAt: number }) => void>>(new Set());
  const messageUpdatedListeners = useRef<Set<(msg: Message) => void>>(new Set());
  const messageDeletedListeners = useRef<Set<(messageId: string) => void>>(new Set());
  const postUpdateListeners = useRef<Set<(post: Post) => void>>(new Set());
  const postDeleteListeners = useRef<Set<(postId: string) => void>>(new Set());
  const notificationListeners = useRef<Set<(n: AppNotification) => void>>(new Set());
  const [callNotice, setCallNotice] = useState<string | null>(null);
  // Load the STUN/TURN list at sign-in so a call never starts without the relay (slow mobile data).
  useEffect(() => { if (user?.id) void getCallIceConfig(user.id); }, [user?.id]);
  const logMissedCall = useCallback((call: ActiveCall) => {
    if (!user || !call.isCaller) return;
    const key = call.id || `${call.partnerId}:${call.callType}:${call.startedAt ?? 'unknown'}`;
    if (loggedMissedCallIdsRef.current.has(key)) return;
    loggedMissedCallIdsRef.current.add(key);
    void api.sendMessage({ receiverId: call.partnerId, text: `__echat_missed_call__:${call.callType}` })
      .catch(error => console.warn('Could not save missed-call chat item:', error));
  }, [user?.id]);
  const newPostListeners = useRef<Set<(post: Post) => void>>(new Set());
  const storyListeners = useRef<Set<(story: Story) => void>>(new Set());
  const liveStartedListeners = useRef<Set<(stream: LiveStream) => void>>(new Set());
  const liveStoppedListeners = useRef<Set<(streamId: string) => void>>(new Set());
  const liveStreamUpdatedListeners = useRef<Set<(stream: LiveStream) => void>>(new Set());
  const liveCommentListeners = useRef<Set<(comment: LiveComment) => void>>(new Set());
  const liveReactionListeners = useRef<Set<(data: { emoji: string; userName?: string; userId?: string }) => void>>(new Set());
  const liveViewersUpdatedListeners = useRef<Set<(count: number) => void>>(new Set());
  const liveSignalListeners = useRef<Set<(data: { streamId: string; fromUserId: string; signal: Record<string, any> }) => void>>(new Set());
  const liveCaptionListeners = useRef<Set<(data: { streamId: string; text: string; createdAt: number }) => void>>(new Set());

  // WebRTC teardown helper
  const cleanUpCallMedia = useCallback(() => {
    isSettingUpCallRef.current = false;
    if (stopRingtoneRef.current) {
      stopRingtoneRef.current();
      stopRingtoneRef.current = null;
    }
    if (callUnsubscribeRef.current) {
      callUnsubscribeRef.current();
      callUnsubscribeRef.current = null;
    }
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      } catch { /* ignore */ }
      localStreamRef.current = null;
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
    connectedAtRef.current = null;
    appliedRemoteCandidatesRef.current = 0;
    appliedOfferSdpRef.current = '';
    relayRef.current?.leave();
    relayRef.current = null;
    relayStartingRef.current = false;
    relayActiveRef.current = false;
    relayTracksRef.current.clear();
    incomingCallRef.current = null;
    remoteTracksRef.current.clear();
    if (peerConnectionRef.current) {
      const pc = peerConnectionRef.current;
      try {
        pc.getReceivers().forEach(r => r.track?.stop());
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch { /* ignore */ }
      peerConnectionRef.current = null;
    }
    currentCallDocIdRef.current = null;
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
    activeCallRef.current = null;
    setActiveCall(null);
    setIncomingCall(null);
  }, []);

  /**
   * Incoming calls. Signaling runs entirely through the Firestore `calls` collection, so calls work
   * on Vercel and Render without a WebSocket server. A call doc that is still "ringing" for me shows
   * the incoming popup; when it stops ringing (caller hung up, answered on another device) the popup
   * closes. If I'm already in a call, new callers are told I'm busy.
   */
  useEffect(() => {
    if (!user?.id) return;
    const callsQuery = query(collection(firestore, 'calls'), where('receiverId', '==', user.id), where('status', '==', 'ringing'));
    const unsubscribe = onSnapshot(callsQuery, snapshot => {
      const ringing = snapshot.docs
        .map(item => ({ ...(item.data() as CallDoc), id: item.id }))
        .filter(item => item.callerId !== user.id && !item.endedAt && Date.now() - (item.createdAt || 0) < CALL_RING_MAX_AGE_MS)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      const shown = incomingCallRef.current;
      if (shown && !ringing.some(item => item.id === shown.id)) {
        // The caller gave up (or another of my devices answered).
        stopRingtoneRef.current?.();
        stopRingtoneRef.current = null;
        showIncomingCall(null);
      }

      for (const item of ringing) {
        if (item.id === incomingCallRef.current?.id || item.id === activeCallRef.current?.id) continue;
        const busy = Boolean(activeCallRef.current || incomingCallRef.current);
        if (busy) {
          updateDoc(doc(firestore, 'calls', item.id), { status: 'missed', reason: 'busy', endedAt: Date.now() }).catch(() => {});
          continue;
        }
        showIncomingCall({
          id: item.id,
          callerId: item.callerId,
          callerName: item.callerName || 'User',
          callerAvatar: item.callerAvatar || '',
          callType: item.type === 'video' ? 'video' : 'audio',
          offer: item.offer
        });
        // Tell the caller this device is ringing (otherwise they see "User is unavailable").
        updateDoc(doc(firestore, 'calls', item.id), { ringingAt: Date.now() }).catch(() => {});
        if (!stopRingtoneRef.current) stopRingtoneRef.current = startCallTone('incoming');
      }
    }, error => {
      console.warn('Incoming call listener failed:', error);
    });
    return () => unsubscribe();
  }, [user?.id, showIncomingCall]);

  // WebSocket for chat & feed real-time events
  useEffect(() => {
    if (!user) {
      if (socketRef.current) socketRef.current.close();
      return;
    }

    // Auto-reconnecting socket: free hosts and mobile networks drop idle connections, and without
    // a reconnect every user would show as "Offline" until the page was refreshed.
    let disposed = false;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
    const ws = new WebSocket(wsUrl());
    ws.binaryType = 'arraybuffer';
    socketRef.current = ws;

    ws.onopen = () => {
      retry = 0;
      setIsConnected(true);
      registerActivitySocket(payload => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload)); });
      // The server checks this Firebase ID token, so only this account receives its private messages.
      void (auth.currentUser?.getIdToken().catch(() => '') ?? Promise.resolve('')).then(idToken => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'auth', userId: user.id, idToken }));
      });
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onclose = () => {
      if (socketRef.current === ws) socketRef.current = null;
      if (heartbeat) clearInterval(heartbeat);
      setIsConnected(false);
      setOnlineUserIds([]);
      setTypingUsers({});
      if (!disposed) {
        const delay = Math.min(30000, 1000 * 2 ** retry);
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      }
    };

    ws.onmessage = async (event) => {
      if (typeof event.data !== 'string') {
        if (event.data instanceof ArrayBuffer) relayEventRef.current({ binary: event.data });
        return;
      }
      try {
        const data = JSON.parse(event.data);
        if (typeof data?.type === 'string' && data.type.startsWith('call_relay_')) { relayEventRef.current({ json: data }); return; }
        // Signed in again after a reconnect: rejoin the voice relay of the call in progress.
        if (data?.type === 'online_users_list' && relayJoinRef.current && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'call_relay_join', ...relayJoinRef.current }));
        }

        switch (data.type) {
          case 'online_users_list':
            setOnlineUserIds(data.userIds || []);
            break;

          case 'user_status':
            setOnlineUserIds(prev => {
              if (data.isOnline) {
                return Array.from(new Set([...prev, data.userId]));
              } else {
                return prev.filter(id => id !== data.userId);
              }
            });
            break;

          case 'direct_message_updated':
          case 'direct_message_hidden':
          case 'dm_chat_cleared':
            // Edit / delete for everyone / delete for me / clear chat: MessagesPage listens to this.
            window.dispatchEvent(new CustomEvent('echat:dm-change', { detail: data }));
            break;
          case 'chat_activity':
            window.dispatchEvent(new CustomEvent('echat:chat-activity', { detail: { chatId: data.chatId, userId: data.fromUserId, name: data.name, state: data.state || null } }));
            break;
          case 'user_typing':
            setTypingUsers(prev => ({
              ...prev,
              [data.senderId]: data.isTyping
            }));
            break;

          case 'new_message':
          case 'message_sent':
            if (data.type === 'new_message' && data.message?.senderId !== user?.id && localStorage.getItem('echat_active_chat') !== data.message?.senderId) playSound('message_in');
            messageListeners.current.forEach(cb => cb(data.message));
            break;

          case 'direct_message':
            if (data.message?.senderId !== user?.id && localStorage.getItem('echat_active_chat') !== data.message?.senderId) playSound('message_in');
            directMessageListeners.current.forEach(cb => cb({ message: data.message, partner: data.partner }));
            break;

          case 'direct_messages_read':
            directMessagesReadListeners.current.forEach(cb => cb({
              readerId: data.readerId,
              senderId: data.senderId,
              readAt: data.readAt
            }));
            break;

          case 'message_updated':
            messageUpdatedListeners.current.forEach(cb => cb(data.message));
            break;

          case 'message_deleted':
            if (data.userId === user?.id && typeof data.messageId === 'string') messageDeletedListeners.current.forEach(cb => cb(data.messageId));
            break;

          case 'user_updated':
          case 'developer_profile_updated':
            if (data.user?.id) window.dispatchEvent(new CustomEvent('echat:profile-updated', { detail: data.user }));
            break;

          case 'unread_counts':
            window.dispatchEvent(new CustomEvent('echat:unread', { detail: { messages: Number(data.messages) || 0, notifications: Number(data.notifications) || 0 } }));
            break;
          case 'new_notification':
            if (data.notification) notificationListeners.current.forEach(cb => cb(data.notification));
            break;

          case 'post_deleted':
            if (typeof data.postId === 'string') postDeleteListeners.current.forEach(cb => cb(data.postId));
            break;

          case 'post_updated':
            postUpdateListeners.current.forEach(cb => cb(data.post));
            break;

          case 'new_post':
            newPostListeners.current.forEach(cb => cb(data.post));
            break;

          case 'story_created':
            storyListeners.current.forEach(cb => cb(data.story));
            break;

          case 'live_started':
            liveStartedListeners.current.forEach(cb => cb(data.stream));
            break;

          case 'live_ended':
          case 'live_stopped':
            liveStoppedListeners.current.forEach(cb => cb(data.streamId));
            break;

          case 'live_stream_updated':
            liveStreamUpdatedListeners.current.forEach(cb => cb(data.stream));
            break;

          case 'live_comment':
            liveCommentListeners.current.forEach(cb => cb(data.comment));
            break;

          case 'live_reaction':
            liveReactionListeners.current.forEach(cb => cb(data));
            break;

          case 'live_viewers_updated':
            liveViewersUpdatedListeners.current.forEach(cb => cb(data.viewersCount));
            break;

          case 'live:signal':
            liveSignalListeners.current.forEach(cb => cb(data));
            break;

          case 'live_caption':
            liveCaptionListeners.current.forEach(cb => cb(data));
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('WebSocket dispatch error:', err);
      }
    };
    };
    // Reconnect immediately when the phone/tab wakes up or the network returns.
    const reconnectNow = () => {
      const cur = socketRef.current;
      if (disposed || (cur && cur.readyState <= WebSocket.OPEN)) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      retry = 0;
      connect();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') reconnectNow(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', reconnectNow);

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeat) clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', reconnectNow);
      const cur = socketRef.current;
      socketRef.current = null;
      cur?.close();
      setIsConnected(false);
      cleanUpCallMedia();
    };
  }, [user?.id, cleanUpCallMedia]);

  /** One peer connection for either side. ICE candidates go into the call doc as they appear. */
  const createPeer = useCallback(async (callId: string, role: 'caller' | 'receiver', stream: MediaStream, callType: 'audio' | 'video', docReady: Promise<void> = Promise.resolve()) => {
    const config = await getCallIceConfig(user?.id || '');
    callDiagnostics.reset(true);
    callDiagnostics.set({ policy: config.iceTransportPolicy || 'all' });
    console.info(`[Call] ${role} starting. iceTransportPolicy=${config.iceTransportPolicy || 'all'}, TURN ${hasTurn(config.iceServers) ? 'YES' : 'NO'}, iceServers:`, describeIceServers(config.iceServers));
    const pc = new RTCPeerConnection(config);
    peerConnectionRef.current = pc;
    localStreamRef.current = stream;
    const field = role === 'caller' ? 'callerCandidates' : 'receiverCandidates';
    pc.onicegatheringstatechange = () => {
      callDiagnostics.set({ gathering: pc.iceGatheringState });
      if (pc.iceGatheringState !== 'complete') return;
      const { candidates, hasTurn: turnConfigured } = callDiagnostics.get();
      console.info('[Call] Candidate gathering complete:', candidates);
      if (turnConfigured && candidates.relay === 0) {
        console.error('[Call] NO relay candidate gathered: this device could not reach the TURN server (blocked port/protocol or bad credentials).');
        callDiagnostics.note('No relay candidate — TURN unreachable from this network');
      }
    };
    pc.onicecandidate = event => {
      if (!event.candidate) return;
      callDiagnostics.candidate(event.candidate.type);
      if (event.candidate.type === 'relay' && callDiagnostics.get().candidates.relay === 1) {
        const relayProtocol = (event.candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol;
        console.info(`[Call] First relay candidate gathered (${event.candidate.protocol}${relayProtocol ? ` via ${relayProtocol}` : ''})`);
      }
      const candidate = event.candidate.toJSON();
      // Candidates found before the call doc exists wait for it.
      docReady
        .then(() => updateDoc(doc(firestore, 'calls', callId), { [field]: arrayUnion(candidate) }))
        .catch(error => logCallSetupError('Publishing ICE candidate', error));
    };
    stream.getTracks().forEach(track => { track.enabled = true; pc.addTrack(track, stream); });
    // Audio calls keep a video slot so "Switch to video" works without renegotiating.
    if (callType === 'audio' || !stream.getVideoTracks().length) pc.addTransceiver('video', { direction: 'sendrecv' });
    pc.ontrack = event => {
      event.track.enabled = true;
      event.track.onunmute = () => publishRemoteTracks(event.track);
      event.track.onmute = () => publishRemoteTracks(event.track);
      event.track.onended = () => publishRemoteTracks();
      publishRemoteTracks(event.track);
    };
    const markConnected = () => {
      if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
      if (activeCallRef.current?.status === 'connected') return;
      connectedAtRef.current = connectedAtRef.current || Date.now();
      stopRingtoneRef.current?.();
      stopRingtoneRef.current = null;
      updateActiveCall({ status: 'connected', startedAt: connectedAtRef.current });
    };
    /*
     * Network changes (Wi-Fi ↔ mobile data, carrier NAT rebinding) drop the route. Instead of hanging
     * up, the caller does an ICE restart: a new offer goes through the call doc, the receiver answers,
     * and fresh candidates (including TURN relay ones) are gathered. Up to 3 tries per drop.
     */
    let restartAttempts = 0;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let lastRoute = '';
    const isUp = () => relayActiveRef.current || pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed';
    const closed = () => peerConnectionRef.current !== pc || pc.signalingState === 'closed';
    /** Only the caller restarts (no glare). From the 2nd try, or when asked, gather TURN relay candidates only. */
    const restartIce = async (reason: string, forceRelay = false) => {
      if (role !== 'caller' || closed() || pc.signalingState !== 'stable') return;
      if (restartAttempts >= 3) {
        setCallNotice('The call could not reconnect. Check your internet connection and try again.');
        void hangUpRef.current();
        return;
      }
      restartAttempts += 1;
      const relayOnly = forceRelay || restartAttempts >= 2;
      if (relayOnly && pc.getConfiguration().iceTransportPolicy !== 'relay') {
        try {
          pc.setConfiguration({ ...pc.getConfiguration(), iceTransportPolicy: 'relay' });
          callDiagnostics.set({ policy: 'relay' });
        } catch (error) { logCallSetupError('Switching to relay-only', error); }
      }
      console.info(`[Call] ICE restart ${restartAttempts}/3 (${reason})${relayOnly ? ' — forcing TURN relay' : ''}`);
      callDiagnostics.note(`ICE restart ${restartAttempts}/3: ${reason}${relayOnly ? ' (relay only)' : ''}`);
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        if (closed()) return;
        await pc.setLocalDescription(offer);
        // Clearing the old answer makes sure only the receiver's fresh answer is applied.
        await updateDoc(doc(firestore, 'calls', callId), { offer: { type: offer.type, sdp: offer.sdp }, answer: null });
      } catch (error) {
        logCallSetupError('ICE restart', error);
      }
    };
    const scheduleRestart = (reason: string, delayMs: number, forceRelay = false) => {
      if (restartTimer || role !== 'caller') return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!closed() && !isUp()) void restartIce(reason, forceRelay);
      }, delayMs);
    };
    const scheduleHangUp = (message: string, delayMs: number) => {
      if (disconnectTimerRef.current) return;
      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        if (!closed() && !isUp()) {
          console.error(`[Call] Giving up: ${message}`, callDiagnostics.get());
          setCallNotice(message);
          void hangUpRef.current();
        }
      }, delayMs);
    };
    /*
     * Once offer + answer are exchanged, ICE has 10s to connect. If it hasn't, the caller restarts
     * with TURN relay only (works through carrier NAT / firewalls); if that doesn't connect either,
     * the call ends with an error instead of sitting on "Connecting…" forever.
     */
    pc.onsignalingstatechange = () => {
      if (pc.signalingState !== 'stable' || connectTimer || isUp() || closed()) return;
      connectTimer = setTimeout(() => {
        if (closed() || isUp()) return;
        console.warn('[Call] Not connected after 10s', callDiagnostics.get());
        callDiagnostics.note('Not connected after 10s');
        setCallNotice('Still connecting… switching to the relay server.');
        // Both sides do this on their own: TURN relay restart AND the eChat server voice relay; first one to carry audio wins.
        void restartIce('not connected after 10s', true);
        startRelayRef.current(callId, 'not connected after 10s');
        scheduleHangUp('Could not connect the call. The network may be blocking calls — try again or switch networks.', 20000);
      }, 10000);
    };
    const onState = () => {
      const state = pc.connectionState || pc.iceConnectionState;
      callDiagnostics.set({ ice: pc.iceConnectionState, connection: pc.connectionState });
      if (state !== lastRoute) { lastRoute = state; console.info(`[Call] connectionState: ${pc.connectionState} / ice: ${pc.iceConnectionState}`); }
      if (isUp()) {
        if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
        if (connectTimer) { clearTimeout(connectTimer); connectTimer = null; }
        restartAttempts = 0;
        setCallNotice(notice => notice?.startsWith('Still connecting') ? null : notice);
        markConnected();
        void logCallRoute(pc);
      } else if (state === 'failed') {
        // All candidate pairs failed: restart ICE right away (relay only) and start the eChat server voice relay.
        scheduleRestart('ice failed', 0, true);
        startRelayRef.current(callId, 'ice failed');
        scheduleHangUp('Could not connect the call. The network may be blocking calls — try again or switch networks.', 20000);
      } else if (state === 'disconnected') {
        // Brief drops (switching Wi-Fi / mobile data) often recover by themselves; restart if not.
        scheduleRestart('disconnected', 2500);
        scheduleHangUp('Call dropped: the connection was lost.', 30000);
      }
    };
    pc.onicecandidateerror = event => {
      const error = event as RTCPeerConnectionIceErrorEvent;
      // Log every error with its URL (701 = unreachable/blocked, 401 = bad credentials) for diagnosis.
      const line = `ICE error ${explainIceError(error.errorCode)} @ ${error.url || '?'}${error.errorText ? ` "${error.errorText}"` : ''}`;
      console.warn(`[Call] ${line}`);
      if (/^turns?:/i.test(error.url || '')) callDiagnostics.note(line);
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    return pc;
  }, [publishRemoteTracks, updateActiveCall, user?.id]);

  const applyRemoteCandidates = useCallback(async (pc: RTCPeerConnection, list: RTCIceCandidateInit[]) => {
    if (!pc.remoteDescription) return;
    const start = appliedRemoteCandidatesRef.current;
    appliedRemoteCandidatesRef.current = list.length;
    for (const candidate of list.slice(start)) await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
  }, []);

  /** Follow the call doc: answer, the other side's network candidates, decline / hang-up, video switch. */
  const watchCallDoc = useCallback((callId: string, role: 'caller' | 'receiver') => {
    callUnsubscribeRef.current?.();
    let chain = Promise.resolve();
    callUnsubscribeRef.current = onSnapshot(doc(firestore, 'calls', callId), snapshot => {
      chain = chain.then(async () => {
        const data = snapshot.data() as CallDoc | undefined;
        const current = activeCallRef.current;
        const pc = peerConnectionRef.current;
        if (!data || !current || current.id !== callId || !pc || pc.signalingState === 'closed') return;

        if (data.endedAt || data.status === 'declined' || data.status === 'missed') {
          const byMe = data.endedBy === user?.id;
          if (!byMe) {
            if (data.status === 'declined') setCallNotice(data.reason === 'no_permission' ? `${current.partnerName} could not use their microphone/camera.` : `${current.partnerName} declined the call.`);
            else if (data.status === 'missed' && role === 'caller') {
              setCallNotice(unavailableMessage(current.partnerName, data.reason));
              logMissedCall(current);
            } else setCallNotice('Call ended.');
          }
          cleanUpCallMedia();
          return;
        }
        if (role === 'caller') {
          if (data.ringingAt && current.status === 'calling') updateActiveCall({ status: 'ringing' });
          if (data.answer && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
            stopRingtoneRef.current?.();
            stopRingtoneRef.current = null;
            if (activeCallRef.current?.status !== 'connected') updateActiveCall({ status: 'connecting' });
          }
        }
        if (role === 'receiver' && data.offer?.sdp && appliedOfferSdpRef.current && data.offer.sdp !== appliedOfferSdpRef.current && pc.signalingState === 'stable') {
          appliedOfferSdpRef.current = data.offer.sdp;
          console.info('[Call] Answering ICE restart from the caller');
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(doc(firestore, 'calls', callId), { answer: { type: answer.type, sdp: answer.sdp } });
        }
        await applyRemoteCandidates(pc, remoteCandidates(data, role));
        if (data.currentType && data.currentTypeBy !== user?.id && data.currentType !== activeCallRef.current?.callType) {
          if (data.currentType === 'audio') {
            const videoSender = pc.getTransceivers().find(item => item.receiver.track.kind === 'video')?.sender;
            if (videoSender) await videoSender.replaceTrack(null).catch(() => {});
            localStreamRef.current?.getVideoTracks().forEach(track => { track.enabled = false; });
          }
          updateActiveCall({ callType: data.currentType });
        }
      }).catch(error => console.warn('Call update failed:', error));
    }, error => console.warn('Call listener failed:', error));
  }, [user?.id, applyRemoteCandidates, cleanUpCallMedia, logMissedCall, updateActiveCall]);

  /** Hang up / cancel and write the final call-history fields. */
  const hangUp = useCallback(async (missedReason?: string) => {
    stopRingtoneRef.current?.();
    stopRingtoneRef.current = null;
    const call = activeCallRef.current;
    const callId = call?.id;
    const now = Date.now();
    cleanUpCallMedia();
    if (!call || !callId || !user) return;
    const connectedAt = call.startedAt && call.status === 'connected' ? call.startedAt : null;
    const update = connectedAt
      ? { endedAt: now, endedBy: user.id, duration: Math.max(0, Math.round((now - connectedAt) / 1000)) }
      : call.isCaller && call.status !== 'connecting'
        ? { status: 'missed', reason: missedReason || 'cancelled', endedAt: now, endedBy: user.id, duration: 0 }
        : { endedAt: now, endedBy: user.id, duration: 0 };
    await updateDoc(doc(firestore, 'calls', callId), update).catch(error => console.warn('Could not save call end:', error));
    if (call.isCaller && !connectedAt && call.status !== 'connecting') logMissedCall(call);
  }, [user?.id, cleanUpCallMedia, logMissedCall]);
  const hangUpRef = useRef(hangUp);
  hangUpRef.current = hangUp;

  /** Mark the call connected through the voice relay (first audio from the partner arrived). */
  const activateRelay = (track: MediaStreamTrack) => {
    relayTracksRef.current.clear();
    relayTracksRef.current.set(track.id, track);
    if (relayActiveRef.current) return;
    relayActiveRef.current = true;
    console.info('[Call] connected via eChat server voice relay (Render WebSocket)');
    callDiagnostics.set({ route: 'eChat server relay (voice)' });
    callDiagnostics.note('relay: receiving audio from partner');
    if (disconnectTimerRef.current) { clearTimeout(disconnectTimerRef.current); disconnectTimerRef.current = null; }
    stopRingtoneRef.current?.();
    stopRingtoneRef.current = null;
    connectedAtRef.current = connectedAtRef.current || Date.now();
    setCallNotice(notice => notice?.startsWith('Still connecting') ? null : notice);
    if (activeCallRef.current?.callType === 'video') setCallNotice('Connected through the eChat relay: voice only on this network.');
    if (activeCallRef.current?.status !== 'connected') updateActiveCall({ status: 'connected', startedAt: connectedAtRef.current });
    publishRemoteTracks();
  };

  const pendingTestsRef = useRef(new Map<string, (value: number) => void>());
  relayEventRef.current = ({ binary, json }) => {
    if (binary) {
      const bytes = new Uint8Array(binary);
      if (bytes[0] === TYPE_ECHO) { pendingTestsRef.current.get('echo')?.(Date.now()); return; }
      const relay = wsRelayRef.current;
      if (!relay || !relayJoinRef.current) return;
      relay.receive(binary);
      if (!relayActiveRef.current) activateRelay(relay.outputTrack);
      return;
    }
    if (!json) return;
    if (json.type === 'call_relay_pong') { pendingTestsRef.current.get('pong')?.(json.signedIn ? 1 : 0); return; }
    if (json.callId && json.callId !== relayJoinRef.current?.callId) return;
    if (json.type === 'call_relay_joined') callDiagnostics.note(`relay: joined on server (partner ${json.partnerPresent ? 'already there' : 'not there yet'})`);
    else if (json.type === 'call_relay_peer') {
      callDiagnostics.note(`relay: partner ${json.present ? 'joined' : 'left'} the relay`);
      if (!json.present && relayActiveRef.current) {
        const pc = peerConnectionRef.current;
        const p2pUp = pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
        if (!p2pUp) { setCallNotice('Call dropped: the connection was lost.'); void hangUpRef.current(); }
      }
    } else if (json.type === 'call_relay_error') {
      console.error('[Call] relay error from server:', json.error);
      callDiagnostics.note(`relay ERROR from server: ${String(json.error)}`);
    }
  };

  /**
   * Start the voice relay through the eChat server (Render). Both sides do this on their own after
   * 10s without a WebRTC connection; audio flows as soon as both have joined.
   */
  startRelayRef.current = (callId: string, reason: string) => {
    const stream = localStreamRef.current;
    const call = activeCallRef.current;
    if (relayRef.current || relayStartingRef.current || !stream || call?.id !== callId) return;
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      const line = `relay FAILED: socket to the eChat server is not connected (state ${ws ? ws.readyState : 'none'})`;
      console.error(`[Call] ${line}`);
      callDiagnostics.note(line);
      return;
    }
    const context = getCallAudioContext();
    if (!context) { callDiagnostics.note('relay FAILED: this browser has no Web Audio'); return; }
    relayStartingRef.current = true;
    console.info(`[Call] Starting eChat server voice relay (${reason})`);
    callDiagnostics.note(`relay: starting (${reason})`);
    const send = (frame: ArrayBuffer) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 256 * 1024) return false;
      socket.send(frame);
      return true;
    };
    createWsAudioRelay(context, stream, send).then(relay => {
      if (activeCallRef.current?.id !== callId) { relay.stop(); return; }
      wsRelayRef.current = relay;
      relayJoinRef.current = { callId, partnerId: call.partnerId };
      socketRef.current?.send(JSON.stringify({ type: 'call_relay_join', callId, partnerId: call.partnerId }));
      const watchdog = window.setInterval(() => {
        if (activeCallRef.current?.id !== callId || !wsRelayRef.current) { window.clearInterval(watchdog); return; }
        const { sent, received, dropped } = wsRelayRef.current.stats();
        callDiagnostics.set({ route: relayActiveRef.current ? `eChat server relay (voice) · sent ${sent} recv ${received} drop ${dropped}` : callDiagnostics.get().route });
        if (!relayActiveRef.current) callDiagnostics.note(`relay: waiting for partner audio (sent ${sent}, received ${received})`);
      }, 5000);
      relayRef.current = {
        leave: () => {
          window.clearInterval(watchdog);
          const socket = socketRef.current;
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'call_relay_leave', callId }));
          relay.stop();
          wsRelayRef.current = null;
          relayJoinRef.current = null;
        }
      };
    }).catch(error => {
      const line = `relay FAILED: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
      logCallSetupError('Voice relay', error);
      callDiagnostics.note(line);
    }).finally(() => { relayStartingRef.current = false; });
  };

  /** Console / debug-panel test of the relay path: JSON ping and a binary echo through the eChat server. */
  useEffect(() => {
    (window as Window & { echatTestRelay?: () => Promise<string> }).echatTestRelay = async () => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        const line = `RELAY TEST FAILED: socket to the eChat server is not open (state ${ws ? ws.readyState : 'none'})`;
        callDiagnostics.note(line); console.error(`[Call] ${line}`); return line;
      }
      const wait = (key: string, ms: number) => new Promise<number>((resolve, reject) => {
        const timer = window.setTimeout(() => { pendingTestsRef.current.delete(key); reject(new Error(`no ${key} in ${ms / 1000}s`)); }, ms);
        pendingTestsRef.current.set(key, value => { window.clearTimeout(timer); pendingTestsRef.current.delete(key); resolve(value); });
      });
      try {
        let started = Date.now();
        const pong = wait('pong', 5000);
        ws.send(JSON.stringify({ type: 'call_relay_ping', t: started }));
        const signedIn = await pong;
        const pingMs = Date.now() - started;
        started = Date.now();
        const echo = wait('echo', 5000);
        const frame = new Uint8Array(643); frame[0] = TYPE_ECHO;
        ws.send(frame.buffer);
        await echo;
        const line = `RELAY TEST OK: server reachable (ping ${pingMs}ms, audio-size echo ${Date.now() - started}ms), socket ${signedIn ? 'signed in' : 'NOT signed in — relay will refuse to join'}`;
        callDiagnostics.note(line); console.info(`[Call] ${line}`); return line;
      } catch (error) {
        const line = `RELAY TEST FAILED: ${error instanceof Error ? error.message : String(error)}`;
        callDiagnostics.note(line); console.error(`[Call] ${line}`); return line;
      }
    };
  }, []);

  // Start outgoing call
  const startCall = async (targetUserId: string, targetName: string, targetAvatar: string, callType: 'audio' | 'video') => {
    if (!user || !targetUserId || targetUserId === user.id) return;
    if (isSettingUpCallRef.current || activeCallRef.current || incomingCallRef.current) {
      setCallNotice('Finish your current call first.');
      return;
    }
    isSettingUpCallRef.current = true;
    cleanUpCallMedia();
    isSettingUpCallRef.current = true;
    unlockCallAudio();

    const callRef = doc(collection(firestore, 'calls'));
    const newCall: ActiveCall = { id: callRef.id, startedAt: undefined, partnerId: targetUserId, partnerName: targetName, partnerAvatar: targetAvatar, callType, isCaller: true, status: 'calling' };
    activeCallRef.current = newCall;
    setActiveCall(newCall);

    let stage = 'getUserMedia';
    try {
      // Ask for microphone (and camera) permission.
      const { stream, videoFallback } = await getCallMedia(callType);
      if (activeCallRef.current?.id !== callRef.id) { stream.getTracks().forEach(track => track.stop()); return; }
      if (videoFallback) setCallNotice('No camera found, so this call is starting with audio only.');
      stopRingtoneRef.current = startCallTone('outgoing');

      stage = 'creating the call';
      let markDocReady: () => void = () => {};
      let markDocFailed: (error: unknown) => void = () => {};
      const docReady = new Promise<void>((resolve, reject) => { markDocReady = resolve; markDocFailed = reject; });
      docReady.catch(() => {});
      const pc = await createPeer(callRef.id, 'caller', stream, callType, docReady);
      if (activeCallRef.current?.id !== callRef.id) { pc.close(); return; }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const createdAt = Date.now();
      const base: CallDoc = {
        callerId: user.id, callerName: user.name || 'User', callerAvatar: user.avatar || '',
        receiverId: targetUserId, receiverName: targetName || 'User', receiverAvatar: targetAvatar || '',
        type: callType, callType, status: 'ringing', offer: { type: offer.type, sdp: offer.sdp }, answer: null,
        callerCandidates: [], receiverCandidates: [], duration: 0, createdAt
      };
      try {
        await setDoc(callRef, base);
        markDocReady();
      } catch (error) {
        markDocFailed(error);
        throw error;
      }
      if (activeCallRef.current?.id !== callRef.id) {
        // Cancelled while the call was being created.
        updateDoc(callRef, { status: 'missed', reason: 'cancelled', endedAt: Date.now(), endedBy: user.id }).catch(() => {});
        return;
      }
      watchCallDoc(callRef.id, 'caller');
    } catch (err) {
      logCallSetupError(stage, err);
      setCallNotice(stage === 'getUserMedia' ? callMediaErrorMessage(err, callType, 'start') : 'Could not start the call. Check your internet connection and try again.');
      if (stage !== 'getUserMedia') updateDoc(callRef, { status: 'missed', reason: 'failed', endedAt: Date.now(), endedBy: user.id }).catch(() => {});
      cleanUpCallMedia();
    } finally {
      isSettingUpCallRef.current = false;
    }
  };

  // Accept incoming call (runs from the Answer tap, so the permission prompt and audio playback are allowed)
  const acceptCall = async () => {
    const call = incomingCallRef.current;
    if (!call || !user) return;
    callAudioElementRef.current?.play().catch(() => {});
    unlockCallAudio();
    stopRingtoneRef.current?.();
    stopRingtoneRef.current = null;
    const callRef = doc(firestore, 'calls', call.id);
    const accepted: ActiveCall = { id: call.id, partnerId: call.callerId, partnerName: call.callerName, partnerAvatar: call.callerAvatar, callType: call.callType, isCaller: false, status: 'connecting' };
    showIncomingCall(null);
    activeCallRef.current = accepted;
    setActiveCall(accepted);
    currentCallDocIdRef.current = call.id;

    let media: Awaited<ReturnType<typeof getCallMedia>>;
    try {
      media = await getCallMedia(call.callType);
    } catch (err) {
      setCallNotice(callMediaErrorMessage(err, call.callType, 'accept'));
      updateDoc(callRef, { status: 'declined', reason: 'no_permission', endedAt: Date.now(), endedBy: user.id }).catch(() => {});
      cleanUpCallMedia();
      return;
    }
    try {
      const snapshot = await getDoc(callRef);
      const data = snapshot.data() as CallDoc | undefined;
      if (!data || data.status !== 'ringing' || data.endedAt || !data.offer) {
        media.stream.getTracks().forEach(track => track.stop());
        setCallNotice('This call has already ended.');
        cleanUpCallMedia();
        return;
      }
      if (activeCallRef.current?.id !== call.id) { media.stream.getTracks().forEach(track => track.stop()); return; }
      if (media.videoFallback) setCallNotice('No camera found, so you joined with audio only.');
      const pc = await createPeer(call.id, 'receiver', media.stream, call.callType);
      appliedOfferSdpRef.current = data.offer.sdp || '';
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      await applyRemoteCandidates(pc, remoteCandidates(data, 'receiver'));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      watchCallDoc(call.id, 'receiver');
      await updateDoc(callRef, { status: 'answered', answer: { type: answer.type, sdp: answer.sdp }, answeredAt: Date.now() });
    } catch (err) {
      console.error('Failed to answer call:', err);
      setCallNotice('Could not connect the call. Check your internet connection and try again.');
      updateDoc(callRef, { endedAt: Date.now(), endedBy: user.id }).catch(() => {});
      cleanUpCallMedia();
    }
  };

  const rejectCall = async () => {
    stopRingtoneRef.current?.();
    stopRingtoneRef.current = null;
    const call = incomingCallRef.current;
    showIncomingCall(null);
    if (call && user) await updateDoc(doc(firestore, 'calls', call.id), { status: 'declined', reason: 'declined', endedAt: Date.now(), endedBy: user.id }).catch(() => {});
  };

  const endCall = () => hangUp();

  // Caller side: nobody's device rang -> unavailable; rang but no answer -> missed.
  useEffect(() => {
    if (!activeCall?.isCaller || !activeCall.id || (activeCall.status !== 'calling' && activeCall.status !== 'ringing')) return;
    const callId = activeCall.id;
    const status = activeCall.status;
    const timer = window.setTimeout(() => {
      const current = activeCallRef.current;
      if (!current || current.id !== callId || current.status !== status) return;
      setCallNotice(status === 'calling' ? unavailableMessage(current.partnerName, 'unavailable') : `${current.partnerName} didn't answer. A missed call was added to your chat.`);
      void hangUp(status === 'calling' ? 'unavailable' : 'no_answer');
    }, status === 'calling' ? CALL_DELIVERY_TIMEOUT_MS : CALL_ANSWER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [activeCall?.id, activeCall?.status, activeCall?.isCaller, hangUp]);

  // Closing the tab mid-call: tell the other side (best effort).
  useEffect(() => {
    const onUnload = () => { if (activeCallRef.current) void hangUpRef.current(); else if (incomingCallRef.current) void rejectCallRef.current(); };
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);
  const rejectCallRef = useRef(rejectCall);
  rejectCallRef.current = rejectCall;

  const sendTyping = (receiverId: string, isTyping: boolean) => {
    if (!socketRef.current || !user || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({
      type: isTyping ? 'typing_start' : 'typing_stop',
      senderId: user.id,
      receiverId
    }));
  };

  const markSeen = (senderId: string) => {
    if (!socketRef.current || !user || socketRef.current.readyState !== WebSocket.OPEN) return;
    socketRef.current.send(JSON.stringify({
      type: 'message_seen',
      viewerId: user.id,
      senderId
    }));
  };

  // Mock socket object with emit() for components expecting socket.emit
  const mockSocket = {
    emit: (event: string, payload: any) => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: event, ...payload }));
      }
    }
  };

  const onNewMessage = (cb: (msg: Message) => void) => {
    messageListeners.current.add(cb);
    return () => { messageListeners.current.delete(cb); };
  };

  const onDirectMessage = (cb: (event: { message: DirectMessage; partner: User }) => void) => {
    directMessageListeners.current.add(cb);
    return () => { directMessageListeners.current.delete(cb); };
  };

  const onDirectMessagesRead = (cb: (event: { readerId: string; senderId: string; readAt: number }) => void) => {
    directMessagesReadListeners.current.add(cb);
    return () => { directMessagesReadListeners.current.delete(cb); };
  };

  const onMessageUpdated = (cb: (msg: Message) => void) => {
    messageUpdatedListeners.current.add(cb);
    return () => { messageUpdatedListeners.current.delete(cb); };
  };

  const onMessageDeleted = (cb: (messageId: string) => void) => {
    messageDeletedListeners.current.add(cb);
    return () => { messageDeletedListeners.current.delete(cb); };
  };

  const onNotification = (cb: (n: AppNotification) => void) => {
    notificationListeners.current.add(cb);
    return () => { notificationListeners.current.delete(cb); };
  };

  const onPostDeleted = (cb: (postId: string) => void) => {
    postDeleteListeners.current.add(cb);
    return () => { postDeleteListeners.current.delete(cb); };
  };

  const onPostUpdated = (cb: (post: Post) => void) => {
    postUpdateListeners.current.add(cb);
    return () => { postUpdateListeners.current.delete(cb); };
  };

  const onNewPost = (cb: (post: Post) => void) => {
    newPostListeners.current.add(cb);
    return () => { newPostListeners.current.delete(cb); };
  };

  const onStoryCreated = (cb: (story: Story) => void) => {
    storyListeners.current.add(cb);
    return () => { storyListeners.current.delete(cb); };
  };

  const onLiveStarted = (cb: (stream: LiveStream) => void) => {
    liveStartedListeners.current.add(cb);
    return () => { liveStartedListeners.current.delete(cb); };
  };

  const onLiveStopped = (cb: (streamId: string) => void) => {
    liveStoppedListeners.current.add(cb);
    return () => { liveStoppedListeners.current.delete(cb); };
  };

  const onLiveStreamUpdated = (cb: (stream: LiveStream) => void) => {
    liveStreamUpdatedListeners.current.add(cb);
    return () => { liveStreamUpdatedListeners.current.delete(cb); };
  };

  const onLiveComment = (cb: (comment: LiveComment) => void) => {
    liveCommentListeners.current.add(cb);
    return () => { liveCommentListeners.current.delete(cb); };
  };

  const onLiveReaction = (cb: (data: { emoji: string; userName?: string; userId?: string }) => void) => {
    liveReactionListeners.current.add(cb);
    return () => { liveReactionListeners.current.delete(cb); };
  };

  const onLiveViewersUpdated = (cb: (count: number) => void) => {
    liveViewersUpdatedListeners.current.add(cb);
    return () => { liveViewersUpdatedListeners.current.delete(cb); };
  };

  const onLiveSignal = (cb: (data: { streamId: string; fromUserId: string; signal: Record<string, any> }) => void) => {
    liveSignalListeners.current.add(cb);
    return () => { liveSignalListeners.current.delete(cb); };
  };

  const onLiveCaption = useCallback((cb: (data: { streamId: string; text: string; createdAt: number }) => void) => {
    liveCaptionListeners.current.add(cb);
    return () => { liveCaptionListeners.current.delete(cb); };
  }, []);
  const sendLiveCaption = useCallback((streamId: string, text: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: 'live-caption', streamId, text }));
  }, []);
  const switchCallType = useCallback((callType: 'audio' | 'video') => {
    const call = activeCallRef.current;
    if (!call) return;
    updateActiveCall({ callType });
    if (call.id && user?.id) updateDoc(doc(firestore, 'calls', call.id), { currentType: callType, currentTypeBy: user.id }).catch(() => {});
  }, [updateActiveCall, user?.id]);

  return (
    <SocketContext.Provider
      value={{
        isConnected,
        onlineUserIds,
        typingUsers,
        activeCall,
        incomingCall,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        sendTyping,
        markSeen,
        peerConnectionRef,
        localStreamRef,
        remoteStream,
        speakerEnabled,
        setSpeakerEnabled,
        registerCallAudioElement,
        socket: mockSocket,
        onNewMessage,
        onDirectMessage,
        onDirectMessagesRead,
        onMessageUpdated,
        onMessageDeleted,
        onPostUpdated,
        onPostDeleted,
        onNotification,
        callNotice,
        clearCallNotice: () => setCallNotice(null),
        onNewPost,
        onStoryCreated,
        onLiveStarted,
        onLiveStopped,
        onLiveStreamUpdated,
        onLiveComment,
        onLiveReaction,
        onLiveViewersUpdated,
        onLiveSignal,
        onLiveCaption,
        sendLiveCaption,
        switchCallType
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within a SocketProvider');
  return context;
};

import { wsUrl } from '../services/apiBase';
import { api } from '../services/api';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { Message, Post, Story, LiveStream, LiveComment, Notification as AppNotification } from '../types';
import { firestore } from '../services/firebase';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  where,
  arrayUnion
} from 'firebase/firestore';

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
  partnerId: string;
  partnerName: string;
  partnerAvatar: string;
  callType: 'audio' | 'video';
  isCaller: boolean;
  status: 'calling' | 'ringing' | 'connected' | 'ended' | 'offline';
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
  socket: any;
  onNewMessage: (cb: (msg: Message) => void) => () => void;
  onMessageUpdated: (cb: (msg: Message) => void) => () => void;
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
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

const TURN_URL: string = import.meta.env.VITE_TURN_URL ?? '';

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    // Your own TURN server (recommended for production) via VITE_TURN_*; otherwise a shared public relay
    // so calls still connect for people behind strict mobile-carrier NATs.
    ...(TURN_URL
      ? [{
          urls: TURN_URL,
          username: import.meta.env.VITE_TURN_USERNAME ?? '',
          credential: import.meta.env.VITE_TURN_CREDENTIAL ?? ''
        }]
      : [])
  ],
  iceCandidatePoolSize: 4
};

async function getCallIceConfig(): Promise<RTCConfiguration> {
  try { return await api.getCallIceConfig(); }
  catch { return ICE_CONFIG; }
}

function startSynthRingtone(ringtoneId = 'classic'): () => void {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return () => {};
    const ctx = new AudioCtx();
    let isStopped = false;
    let timer: any = null;

    const patterns: Record<string, number[]> = {
      classic: [440, 480],
      chime: [523, 659],
      digital: [660, 880],
      gentle: [392, 494]
    };
    const notes = patterns[ringtoneId] || patterns.classic;
    const playBeep = () => {
      if (isStopped || ctx.state === 'closed') return;
      try {
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.8);
        gain.connect(ctx.destination);
        notes.forEach(frequency => {
          const oscillator = ctx.createOscillator();
          oscillator.frequency.value = frequency;
          oscillator.connect(gain);
          oscillator.start();
          oscillator.stop(ctx.currentTime + 1.8);
        });
      } catch {}
      if (!isStopped) {
        timer = setTimeout(playBeep, 3500);
      }
    };
    playBeep();
    return () => {
      isStopped = true;
      if (timer) clearTimeout(timer);
      try { ctx.close(); } catch {}
    };
  } catch {
    return () => {};
  }
}

// Play phone ringtone using /ring.mp3 with synthesis fallback
function startRingtone(): () => void {
  if (localStorage.getItem('echat_sound') === 'false') return () => {};
  return startSynthRingtone(localStorage.getItem('echat_ringtone') || 'classic');
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

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const currentCallDocIdRef = useRef<string | null>(null);
  const callUnsubscribeRef = useRef<(() => void) | null>(null);
  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const isSettingUpCallRef = useRef<boolean>(false);
  const processedCandidatesRef = useRef<Set<string>>(new Set());
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Subscriptions
  const messageListeners = useRef<Set<(msg: Message) => void>>(new Set());
  const messageUpdatedListeners = useRef<Set<(msg: Message) => void>>(new Set());
  const postUpdateListeners = useRef<Set<(post: Post) => void>>(new Set());
  const postDeleteListeners = useRef<Set<(postId: string) => void>>(new Set());
  const notificationListeners = useRef<Set<(n: AppNotification) => void>>(new Set());
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const newPostListeners = useRef<Set<(post: Post) => void>>(new Set());
  const storyListeners = useRef<Set<(story: Story) => void>>(new Set());
  const liveStartedListeners = useRef<Set<(stream: LiveStream) => void>>(new Set());
  const liveStoppedListeners = useRef<Set<(streamId: string) => void>>(new Set());
  const liveStreamUpdatedListeners = useRef<Set<(stream: LiveStream) => void>>(new Set());
  const liveCommentListeners = useRef<Set<(comment: LiveComment) => void>>(new Set());
  const liveReactionListeners = useRef<Set<(data: { emoji: string; userName?: string; userId?: string }) => void>>(new Set());
  const liveViewersUpdatedListeners = useRef<Set<(count: number) => void>>(new Set());
  const liveSignalListeners = useRef<Set<(data: { streamId: string; fromUserId: string; signal: Record<string, any> }) => void>>(new Set());

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
      } catch {}
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      const pc = peerConnectionRef.current;
      try {
        pc.getReceivers().forEach(r => r.track?.stop());
        pc.ontrack = null;
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
      } catch {}
      peerConnectionRef.current = null;
    }
    currentCallDocIdRef.current = null;
    processedCandidatesRef.current.clear();
    pendingCandidatesRef.current = [];
    setRemoteStream(null);
    activeCallRef.current = null;
    setActiveCall(null);
    setIncomingCall(null);
  }, []);

  const addOrQueueCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === 'closed') return;
    if (!pc.remoteDescription || !pc.remoteDescription.type) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('Error adding ICE candidate:', err);
    }
  }, []);

  // Listen for incoming calls in Firestore 'calls' collection
  useEffect(() => {
    if (!user?.id) return;

    try {
      const callsQuery = query(
        collection(firestore, 'calls'),
        where('receiverId', '==', user.id),
        where('status', '==', 'ringing')
      );

      const unsubscribe = onSnapshot(callsQuery, (snapshot) => {
        // Find latest ringing call not created by myself
        const incomingDocs = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(d => d.callerId !== user.id && Date.now() - (d.createdAt || 0) < 120000)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

        if (incomingDocs.length > 0) {
          const docData = incomingDocs[0];
          // If we are not already in an active connected call
          if (!activeCallRef.current || activeCallRef.current.status !== 'connected') {
            currentCallDocIdRef.current = docData.id;
            setIncomingCall({
              id: docData.id,
              callerId: docData.callerId,
              callerName: docData.callerName || docData.caller?.name || 'User',
              callerAvatar: docData.callerAvatar || docData.caller?.avatar || '',
              callType: docData.type || docData.callType || 'audio',
              offer: docData.offer
            });

            // Start ringing sound
            if (!stopRingtoneRef.current) {
              stopRingtoneRef.current = startRingtone();
            }
          }
        } else {
          // No active ringing call for me
          if (incomingCall) {
            setIncomingCall(null);
            if (stopRingtoneRef.current) {
              stopRingtoneRef.current();
              stopRingtoneRef.current = null;
            }
          }
        }
      }, (err) => {
        console.warn('Firestore calls listener error (falling back to WebSocket):', err);
      });

      return () => {
        unsubscribe();
      };
    } catch (e) {
      console.warn('Could not set up Firestore call listener:', e);
    }
  }, [user?.id]);

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
    socketRef.current = ws;

    ws.onopen = () => {
      retry = 0;
      setIsConnected(true);
      ws.send(JSON.stringify({ type: 'auth', userId: user.id }));
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
      try {
        const data = JSON.parse(event.data);

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

          case 'user_typing':
            setTypingUsers(prev => ({
              ...prev,
              [data.senderId]: data.isTyping
            }));
            break;

          case 'new_message':
          case 'message_sent':
            messageListeners.current.forEach(cb => cb(data.message));
            break;

          case 'message_updated':
            messageUpdatedListeners.current.forEach(cb => cb(data.message));
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

          // WebRTC Call Signaling (Supports call:initiate, call:offer, call:answer, call:ice-candidate, call:end, call:rejected)
          case 'call:initiate':
          case 'incoming_call': {
            if (!incomingCall && !activeCallRef.current) {
              setIncomingCall({
                id: data.id || 'ws_' + Date.now(),
                callerId: data.callerId,
                callerName: data.callerName || 'User',
                callerAvatar: data.callerAvatar || '',
                callType: data.callType || 'video',
                offer: data.offer
              });
              if (!stopRingtoneRef.current) {
                stopRingtoneRef.current = startRingtone();
              }
            }
            break;
          }

          case 'call:offer':
          case 'call_offer': {
            if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed' && data.offer) {
              try {
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
                // Flush pending candidates
                while (pendingCandidatesRef.current.length > 0) {
                  const cand = pendingCandidatesRef.current.shift();
                  if (cand) await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
              } catch (e) {
                console.warn('Could not set remote description from offer:', e);
              }
            }
            break;
          }

          case 'call:answer':
          case 'call_answered': {
            if (stopRingtoneRef.current) {
              stopRingtoneRef.current();
              stopRingtoneRef.current = null;
            }
            if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed' && data.answer) {
              try {
                if (peerConnectionRef.current.signalingState === 'have-local-offer') {
                  await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
                  // Flush pending candidates
                  while (pendingCandidatesRef.current.length > 0) {
                    const cand = pendingCandidatesRef.current.shift();
                    if (cand) await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                  }
                }
                setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
              } catch (e) {
                console.warn('Could not set remote description from answer:', e);
              }
            }
            break;
          }

          case 'call:user_offline':
          case 'call_user_offline': {
            // Keep ringing (they may still receive it through the call document), but say so.
            setCallNotice('This person looks offline right now. We will keep ringing in case they open Echat.');
            break;
          }

          case 'call:rejected':
          case 'call_rejected':
          case 'call:end':
          case 'call_ended':
          case 'call_failed': {
            if ((data.type === 'call:rejected' || data.type === 'call_rejected') && data.reason === 'not_allowed') {
              setCallNotice('This person does not accept calls from you.');
            } else if (data.type === 'call:rejected' || data.type === 'call_rejected') {
              setCallNotice('Call declined.');
            }
            cleanUpCallMedia();
            break;
          }

          case 'call:ice-candidate':
          case 'call:ice_candidate':
          case 'ice_candidate': {
            if (data.candidate) {
              await addOrQueueCandidate(data.candidate);
            }
            break;
          }

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

  // Start outgoing call
  const startCall = async (targetUserId: string, targetName: string, targetAvatar: string, callType: 'audio' | 'video') => {
    if (!user) return;
    if (isSettingUpCallRef.current) return;

    isSettingUpCallRef.current = true;
    cleanUpCallMedia();

    // 1. Show Calling popup immediately
    const newCall: ActiveCall = {
      partnerId: targetUserId,
      partnerName: targetName,
      partnerAvatar: targetAvatar,
      callType,
      isCaller: true,
      status: 'calling'
    };
    setActiveCall(newCall);
    activeCallRef.current = newCall;

    // Start outgoing ringtone
    stopRingtoneRef.current = startRingtone();

    try {
      // 2. Ask for camera/mic permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } : false
      });

      if (!activeCallRef.current || activeCallRef.current.status === 'ended') {
        stream.getTracks().forEach(t => t.stop());
        isSettingUpCallRef.current = false;
        return;
      }

      localStreamRef.current = stream;

      // 3. Create WebRTC PeerConnection with STUN server stun:stun.l.google.com:19302
      const pc = new RTCPeerConnection(await getCallIceConfig());
      peerConnectionRef.current = pc;

      // Attach the ICE handler NOW, before any description is set. Candidates are produced as soon as
      // setLocalDescription runs; attaching later (after a network write) silently dropped them and the
      // other side could not connect back, which caused one-way / no audio.
      const earlyCandidates: RTCIceCandidateInit[] = [];
      let iceDocId = '';
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const cand = event.candidate.toJSON();
        earlyCandidates.push(cand);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: 'call:ice-candidate',
            rawType: 'ice_candidate',
            targetUserId,
            candidate: cand
          }));
        }
        if (iceDocId) {
          updateDoc(doc(firestore, 'calls', iceDocId), { callerCandidates: arrayUnion(cand) }).catch(() => {});
        }
      };

      stream.getTracks().forEach(track => {
        try {
          track.enabled = true;
          if (pc.signalingState !== 'closed') {
            pc.addTrack(track, stream);
          }
        } catch (e) {
          console.warn('Error adding track:', e);
        }
      });

      pc.ontrack = (event) => {
        const streamObj = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
        streamObj.getAudioTracks().forEach(t => { t.enabled = true; });
        streamObj.getVideoTracks().forEach(t => { t.enabled = true; });
        setRemoteStream(new MediaStream(streamObj.getTracks()));
        event.track.onunmute = () => {
          setRemoteStream(new MediaStream(streamObj.getTracks()));
        };
      };

      // 4. Create SDP Offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 5. Create Call Document in Firestore 'calls' collection
      let callDocId = '';
      try {
        const callDoc = await addDoc(collection(firestore, 'calls'), {
          caller: {
            id: user.id,
            name: user.name,
            avatar: user.avatar
          },
          receiver: {
            id: targetUserId,
            name: targetName,
            avatar: targetAvatar
          },
          callerId: user.id,
          callerName: user.name,
          callerAvatar: user.avatar,
          receiverId: targetUserId,
          receiverName: targetName,
          receiverAvatar: targetAvatar,
          type: callType,
          callType,
          status: 'ringing',
          offer: {
            type: offer.type,
            sdp: offer.sdp
          },
          answer: null,
          callerCandidates: [],
          receiverCandidates: [],
          createdAt: Date.now()
        });

        callDocId = callDoc.id;
        currentCallDocIdRef.current = callDocId;
        setActiveCall(prev => prev ? { ...prev, id: callDocId } : null);

        // Publish the candidates gathered while the call document was being created
        iceDocId = callDocId;
        if (earlyCandidates.length > 0) {
          updateDoc(doc(firestore, 'calls', callDocId), { callerCandidates: arrayUnion(...earlyCandidates) }).catch(() => {});
        }

        // Listen for Receiver's Answer in Firestore call document
        const unsubCall = onSnapshot(doc(firestore, 'calls', callDocId), async (snap) => {
          if (!snap.exists()) return;
          const data = snap.data();

          if (data.status === 'connected' && data.answer) {
            if (stopRingtoneRef.current) {
              stopRingtoneRef.current();
              stopRingtoneRef.current = null;
            }
            if (pc.signalingState === 'have-local-offer') {
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                while (pendingCandidatesRef.current.length > 0) {
                  const cand = pendingCandidatesRef.current.shift();
                  if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
                }
              } catch (e) {
                console.warn('Failed to set remote description on caller:', e);
              }
            }
            setActiveCall(prev => prev ? { ...prev, status: 'connected' } : null);
          }

          // Add receiver ICE candidates
          if (data.receiverCandidates && Array.isArray(data.receiverCandidates)) {
            data.receiverCandidates.forEach(cand => {
              const str = JSON.stringify(cand);
              if (!processedCandidatesRef.current.has(str)) {
                processedCandidatesRef.current.add(str);
                addOrQueueCandidate(cand);
              }
            });
          }

          if (data.status === 'declined' || data.status === 'ended') {
            cleanUpCallMedia();
          }
        });

        callUnsubscribeRef.current = unsubCall;
      } catch (firestoreErr) {
        console.warn('Could not create call doc in Firestore (using WebSocket backup):', firestoreErr);
      }

      // Also trigger over WebSocket backup channel immediately
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'call:initiate',
          rawType: 'call_initiate',
          callerId: user.id,
          callerName: user.name,
          callerAvatar: user.avatar,
          receiverId: targetUserId,
          callType,
          offer
        }));
      }
    } catch (err) {
      console.error('Failed to initiate call:', err);
      setCallNotice(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Allow microphone and camera access to start this call.' : 'Could not start the call. Check your microphone, camera, and network, then try again.');
      cleanUpCallMedia();
    } finally {
      isSettingUpCallRef.current = false;
    }
  };

  // Accept incoming call
  const acceptCall = async () => {
    if (!incomingCall || !user) return;

    if (stopRingtoneRef.current) {
      stopRingtoneRef.current();
      stopRingtoneRef.current = null;
    }

    const callDocId = incomingCall.id;
    const callerId = incomingCall.callerId;
    const callType = incomingCall.callType;
    const offer = incomingCall.offer;

    const acceptedCall: ActiveCall = {
      id: callDocId,
      partnerId: callerId,
      partnerName: incomingCall.callerName,
      partnerAvatar: incomingCall.callerAvatar,
      callType,
      isCaller: false,
      status: 'connected'
    };
    setActiveCall(acceptedCall);
    activeCallRef.current = acceptedCall;
    currentCallDocIdRef.current = callDocId;
    setIncomingCall(null);

    try {
      // 1. Ask for microphone/camera permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: callType === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } } : false
      });

      if (!activeCallRef.current || activeCallRef.current.status === 'ended') {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      localStreamRef.current = stream;

      // 2. Setup RTCPeerConnection with STUN server stun:stun.l.google.com:19302
      const pc = new RTCPeerConnection(await getCallIceConfig());
      peerConnectionRef.current = pc;

      // Send our candidates from the very first one (see startCall): the caller needs them to reach us.
      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const cand = event.candidate.toJSON();
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({
            type: 'call:ice-candidate',
            rawType: 'ice_candidate',
            targetUserId: callerId,
            candidate: cand
          }));
        }
        if (callDocId && !callDocId.startsWith('ws_')) {
          updateDoc(doc(firestore, 'calls', callDocId), { receiverCandidates: arrayUnion(cand) }).catch(() => {});
        }
      };

      stream.getTracks().forEach(track => {
        try {
          track.enabled = true;
          if (pc.signalingState !== 'closed') {
            pc.addTrack(track, stream);
          }
        } catch (e) {
          console.warn('Error adding track on receiver:', e);
        }
      });

      pc.ontrack = (event) => {
        const streamObj = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track]);
        streamObj.getAudioTracks().forEach(t => { t.enabled = true; });
        streamObj.getVideoTracks().forEach(t => { t.enabled = true; });
        setRemoteStream(new MediaStream(streamObj.getTracks()));
        event.track.onunmute = () => {
          setRemoteStream(new MediaStream(streamObj.getTracks()));
        };
      };

      // 3. Set Remote Description (Caller's Offer)
      if (offer && pc.signalingState !== 'closed') {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        while (pendingCandidatesRef.current.length > 0) {
          const cand = pendingCandidatesRef.current.shift();
          if (cand) await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
      }

      // 4. Create Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 5. Update Call Document in Firestore 'calls' collection
      if (callDocId && !callDocId.startsWith('ws_')) {
        try {
          await updateDoc(doc(firestore, 'calls', callDocId), {
            status: 'connected',
            answer: {
              type: answer.type,
              sdp: answer.sdp
            }
          });

          // Listen for caller candidates & hang-up
          const unsubCall = onSnapshot(doc(firestore, 'calls', callDocId), (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data.callerCandidates && Array.isArray(data.callerCandidates)) {
              data.callerCandidates.forEach(cand => {
                const str = JSON.stringify(cand);
                if (!processedCandidatesRef.current.has(str)) {
                  processedCandidatesRef.current.add(str);
                  addOrQueueCandidate(cand);
                }
              });
            }
            if (data.status === 'ended' || data.status === 'declined') {
              cleanUpCallMedia();
            }
          });
          callUnsubscribeRef.current = unsubCall;
        } catch (e) {
          console.warn('Could not update call doc on accept:', e);
        }
      }

      // Also notify over WebSocket backup immediately
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'call:answer',
          rawType: 'call_answer',
          callerId,
          receiverId: user.id,
          answer: {
            type: answer.type,
            sdp: answer.sdp
          }
        }));
      }
    } catch (err) {
      console.error('Failed to answer call:', err);
      setCallNotice(err instanceof DOMException && err.name === 'NotAllowedError' ? 'Allow microphone and camera access to accept this call.' : 'Could not connect the call. Check your devices and network, then try again.');
      cleanUpCallMedia();
    }
  };

  const rejectCall = async () => {
    if (stopRingtoneRef.current) {
      stopRingtoneRef.current();
      stopRingtoneRef.current = null;
    }

    if (incomingCall) {
      const callDocId = incomingCall.id;
      if (callDocId && !callDocId.startsWith('ws_')) {
        try {
          await updateDoc(doc(firestore, 'calls', callDocId), { status: 'declined' });
        } catch {}
      }

      if (socketRef.current && user && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'call:rejected',
          rawType: 'call_reject',
          callerId: incomingCall.callerId,
          receiverId: user.id,
          reason: 'declined'
        }));
      }
    }

    cleanUpCallMedia();
  };

  const endCall = async () => {
    if (stopRingtoneRef.current) {
      stopRingtoneRef.current();
      stopRingtoneRef.current = null;
    }

    const docId = currentCallDocIdRef.current;
    if (docId && !docId.startsWith('ws_')) {
      try {
        await updateDoc(doc(firestore, 'calls', docId), { status: 'ended' });
      } catch {}
    }

    if (activeCall && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({
        type: 'call:end',
        rawType: 'call_end',
        targetUserId: activeCall.partnerId
      }));
    }

    cleanUpCallMedia();
  };

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

  const onMessageUpdated = (cb: (msg: Message) => void) => {
    messageUpdatedListeners.current.add(cb);
    return () => { messageUpdatedListeners.current.delete(cb); };
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
        socket: mockSocket,
        onNewMessage,
        onMessageUpdated,
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
        onLiveSignal
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

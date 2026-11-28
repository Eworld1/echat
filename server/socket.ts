import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from './db.js';

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
}

export class SocketManager {
  private wss: WebSocketServer;
  private userSockets: Map<string, Set<WebSocket>> = new Map();
  private liveHosts = new Map<string, string>();
  /**
   * Call audio relay (fallback when WebRTC can't connect, e.g. a carrier blocks TURN): each socket can
   * be in one call relay. Audio frames go only to the partner's relay socket, and only when BOTH sides
   * joined the same callId naming each other — a third person can't listen in by guessing an id.
   */
  private relayOf = new Map<WebSocket, { callId: string; userId: string; partnerId: string }>();
  private relayFramesForwarded = 0;

  // Calls that are ringing and have not been answered, declined or cancelled yet.
  private pendingCalls = new Map<string, { callerId: string; receiverId: string; callType: 'audio' | 'video'; timer: ReturnType<typeof setTimeout> }>();
  private static readonly RING_TIMEOUT_MS = 45_000;

  /**
   * Checks that the Firebase ID token sent with "auth" belongs to this user. Without it anyone could
   * claim another person's id and receive their private messages live.
   */
  public authVerifier?: (userId: string, idToken: string) => Promise<boolean>;

  private userIdOf(ws: WebSocket): string | undefined {
    for (const [uid, set] of this.userSockets) if (set.has(ws)) return uid;
    return undefined;
  }

  private clearPending(callerId: string, receiverId: string): boolean {
    const key = `${callerId}>${receiverId}`;
    const p = this.pendingCalls.get(key);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pendingCalls.delete(key);
    return true;
  }

  /** Nobody picked up: tell the receiver they missed a call (notification + live push). */
  private recordMissedCall(callerId: string, receiverId: string): void {
    const key = `${callerId}>${receiverId}`;
    const p = this.pendingCalls.get(key);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingCalls.delete(key);
    const caller = db.getUserById(callerId);
    if (!caller || !db.getUserById(receiverId)) return;
    const notif = db.addNotification({
      userId: receiverId,
      actorId: callerId,
      type: 'missed_call',
      message: `Missed ${p.callType} call from ${caller.name}`,
      targetId: callerId,
      callType: p.callType,
      read: false
    });
    this.sendToUser(receiverId, {
      type: 'new_notification',
      notification: { ...notif, actor: db.sanitizeUser(caller) }
    });
  }

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupListeners();
  }

  public getActiveCount(): number {
    return this.wss.clients.size;
  }

  public setLiveHost(streamId: string, hostId: string): void {
    this.liveHosts.set(streamId, hostId);
  }

  public clearLiveHost(streamId: string): void {
    this.liveHosts.delete(streamId);
  }

  private setupListeners() {
    this.wss.on('connection', (ws: WebSocket) => {
      let currentUserId: string | undefined;

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) { this.forwardRelayFrame(ws, data); return; }
        try {
          const payload = JSON.parse(data.toString());
          this.handleMessage(ws, payload, (userId) => {
            currentUserId = userId;
          });
        } catch (e) {
          console.error('Error handling WebSocket message:', e);
        }
      });

      ws.on('close', () => {
        this.leaveRelay(ws);
        if (currentUserId) {
          const set = this.userSockets.get(currentUserId);
          if (set) {
            set.delete(ws);
            if (set.size === 0) {
              this.userSockets.delete(currentUserId);
              db.setUserOnline(currentUserId, false);
              this.broadcast({
                type: 'user_status',
                userId: currentUserId,
                isOnline: false,
                lastSeen: Date.now()
              });
            }
          }
        }
      });

      // Send initial connection ack
      ws.send(JSON.stringify({ type: 'connected', timestamp: Date.now() }));
    });
  }

  private relayPartnerSocket(ws: WebSocket): WebSocket | null {
    const me = this.relayOf.get(ws);
    if (!me) return null;
    for (const socket of this.userSockets.get(me.partnerId) || []) {
      const other = this.relayOf.get(socket);
      if (other && other.callId === me.callId && other.partnerId === me.userId && socket.readyState === WebSocket.OPEN) return socket;
    }
    return null;
  }

  private forwardRelayFrame(ws: WebSocket, data: Buffer) {
    if (data.length < 2 || data.length > 8192) return;
    // 0x02 = echo test: bounce it straight back (lets a phone check the binary path to the server).
    if (data[0] === 0x02) { if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: true }); return; }
    const partner = this.relayPartnerSocket(ws);
    if (!partner) return;
    // Drop audio instead of queueing when the partner's connection is backed up (keeps latency low).
    if (partner.bufferedAmount > 64 * 1024) return;
    partner.send(data, { binary: true });
    this.relayFramesForwarded += 1;
  }

  private leaveRelay(ws: WebSocket) {
    const me = this.relayOf.get(ws);
    if (!me) return;
    const partner = this.relayPartnerSocket(ws);
    this.relayOf.delete(ws);
    if (partner) partner.send(JSON.stringify({ type: 'call_relay_peer', callId: me.callId, present: false }));
  }

  public relayStats() {
    return { relaySockets: this.relayOf.size, relayFramesForwarded: this.relayFramesForwarded };
  }

  /** Only called after the "auth" message was verified. */
  private registerSocket(ws: WebSocket, userId: string, setCurrentUser: (uid: string) => void) {
    if (this.userIdOf(ws) === userId) return;
    setCurrentUser(userId);
    if (!this.userSockets.has(userId)) this.userSockets.set(userId, new Set());
    this.userSockets.get(userId)!.add(ws);
    db.setUserOnline(userId, true);
    this.broadcast({ type: 'user_status', userId, isOnline: true, lastSeen: Date.now() });
    // Send current online user IDs
    ws.send(JSON.stringify({ type: 'online_users_list', userIds: Array.from(this.userSockets.keys()) }));
  }

  private handleMessage(ws: WebSocket, payload: any, setCurrentUser: (uid: string) => void) {
    switch (payload.type) {
      case 'auth': {
        const { userId, idToken } = payload;
        if (!userId || typeof userId !== 'string') return;
        if (!this.authVerifier) { this.registerSocket(ws, userId, setCurrentUser); break; }
        const fail = () => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'auth_failed' })); };
        void this.authVerifier(userId, typeof idToken === 'string' ? idToken : '')
          .then(ok => { if (!ok) fail(); else if (ws.readyState === WebSocket.OPEN) this.registerSocket(ws, userId, setCurrentUser); })
          .catch(fail);
        break;
      }

      case 'call_relay_join': {
        const userId = this.userIdOf(ws);
        const callId = typeof payload.callId === 'string' ? payload.callId.slice(0, 128) : '';
        const partnerId = typeof payload.partnerId === 'string' ? payload.partnerId.slice(0, 128) : '';
        if (!userId) { ws.send(JSON.stringify({ type: 'call_relay_error', callId, error: 'socket not signed in (auth not verified)' })); return; }
        if (!callId || !partnerId || partnerId === userId) { ws.send(JSON.stringify({ type: 'call_relay_error', callId, error: 'bad relay join' })); return; }
        this.relayOf.set(ws, { callId, userId, partnerId });
        const partner = this.relayPartnerSocket(ws);
        ws.send(JSON.stringify({ type: 'call_relay_joined', callId, partnerPresent: Boolean(partner) }));
        if (partner) partner.send(JSON.stringify({ type: 'call_relay_peer', callId, present: true }));
        break;
      }

      case 'call_relay_leave': {
        this.leaveRelay(ws);
        break;
      }

      case 'call_relay_ping': {
        ws.send(JSON.stringify({ type: 'call_relay_pong', t: Number(payload.t) || 0, signedIn: Boolean(this.userIdOf(ws)) }));
        break;
      }

      case 'chat_activity': {
        // "typing…" / "recording a voice message…": the sender is whoever this verified socket belongs to.
        const fromUserId = this.userIdOf(ws);
        const receivers: unknown[] = Array.isArray(payload.receiverIds) ? payload.receiverIds.slice(0, 50) : [];
        if (!fromUserId || typeof payload.chatId !== 'string' || payload.chatId.length > 200) return;
        const state = payload.state === 'typing' || payload.state === 'recording' ? payload.state : null;
        const name = String(payload.name || '').slice(0, 60);
        for (const receiverId of receivers) {
          if (typeof receiverId === 'string' && receiverId !== fromUserId) this.sendToUser(receiverId, { type: 'chat_activity', chatId: payload.chatId, fromUserId, name, state });
        }
        break;
      }

      case 'typing_start': {
        const { senderId, receiverId } = payload;
        this.sendToUser(receiverId, {
          type: 'user_typing',
          senderId,
          isTyping: true
        });
        break;
      }

      case 'typing_stop': {
        const { senderId, receiverId } = payload;
        this.sendToUser(receiverId, {
          type: 'user_typing',
          senderId,
          isTyping: false
        });
        break;
      }

      case 'message_seen': {
        const { viewerId, senderId } = payload;
        db.markConversationSeen(viewerId, senderId);
        this.sendToUser(senderId, {
          type: 'messages_seen',
          viewerId
        });
        break;
      }

      case 'live:signal': {
        const fromUserId = this.userIdOf(ws);
        const { targetUserId, streamId, signal } = payload;
        const hostId = typeof streamId === 'string' ? this.liveHosts.get(streamId) : undefined;
        if (!fromUserId || !hostId || !signal || typeof signal !== 'object') break;
        if (fromUserId !== hostId && targetUserId !== hostId) break;
        const recipientId = fromUserId === hostId ? targetUserId : hostId;
        if (typeof recipientId !== 'string' || recipientId === fromUserId) break;
        this.sendToUser(recipientId, { type: 'live:signal', streamId, fromUserId, signal });
        break;
      }

      case 'live-caption': {
        const fromUserId = this.userIdOf(ws);
        const { streamId, text } = payload;
        if (!fromUserId || typeof streamId !== 'string' || this.liveHosts.get(streamId) !== fromUserId || typeof text !== 'string') break;
        this.broadcast({ type: 'live_caption', streamId, text: text.slice(0, 300), createdAt: Date.now() });
        break;
      }

      case 'call-switch-type': {
        const fromUserId = this.userIdOf(ws);
        const targetUserId = payload.targetUserId;
        const callType = payload.callType === 'video' ? 'video' : 'audio';
        if (!fromUserId || typeof targetUserId !== 'string' || targetUserId === fromUserId) break;
        this.sendToUser(targetUserId, { type: 'call-switch-type', fromUserId, callType });
        break;
      }

      // WebRTC Call Signaling (Supports call:initiate, call:offer, call:answer, call:ice-candidate, call:end, call:rejected)
      case 'call:initiate':
      case 'call_initiate': {
        const { callerId, receiverId, callType, offer } = payload;
        const receiverSockets = this.userSockets.get(receiverId);

        const caller = db.getUserById(callerId);

        // Respect the receiver's privacy: "Who can call me" (everyone / friends / nobody) and blocking.
        const target = db.getUserById(receiverId);
        const policy = target?.privacySettings?.whoCanCallMe ?? 'everyone';
        const isFriend = Boolean(target?.friends?.includes(callerId));
        if (!target || !caller || db.isBlockedBetween(callerId, receiverId) || policy === 'nobody' || (policy === 'friends' && !isFriend)) {
          ws.send(JSON.stringify({ type: 'call:rejected', rawType: 'call_rejected', receiverId, reason: 'not_allowed' }));
          break;
        }

        if (callerId && receiverId) {
          this.clearPending(callerId, receiverId);
          const type: 'audio' | 'video' = callType === 'audio' ? 'audio' : 'video';
          const timer = setTimeout(() => this.recordMissedCall(callerId, receiverId), SocketManager.RING_TIMEOUT_MS);
          (timer as { unref?: () => void }).unref?.();
          this.pendingCalls.set(`${callerId}>${receiverId}`, { callerId, receiverId, callType: type, timer });
        }
        const signalData = {
          type: 'call:initiate',
          rawType: 'incoming_call',
          callerId,
          callerName: caller?.name || 'Unknown',
          callerAvatar: caller?.avatar || '',
          callType: callType || 'video',
          offer,
          createdAt: Date.now()
        };

        if (!receiverSockets || receiverSockets.size === 0) {
          // Even if socket is not active, also emit so other connections or fallback receive it
          ws.send(JSON.stringify({
            type: 'call:user_offline',
            rawType: 'call_user_offline',
            receiverId,
            reason: 'User is offline'
          }));
        } else {
          this.sendToUser(receiverId, signalData);
        }
        break;
      }

      case 'call:offer':
      case 'call_offer': {
        const { callerId, targetUserId, receiverId, offer, callType } = payload;
        const toUser = targetUserId || receiverId;
        if (toUser) {
          this.sendToUser(toUser, {
            type: 'call:offer',
            rawType: 'call_offer',
            callerId,
            offer,
            callType
          });
        }
        break;
      }

      case 'call:answer':
      case 'call_answer': {
        const { callerId, targetUserId, receiverId, answer } = payload;
        const toUser = callerId || targetUserId;
        const answerer = receiverId || this.userIdOf(ws);
        if (toUser && answerer) this.clearPending(toUser, answerer);
        if (toUser) {
          this.sendToUser(toUser, {
            type: 'call:answer',
            rawType: 'call_answered',
            receiverId: receiverId || callerId,
            answer
          });
        }
        break;
      }

      case 'call:rejected':
      case 'call:reject':
      case 'call_reject': {
        const { callerId, targetUserId, receiverId, reason } = payload;
        const toUser = callerId || targetUserId;
        const decliner = receiverId || this.userIdOf(ws);
        if (toUser && decliner) this.clearPending(toUser, decliner);
        if (toUser) {
          this.sendToUser(toUser, {
            type: 'call:rejected',
            rawType: 'call_rejected',
            receiverId,
            reason: reason || 'declined'
          });
        }
        break;
      }

      case 'call:end':
      case 'call_end': {
        const { targetUserId, receiverId, callerId } = payload;
        const toUser = targetUserId || receiverId || callerId;
        const sender = this.userIdOf(ws);
        if (toUser && sender) {
          if (this.pendingCalls.has(`${sender}>${toUser}`)) this.recordMissedCall(sender, toUser); // caller cancelled
          else this.clearPending(toUser, sender); // receiver ended before answering
        }
        if (toUser) {
          this.sendToUser(toUser, {
            type: 'call:end',
            rawType: 'call_ended'
          });
        }
        break;
      }

      case 'call:ice-candidate':
      case 'call:ice_candidate':
      case 'ice_candidate': {
        const { targetUserId, receiverId, candidate } = payload;
        const toUser = targetUserId || receiverId;
        const from = this.userIdOf(ws);
        if (toUser && from) this.clearPending(toUser, from); // callee is connecting => answered, not missed
        if (toUser) {
          this.sendToUser(toUser, {
            type: 'call:ice-candidate',
            rawType: 'ice_candidate',
            candidate
          });
        }
        break;
      }

      default:
        break;
    }
  }

  public sendToUser(userId: string, data: any) {
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    const str = JSON.stringify(data);
    sockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(str);
      }
    });
  }

  public broadcast(data: any) {
    const str = JSON.stringify(data);
    this.wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(str);
      }
    });
  }
}

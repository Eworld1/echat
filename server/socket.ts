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

  constructor(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupListeners();
  }

  public getActiveCount(): number {
    return this.wss.clients.size;
  }

  private setupListeners() {
    this.wss.on('connection', (ws: WebSocket) => {
      let currentUserId: string | undefined;

      ws.on('message', (data: string) => {
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

  private handleMessage(ws: WebSocket, payload: any, setCurrentUser: (uid: string) => void) {
    switch (payload.type) {
      case 'auth': {
        const { userId } = payload;
        if (!userId) return;
        setCurrentUser(userId);

        if (!this.userSockets.has(userId)) {
          this.userSockets.set(userId, new Set());
        }
        this.userSockets.get(userId)!.add(ws);

        db.setUserOnline(userId, true);
        this.broadcast({
          type: 'user_status',
          userId,
          isOnline: true,
          lastSeen: Date.now()
        });

        // Send current online user IDs
        const onlineUsers = Array.from(this.userSockets.keys());
        ws.send(JSON.stringify({
          type: 'online_users_list',
          userIds: onlineUsers
        }));
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

      // WebRTC Call Signaling (Supports call:initiate, call:offer, call:answer, call:ice-candidate, call:end, call:rejected)
      case 'call:initiate':
      case 'call_initiate': {
        const { callerId, receiverId, callType, offer } = payload;
        const receiverSockets = this.userSockets.get(receiverId);

        const caller = db.getUserById(callerId);
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

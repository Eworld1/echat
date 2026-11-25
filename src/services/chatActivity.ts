import { useCallback, useEffect, useRef, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

/**
 * WhatsApp-style "typing…" / "recording a voice message…" for private and group chats.
 *
 * Firestore: chatActivity/{chatId}/members/{uid} = { state: 'typing' | 'recording', name, userId, at }
 *   - written by me while I type / record (refreshed every 3 s), deleted when I stop or send
 *   - everyone else in the chat listens with onSnapshot (real time, no refresh)
 *   - anything older than 5 s is ignored, so a closed tab never leaves "typing…" stuck
 * The same state also goes over the socket, so it shows instantly even before the Firestore rule
 * for chatActivity is published.
 */

export type ChatActivityState = 'typing' | 'recording';
export interface ChatActivity { userId: string; name: string; state: ChatActivityState; at: number }

const STALE_MS = 5000;        // auto-clear when no update for 5 s
const HEARTBEAT_MS = 3000;    // refresh while still typing / recording
const TYPING_IDLE_MS = 2000;  // stopped typing for 2 s -> clear

/** Same chat id for both people: dm_<smaller id>_<bigger id>. Groups: group_<groupId>. */
export const dmChatId = (a: string, b: string) => `dm_${[a, b].sort().join('_')}`;
export const groupChatId = (groupId: string) => `group_${groupId}`;

type SocketSender = (data: Record<string, unknown>) => void;
let socketSend: SocketSender | null = null;
/** SocketContext registers its sender so activity also goes over the live socket. */
export function registerActivitySocket(send: SocketSender | null) { socketSend = send; }

/** Everyone else's activity in this chat (my own is never shown to me). */
export function useChatActivity(chatId: string | null, myUserId: string | undefined): ChatActivity[] {
  const [fromFirestore, setFromFirestore] = useState<ChatActivity[]>([]);
  const [fromSocket, setFromSocket] = useState<Record<string, ChatActivity>>({});
  const [, setTick] = useState(0);

  useEffect(() => {
    setFromFirestore([]); setFromSocket({});
    if (!chatId) return;
    const stop = onSnapshot(collection(db, 'chatActivity', chatId, 'members'), snapshot => {
      setFromFirestore(snapshot.docs.map(item => item.data() as ChatActivity).filter(item => item && (item.state === 'typing' || item.state === 'recording')));
    }, () => setFromFirestore([])); // rule not published yet: the socket still works
    const onSocket = (event: Event) => {
      const detail = (event as CustomEvent<{ chatId: string; userId: string; name: string; state: ChatActivityState | null }>).detail;
      if (!detail || detail.chatId !== chatId) return;
      setFromSocket(current => {
        const next = { ...current };
        if (detail.state) next[detail.userId] = { userId: detail.userId, name: detail.name, state: detail.state, at: Date.now() };
        else delete next[detail.userId];
        return next;
      });
    };
    window.addEventListener('echat:chat-activity', onSocket);
    return () => { stop(); window.removeEventListener('echat:chat-activity', onSocket); };
  }, [chatId]);

  // Re-check once a second so stale entries disappear (5-second auto-clear).
  const merged = new Map<string, ChatActivity>();
  for (const item of [...fromFirestore, ...Object.values(fromSocket)]) {
    const existing = merged.get(item.userId);
    if (!existing || item.at > existing.at) merged.set(item.userId, item);
  }
  const myFirebaseUid = auth.currentUser?.uid;
  const active = [...merged.values()].filter(item => item.userId !== myUserId && item.userId !== myFirebaseUid && Date.now() - item.at < STALE_MS);
  useEffect(() => {
    if (!active.length) return;
    const timer = window.setInterval(() => setTick(t => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active.length]);
  return active;
}

/**
 * My side: call typed() on every keystroke, recording(true/false) around voice notes, and sent()
 * after sending. receiverIds = the other people in the chat (for the socket).
 */
export function useActivitySender(chatId: string | null, me: { id: string; name: string } | null | undefined, receiverIds: string[]) {
  const state = useRef<ChatActivityState | null>(null);
  const lastWrite = useRef(0);
  const idleTimer = useRef<number | undefined>(undefined);
  const heartbeat = useRef<number | undefined>(undefined);
  const receiversKey = receiverIds.join(',');
  const meRef = useRef(me);
  meRef.current = me;

  const publish = useCallback((next: ChatActivityState | null, force = false) => {
    const me = meRef.current;
    if (!chatId || !me) return;
    const changed = state.current !== next;
    if (!changed && !force && (next === null || Date.now() - lastWrite.current < HEARTBEAT_MS)) return;
    state.current = next;
    lastWrite.current = Date.now();
    const uid = auth.currentUser?.uid;
    if (uid) {
      const ref = doc(db, 'chatActivity', chatId, 'members', uid);
      void (next ? setDoc(ref, { state: next, name: me.name.slice(0, 60), userId: me.id, at: Date.now() }) : deleteDoc(ref)).catch(() => {});
    }
    if (changed || next) socketSend?.({ type: 'chat_activity', chatId, receiverIds: receiversKey ? receiversKey.split(',') : [], state: next, name: me.name.slice(0, 60) });
  }, [chatId, receiversKey]);

  const clear = useCallback(() => {
    window.clearTimeout(idleTimer.current);
    window.clearInterval(heartbeat.current);
    heartbeat.current = undefined;
    if (state.current) publish(null);
  }, [publish]);

  const typed = useCallback((text: string) => {
    if (state.current === 'recording') return;
    if (!text.trim()) { clear(); return; }
    publish('typing');
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => { if (state.current === 'typing') publish(null); }, TYPING_IDLE_MS);
  }, [publish, clear]);

  const recording = useCallback((on: boolean) => {
    window.clearTimeout(idleTimer.current);
    window.clearInterval(heartbeat.current);
    if (!on) { publish(null); return; }
    publish('recording');
    heartbeat.current = window.setInterval(() => publish('recording', true), HEARTBEAT_MS);
  }, [publish]);

  // Leaving the chat / switching chats / closing the tab: clear my status.
  useEffect(() => {
    const onHide = () => { if (document.hidden) clear(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', clear);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', clear); clear(); };
  }, [clear]);

  return { typed, recording, sent: clear };
}

/** "Moses is typing…" / "Moses is recording a voice message 🎤…" / "Aminata and Moses are typing…" */
export function describeActivity(list: ChatActivity[], isGroup: boolean): { text: string; recording: boolean } | null {
  if (!list.length) return null;
  const recorders = list.filter(item => item.state === 'recording');
  const group = recorders.length ? recorders : list;
  const first = (name: string) => (name || 'Someone').trim().split(/\s+/)[0];
  const names = group.map(item => first(item.name));
  const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} others`;
  const plural = names.length > 1;
  if (recorders.length) return { text: `${who} ${plural ? 'are' : 'is'} recording a voice message 🎤`, recording: true };
  return { text: isGroup || plural ? `${who} ${plural ? 'are' : 'is'} typing` : `${who} is typing`, recording: false };
}

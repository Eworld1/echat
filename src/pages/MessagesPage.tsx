import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, type DirectConversation, type DirectMessage } from '../services/api';
import type { User } from '../types';

interface MessagesPageProps {
  initialUserId: string | null;
  onViewProfile: (userId: string) => void;
}

const timeLabel = (timestamp: number) => new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const MessagesPage: React.FC<MessagesPageProps> = ({ initialUserId, onViewProfile }) => {
  const { user: currentUser } = useAuth();
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialUserId);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const result = await api.getDmConversations();
      setConversations(result);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load messages');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const timer = window.setInterval(() => void loadConversations(), 3000);
    return () => window.clearInterval(timer);
  }, [loadConversations]);

  useEffect(() => {
    setSelectedUserId(initialUserId);
  }, [initialUserId]);

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUser(null);
      setMessages([]);
      return;
    }
    let alive = true;
    let firstLoad = true;
    const known = conversations.find(item => item.user.id === selectedUserId)?.user;
    if (known) setSelectedUser(known);
    else if (selectedUserId !== currentUser?.id) {
      void api.getUserProfile(selectedUserId).then(profile => { if (alive) setSelectedUser(profile.user); })
        .catch(() => { if (alive) setError('Could not load this person’s profile'); });
    }
    const refresh = async () => {
      if (firstLoad) setLoadingChat(true);
      try {
        const rows = await api.getDmConversation(selectedUserId);
        if (!alive) return;
        setMessages(rows);
        await api.markDmRead(selectedUserId).catch(() => undefined);
        void loadConversations();
        setError('');
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load this conversation');
      } finally {
        if (alive && firstLoad) setLoadingChat(false);
        firstLoad = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => { alive = false; window.clearInterval(timer); };
  // Conversations are polled independently; choosing a row sets selectedUser directly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, currentUser?.id, loadConversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const sortedMessages = useMemo(() => messages.slice().sort((a, b) => a.createdAt - b.createdAt), [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!selectedUserId || !text || sending) return;
    setSending(true);
    setError('');
    try {
      const sent = await api.sendDm(selectedUserId, text);
      setMessages(previous => [...previous, sent]);
      setDraft('');
      void loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Message could not be sent');
    } finally {
      setSending(false);
    }
  };

  const selectConversation = (item: DirectConversation) => {
    setSelectedUserId(item.user.id);
    setSelectedUser(item.user);
  };

  return <section className="mx-auto flex min-h-[calc(100dvh-150px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[calc(100dvh-130px)] md:min-h-[620px]">
    <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-700"><MessageSquare size={20}/></div>
      <div><h1 className="text-lg font-bold text-slate-900">Messages</h1><p className="text-xs text-slate-500">Private conversations</p></div>
    </header>
    <div className="grid min-h-0 flex-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className={`${selectedUserId ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-b border-slate-200 md:border-b-0 md:border-r`}>
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-800">Your conversations</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loadingList && <p className="px-3 py-6 text-center text-sm text-slate-500">Loading conversations…</p>}
          {!loadingList && conversations.length === 0 && <div className="px-4 py-10 text-center"><p className="font-semibold text-slate-800">No conversations yet</p><p className="mt-1 text-sm text-slate-500">Say hi to start chatting.</p></div>}
          {conversations.map(item => <button key={item.user.id} type="button" onClick={() => selectConversation(item)} className={`flex min-h-[72px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-slate-50 ${selectedUserId === item.user.id ? 'bg-blue-50' : ''}`}>
            <img src={item.user.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full bg-slate-200 object-cover"/>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{item.user.name}</span><span className="block truncate text-xs text-slate-500">{item.lastMessage.text}</span></span>
            <span className="flex shrink-0 flex-col items-end gap-1"><span className="text-[10px] text-slate-400">{timeLabel(item.lastMessage.createdAt)}</span>{item.unreadCount > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">{item.unreadCount}</span>}</span>
          </button>)}
        </div>
      </aside>
      <section className={`${selectedUserId ? 'flex' : 'hidden md:flex'} min-h-0 min-w-0 flex-col`}>
        {selectedUser ? <>
          <div className="flex min-h-[64px] items-center gap-3 border-b border-slate-200 px-3 sm:px-5">
            <button type="button" onClick={() => setSelectedUserId(null)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 md:hidden" aria-label="Back to conversations"><ArrowLeft size={20}/></button>
            <button type="button" onClick={() => onViewProfile(selectedUser.id)} className="flex min-w-0 items-center gap-3 text-left"><img src={selectedUser.avatar} alt="" className="h-10 w-10 rounded-full object-cover"/><span className="truncate font-bold text-slate-900">{selectedUser.name}</span></button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-6">
            {loadingChat && sortedMessages.length === 0 && <p className="m-auto text-sm text-slate-500">Loading messages…</p>}
            {!loadingChat && sortedMessages.length === 0 && <p className="m-auto max-w-xs text-center text-sm text-slate-500">No messages yet. Say hi to start chatting.</p>}
            {sortedMessages.map(message => <div key={message._id} className={`max-w-[82%] sm:max-w-[70%] ${message.senderId === currentUser?.id ? 'self-end' : 'self-start'}`}>
              <div className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${message.senderId === currentUser?.id ? 'rounded-br-md bg-blue-600 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900'}`}>{message.text}</div>
              <div className={`mt-1 text-[10px] text-slate-400 ${message.senderId === currentUser?.id ? 'text-right' : ''}`}>{timeLabel(message.createdAt)}</div>
            </div>)}
            <div ref={bottomRef}/>
          </div>
          <form onSubmit={event => { event.preventDefault(); void send(); }} className="flex items-end gap-2 border-t border-slate-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
            <textarea value={draft} onChange={event => setDraft(event.target.value.slice(0, 2000))} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} maxLength={2000} rows={1} placeholder="Write a message…" className="max-h-32 min-h-12 flex-1 resize-y rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/>
            <button type="submit" disabled={!draft.trim() || sending} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300" aria-label="Send message"><Send size={19}/></button>
          </form>
        </> : <div className="hidden flex-1 flex-col items-center justify-center text-center md:flex"><div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600"><MessageSquare size={28}/></div><h2 className="font-bold text-slate-800">Your messages</h2><p className="mt-1 text-sm text-slate-500">Choose someone to open a private chat.</p></div>}
      </section>
    </div>
    {error && <div role="status" className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</div>}
  </section>;
};

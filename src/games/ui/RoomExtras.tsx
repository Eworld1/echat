import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, MessageCircle, Search, Send, Share2, UserPlus, X } from 'lucide-react';
import { api } from '../../services/api';
import type { User } from '../../types';
import { inviteFriends, roomLink, sendRoomMessage, type GameRoom, type Me, type RoomMessage } from '../rooms';
import { Avatar } from './common';

export const REACTIONS = ['😀', '😂', '😮', '😢', '😡', '👍', '🔥', '🎉', '👏', '🙏'];

/** Emoji bubbles that float up over the board for a few seconds. */
export const FloatingReactions: React.FC<{ messages: RoomMessage[]; since: number }> = ({ messages, since }) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 500); return () => window.clearInterval(id); }, []);
  const recent = messages.filter(message => message.kind === 'emoji' && message.createdAt > since && now - message.createdAt < 3500).slice(-6);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center gap-3" aria-live="polite">
      {recent.map((message, index) => (
        <div key={message.id} className="flex flex-col items-center" style={{ animation: 'echatFloatUp 3.5s ease-out forwards', animationDelay: `${index * 40}ms` }}>
          <span className="text-5xl drop-shadow-lg">{message.text}</span>
          <span className="rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">{message.name}</span>
        </div>
      ))}
      <style>{'@keyframes echatFloatUp { 0% { transform: translateY(20px) scale(.6); opacity: 0; } 12% { transform: translateY(0) scale(1.15); opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(-140px) scale(1); opacity: 0; } }'}</style>
    </div>
  );
};

export const RoomChat: React.FC<{ room: GameRoom; me: Me; messages: RoomMessage[]; canSend: boolean }> = ({ room, me, messages, canSend }) => {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const texts = messages.filter(message => message.kind === 'text');
  useEffect(() => { if (open) list.current?.scrollTo({ top: list.current.scrollHeight }); }, [open, texts.length]);

  const send = async (value: string, kind: 'text' | 'emoji') => {
    if (!canSend) return;
    setError('');
    try { await sendRoomMessage(room.id, me, value, kind); if (kind === 'text') setText(''); }
    catch { setError('Message not sent. Check your connection.'); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-1 overflow-x-auto p-2" role="toolbar" aria-label="Send a reaction">
        {REACTIONS.map(emoji => (
          <button key={emoji} type="button" disabled={!canSend} onClick={() => void send(emoji, 'emoji')} aria-label={`React ${emoji}`}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-2xl transition hover:bg-slate-100 active:scale-90 disabled:opacity-40">{emoji}</button>
        ))}
      </div>
      <button type="button" onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between border-t border-slate-100 px-3 py-2 text-sm font-bold text-slate-700">
        <span className="flex items-center gap-2"><MessageCircle size={16} />Game chat{texts.length ? ` (${texts.length})` : ''}</span>
        <span className="text-xs text-[#1877F2]">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          <div ref={list} className="max-h-56 space-y-1.5 overflow-y-auto p-3">
            {texts.length === 0 ? <p className="text-center text-xs text-slate-400">Say hi 👋</p> : texts.map(message => (
              <p key={message.id} className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${message.senderId === me.uid ? 'ml-auto bg-[#1877F2] text-white' : 'bg-slate-100 text-slate-800'}`}>
                {message.senderId !== me.uid && <span className="block text-[10px] font-bold opacity-70">{message.name}</span>}
                {message.text}
              </p>
            ))}
          </div>
          <form onSubmit={event => { event.preventDefault(); void send(text, 'text'); }} className="flex gap-2 border-t border-slate-100 p-2">
            <input value={text} onChange={event => setText(event.target.value)} maxLength={200} disabled={!canSend} placeholder={canSend ? 'Message players…' : 'Only players can chat'}
              className="min-h-10 min-w-0 flex-1 rounded-full border border-slate-300 px-4 text-sm outline-none focus:border-[#1877F2]" />
            <button type="submit" disabled={!canSend || !text.trim()} aria-label="Send" className="grid h-10 w-10 place-items-center rounded-full bg-[#1877F2] text-white disabled:opacity-40"><Send size={16} /></button>
          </form>
          {error && <p className="px-3 pb-2 text-xs text-rose-600">{error}</p>}
        </div>
      )}
    </section>
  );
};

export const ShareRoom: React.FC<{ room: GameRoom; gameName: string }> = ({ room, gameName }) => {
  const [copied, setCopied] = useState(false);
  const link = roomLink(room.id);
  const text = `Play ${gameName} with me on EChat! Room code ${room.id}: ${link}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  };
  const share = async () => {
    if (navigator.share) { try { await navigator.share({ title: `EChat ${gameName}`, text, url: link }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={() => void copy()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-700">{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy link'}</button>
      <button type="button" onClick={() => void share()} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-sm font-bold text-white"><Share2 size={16} />Share</button>
    </div>
  );
};

/** Pick EChat friends to invite: they get a chat message with the room link and see it under Invites. */
export const InviteSheet: React.FC<{ room: GameRoom; me: Me; friendIds: string[]; gameName: string; onClose: () => void }> = ({ room, me, friendIds, gameName, onClose }) => {
  const [friends, setFriends] = useState<User[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const mine = new Set(friendIds);
    api.getUsers().then(all => { if (!cancelled) setFriends(all.filter(user => mine.has(user.id))); }).catch(() => setFriends([]));
    return () => { cancelled = true; };
  }, [friendIds]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (friends || []).filter(friend => !room.playerIds.includes(friend.id) && (!q || friend.name.toLowerCase().includes(q)));
  }, [friends, search, room.playerIds]);

  const send = async () => {
    setBusy(true);
    setMessage('');
    try {
      const chosen = (friends || []).filter(friend => picked.has(friend.id));
      const sent = await inviteFriends(room, me, chosen, gameName);
      setMessage(sent === chosen.length ? `Invite sent to ${sent} friend${sent === 1 ? '' : 's'} ✓` : `Invited ${chosen.length}; ${sent} chat message${sent === 1 ? '' : 's'} sent.`);
      setPicked(new Set());
    } catch {
      setMessage('Could not send invites. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Invite friends">
      <div className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white sm:rounded-3xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-extrabold text-slate-900">Invite friends</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100"><X size={20} /></button>
        </header>
        <div className="border-b border-slate-100 p-3">
          <label className="flex min-h-10 items-center gap-2 rounded-full bg-slate-100 px-3">
            <Search size={16} className="text-slate-500" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search friends" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </label>
        </div>
        <ul className="flex-1 overflow-y-auto p-2">
          {friends === null ? <li className="p-6 text-center text-sm text-slate-500">Loading friends…</li>
            : shown.length === 0 ? <li className="p-6 text-center text-sm text-slate-500">{friends.length ? 'No friends match.' : 'No friends yet. Share the link instead.'}</li>
              : shown.map(friend => {
                const on = picked.has(friend.id);
                const invited = room.invitedIds.includes(friend.id);
                return (
                  <li key={friend.id}>
                    <button type="button" onClick={() => setPicked(current => { const next = new Set(current); if (next.has(friend.id)) next.delete(friend.id); else next.add(friend.id); return next; })}
                      className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-2 text-left ${on ? 'bg-blue-50' : 'hover:bg-slate-50'}`} aria-pressed={on}>
                      <Avatar name={friend.name} src={friend.avatar || ''} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-slate-900">{friend.name}</span>
                        {invited && <span className="text-[11px] font-semibold text-emerald-600">Invited</span>}
                      </span>
                      <span className={`grid h-6 w-6 place-items-center rounded-full border-2 ${on ? 'border-[#1877F2] bg-[#1877F2] text-white' : 'border-slate-300'}`}>{on && <Check size={14} />}</span>
                    </button>
                  </li>
                );
              })}
        </ul>
        <footer className="space-y-2 border-t border-slate-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {message && <p className="text-center text-sm font-semibold text-emerald-700">{message}</p>}
          <button type="button" disabled={busy || picked.size === 0} onClick={() => void send()} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1877F2] text-sm font-bold text-white disabled:opacity-50">
            <UserPlus size={17} />{busy ? 'Sending…' : `Invite${picked.size ? ` ${picked.size}` : ''}`}
          </button>
        </footer>
      </div>
    </div>
  );
};

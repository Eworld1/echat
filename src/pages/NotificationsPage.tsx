import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCheck, Heart, Loader2, MessageCircle, MessageSquare, PhoneMissed, Radio, ShoppingBag, UserCheck, UserPlus, Cake, Megaphone, Share2, AtSign, FileText } from 'lucide-react';
import { api, invalidateApiReadCache } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { setUnreadCounts, useUnreadCounts } from '../services/unread';
import { initialsAvatar } from '../utils/avatar';
import type { Notification } from '../types';

/**
 * Notifications tab: EVERYTHING in one place, newest first - messages, friend requests, accepted
 * requests, likes and comments on posts / profile pictures, Marketplace likes, Lives, birthdays.
 * Opening it clears the bell badge (message badges clear when that chat is opened).
 * New ones appear live (socket + the Firestore unread listener), no refresh needed.
 */

type Filter = 'all' | 'unread' | 'messages' | 'friends' | 'activity';

const ICONS: Partial<Record<Notification['type'], { icon: React.ReactNode; bg: string }>> = {
  message: { icon: <MessageSquare size={12} />, bg: 'bg-blue-600' },
  friend_request: { icon: <UserPlus size={12} />, bg: 'bg-blue-600' },
  friend_accept: { icon: <UserCheck size={12} />, bg: 'bg-emerald-600' },
  post_reaction: { icon: <Heart size={12} fill="currentColor" />, bg: 'bg-rose-500' },
  post_comment: { icon: <MessageCircle size={12} />, bg: 'bg-emerald-600' },
  post_tag: { icon: <AtSign size={12} />, bg: 'bg-violet-600' },
  post_share: { icon: <Share2 size={12} />, bg: 'bg-sky-600' },
  post_new: { icon: <FileText size={12} />, bg: 'bg-slate-600' },
  market_like: { icon: <ShoppingBag size={12} />, bg: 'bg-amber-500' },
  live_stream: { icon: <Radio size={12} />, bg: 'bg-red-600' },
  missed_call: { icon: <PhoneMissed size={12} />, bg: 'bg-red-600' },
  call: { icon: <PhoneMissed size={12} />, bg: 'bg-red-600' },
  birthday: { icon: <Cake size={12} />, bg: 'bg-pink-500' },
  birthday_today: { icon: <Cake size={12} />, bg: 'bg-pink-500' },
  birthday_reminder: { icon: <Cake size={12} />, bg: 'bg-pink-500' },
  announcement: { icon: <Megaphone size={12} />, bg: 'bg-violet-600' },
  page_follow: { icon: <UserPlus size={12} />, bg: 'bg-blue-600' }
};

const FRIEND_TYPES = new Set(['friend_request', 'friend_accept', 'page_follow']);
const ACTIVITY_TYPES = new Set(['post_reaction', 'post_comment', 'post_tag', 'post_share', 'market_like']);

function timeAgo(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d`;
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

interface Props {
  onOpenChat: (userId: string) => void;
  onViewProfile: (userId: string) => void;
  onOpenFriends: () => void;
  onOpenPost: (postId: string) => void;
  onOpenLive: () => void;
  /** In-app path such as /marketplace/listing/<id> or /post/<id>. */
  onOpenPath: (path: string) => void;
}

export const NotificationsPage: React.FC<Props> = ({ onOpenChat, onViewProfile, onOpenFriends, onOpenPost, onOpenLive, onOpenPath }) => {
  const { user } = useAuth();
  const { onNotification } = useSocket();
  const unread = useUnreadCounts(user?.id);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    invalidateApiReadCache('notifications');
    try { setItems(await api.getNotifications()); setError(''); }
    catch { setError('Could not load notifications. Pull down or try again.'); setItems(current => current ?? []); }
  }, []);

  // First load, then clear the bell badge (Facebook-style: seeing the list = read). Messages stay unread
  // until that chat is opened.
  useEffect(() => {
    if (!user?.id) return;
    void load().then(() => api.markNotificationsRead({ exceptMessages: true }).catch(() => {}));
    setUnreadCounts({ notifications: 0 });
  }, [user?.id, load]);

  // Live: new ones slide in from the socket; when the Firestore unread counter moves, refresh the list.
  useEffect(() => onNotification(n => {
    if (!n?.id) return;
    setItems(current => [n, ...(current || []).filter(item => item.id !== n.id)]);
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (items) void load(); }, [unread.messages]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (items || [])
    .filter(n => filter === 'all' ? true : filter === 'unread' ? !n.read : filter === 'messages' ? n.type === 'message' || n.type === 'missed_call' : filter === 'friends' ? FRIEND_TYPES.has(n.type) : ACTIVITY_TYPES.has(n.type))
    .sort((a, b) => b.createdAt - a.createdAt), [items, filter]);

  const open = (n: Notification) => {
    setItems(current => (current || []).map(item => item.id === n.id ? { ...item, read: true } : item));
    if (n.link) return onOpenPath(n.link);
    switch (n.type) {
      case 'message': case 'missed_call': case 'call': return onOpenChat(n.actorId);
      case 'friend_request': return onOpenFriends();
      case 'friend_accept': case 'birthday': case 'birthday_today': case 'birthday_reminder': case 'page_follow': return onViewProfile(n.actorId);
      case 'live_stream': return onOpenLive();
      default: if (n.targetId) return onOpenPost(n.targetId);
    }
  };

  const markAll = async () => {
    setItems(current => (current || []).map(item => item.type === 'message' ? item : { ...item, read: true }));
    setUnreadCounts({ notifications: 0 });
    await api.markNotificationsRead({ exceptMessages: true }).catch(() => {});
  };

  const chips: { id: Filter; label: string }[] = [
    { id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'messages', label: `Messages${unread.messages ? ` (${unread.messages})` : ''}` },
    { id: 'friends', label: 'Friends' }, { id: 'activity', label: 'Likes & comments' }
  ];

  return (
    <div className="mx-auto w-full max-w-[640px] pb-16">
      <div className="ec-card bg-white p-4 dark:bg-[#161033]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 dark:text-white"><Bell size={22} className="text-blue-600" />Notifications</h1>
          <button type="button" onClick={() => void markAll()} className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-white/10"><CheckCheck size={16} />Mark all as read</button>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {chips.map(chip => (
            <button key={chip.id} type="button" onClick={() => setFilter(chip.id)} className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${filter === chip.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-200'}`}>{chip.label}</button>
          ))}
        </div>
      </div>

      <div className="ec-card mt-3 overflow-hidden bg-white dark:bg-[#161033]">
        {items === null ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />Loading notifications…</div>
        ) : shown.length === 0 ? (
          <div className="p-10 text-center">
            <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-400 dark:bg-white/10"><Bell size={26} /></span>
            <p className="font-bold text-slate-800 dark:text-white">{filter === 'unread' ? 'You\'re all caught up' : 'No notifications yet'}</p>
            <p className="mt-1 text-sm text-slate-500">Messages, friend requests, likes and comments will show up here.</p>
          </div>
        ) : (
          <ul role="list">
            {shown.map(n => {
              const look = ICONS[n.type] || { icon: <Bell size={12} />, bg: 'bg-slate-600' };
              const name = n.actor?.name || 'EChat';
              return (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/5 ${n.read ? '' : 'bg-blue-50/70 dark:bg-blue-500/10'}`}>
                    <span className="relative shrink-0">
                      <img src={n.actor?.avatar || initialsAvatar(name)} alt="" className="h-12 w-12 rounded-full object-cover" />
                      <span className={`absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full text-white ring-2 ring-white dark:ring-[#161033] ${look.bg}`}>{look.icon}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-[14px] leading-snug ${n.read ? 'text-slate-700 dark:text-slate-300' : 'font-semibold text-slate-900 dark:text-white'}`}>{n.message}</span>
                      <span className={`mt-0.5 block text-xs ${n.read ? 'text-slate-500' : 'font-semibold text-blue-600 dark:text-blue-300'}`}>{timeAgo(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="mt-2 h-3 w-3 shrink-0 rounded-full bg-blue-600" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {error && <p role="alert" className="border-t border-slate-100 p-3 text-center text-sm font-semibold text-red-600">{error}</p>}
      </div>
    </div>
  );
};

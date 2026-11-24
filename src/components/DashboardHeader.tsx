import React, { useEffect, useState } from 'react';
import { MessageCircle, Radio, ShoppingBag, Users } from 'lucide-react';
import { collection, getCountFromServer, getDocs, query, where } from 'firebase/firestore';
import { db } from '../services/firebase';
import { api } from '../services/api';
import { listenFollowerCount } from '../services/liveDiscovery';
import { useAuth } from '../context/AuthContext';

type Target = 'profile' | 'live' | 'messages' | 'marketplace';

interface Props {
  onGoLive: () => void;
  onOpen: (target: Target) => void;
}

interface Stat {
  key: Target;
  label: string;
  value: number | null;
  sub: string;
  icon: React.ReactNode;
  tint: string;
  glow: string;
}

const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
};

/** Top of the home feed: "Welcome back, Name 👋", today's date, Go Live and the four stat cards. */
export const DashboardHeader: React.FC<Props> = ({ onGoLive, onOpen }) => {
  const { user } = useAuth();
  const uid = user?.id || '';
  const [followers, setFollowers] = useState<number | null>(null);
  const [streams, setStreams] = useState<number | null>(null);
  const [messages, setMessages] = useState<{ unread: number; chats: number } | null>(null);
  const [sales, setSales] = useState<{ sold: number; active: number } | null>(null);

  useEffect(() => (uid ? listenFollowerCount(uid, setFollowers) : undefined), [uid]);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    getCountFromServer(query(collection(db, 'liveStreams'), where('hostId', '==', uid)))
      .then(snapshot => { if (active) setStreams(snapshot.data().count); })
      .catch(() => { if (active) setStreams(0); });
    api.getDmConversations(uid)
      .then(list => { if (active) setMessages({ unread: list.reduce((sum, item) => sum + (item.unreadCount || 0), 0), chats: list.length }); })
      .catch(() => { if (active) setMessages({ unread: 0, chats: 0 }); });
    getDocs(query(collection(db, 'echat_v2_market_listings'), where('sellerId', '==', uid)))
      .then(snapshot => {
        if (!active) return;
        const statuses = snapshot.docs.map(item => String(item.data().status || 'active'));
        setSales({ sold: statuses.filter(status => status === 'sold').length, active: statuses.filter(status => status !== 'sold').length });
      })
      .catch(() => { if (active) setSales({ sold: 0, active: 0 }); });
    return () => { active = false; };
  }, [uid]);

  if (!user) return null;
  const firstName = (user.name || '').trim().split(/\s+/)[0] || 'friend';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const stats: Stat[] = [
    { key: 'profile', label: 'My Followers', value: followers, sub: `${user.friends?.length || 0} friends`, icon: <Users size={20} />, tint: 'from-violet-600 to-purple-500', glow: 'shadow-violet-500/30' },
    { key: 'live', label: 'My Streams', value: streams, sub: 'times you went live', icon: <Radio size={20} />, tint: 'from-pink-500 to-rose-500', glow: 'shadow-pink-500/30' },
    { key: 'messages', label: 'My Messages', value: messages?.unread ?? null, sub: messages ? `unread · ${messages.chats} chats` : 'unread', icon: <MessageCircle size={20} />, tint: 'from-blue-600 to-cyan-500', glow: 'shadow-blue-500/30' },
    { key: 'marketplace', label: 'Marketplace Sales', value: sales?.sold ?? null, sub: sales ? `sold · ${sales.active} active` : 'items sold', icon: <ShoppingBag size={20} />, tint: 'from-amber-500 to-orange-500', glow: 'shadow-amber-500/30' }
  ];

  return (
    <section aria-label="Your dashboard" className="space-y-3">
      <div className="ec-gradient-animated relative overflow-hidden rounded-[20px] p-5 text-white shadow-lg shadow-violet-900/20 sm:p-6">
        <span aria-hidden="true" className="ec-float absolute -right-8 -top-12 h-40 w-40 rounded-full bg-pink-400/40 blur-3xl" />
        <span aria-hidden="true" className="ec-float-delay absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-cyan-300/30 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/75">{greeting()} · {today}</p>
            <h1 className="mt-1 truncate text-2xl font-black tracking-tight sm:text-[28px]">Welcome back, {firstName} 👋</h1>
            <p className="mt-0.5 text-sm text-white/80">Here's what's happening on your EChat today.</p>
          </div>
          <button type="button" onClick={onGoLive} className="ec-golive group flex min-h-12 shrink-0 items-center gap-2 rounded-full px-6 text-[15px] font-extrabold text-white ring-2 ring-white/30">
            <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" /><span className="relative inline-flex h-3 w-3 rounded-full bg-white" /></span>
            Go Live
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(stat => (
          <button key={stat.key} type="button" onClick={() => onOpen(stat.key)}
            className="ec-card ec-card-hover group flex flex-col items-start gap-2 bg-white p-3.5 text-left dark:bg-[#161033]">
            <span className={`grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br ${stat.tint} text-white shadow-lg ${stat.glow} transition group-hover:scale-110`}>{stat.icon}</span>
            <span className="text-[26px] font-black leading-none tracking-tight text-slate-900 dark:text-white">
              {stat.value === null ? <span className="inline-block h-6 w-10 animate-pulse rounded-md bg-slate-200 align-middle dark:bg-white/10" /> : stat.value.toLocaleString()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold text-slate-800 dark:text-slate-100">{stat.label}</span>
              <span className="block truncate text-[11px] text-slate-500 dark:text-slate-400">{stat.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

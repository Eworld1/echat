import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bell, Eye, LockKeyhole, MapPin, Radio, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { LiveCategory, LiveLocation, LiveStream } from '../types';
import { LIVE_CATEGORIES, LIVE_LOCATIONS, listenBlockedByIds, listenBlockIds, listenFollowingIds, listenLiveNotifications, listenLiveStreams, markLiveNotificationsRead } from '../services/liveDiscovery';
import { LiveUserActions } from './LiveUserActions';
import { getGoLiveEligibility } from '../config/featureFlags';

interface Props { onWatchLive: (stream: LiveStream) => void; onOpenGoLive: () => void; onBack: () => void; legacyStream?: LiveStream | null; }
type CategoryFilter = 'All' | LiveCategory;
type LocationFilter = 'All Locations' | 'Near Me' | LiveLocation;

export const LiveDiscoveryFeed: React.FC<Props> = ({ onWatchLive, onOpenGoLive, onBack, legacyStream }) => {
  const { user, isDeveloper } = useAuth();
  const goLiveEligibility = getGoLiveEligibility({ role: user?.role, isAdmin: user?.isAdmin, isDeveloper, createdAt: user?.createdAt });
  const canGoLive = goLiveEligibility.canGoLive && !user?.isBlocked;
  const goLiveLabel = canGoLive ? 'Go Live' : user?.isBlocked ? 'Live access blocked' : `Go Live in ${goLiveEligibility.daysLeft} ${goLiveEligibility.daysLeft === 1 ? 'day' : 'days'}`;
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [blockedByIds, setBlockedByIds] = useState<string[]>([]);
  const [category, setCategory] = useState<CategoryFilter>('All');
  const [feed, setFeed] = useState<'all' | 'following'>('all');
  const [location, setLocation] = useState<LocationFilter>('All Locations');
  const [search, setSearch] = useState('');
  const [notificationCount, setNotificationCount] = useState(0);
  const [showLockedHint, setShowLockedHint] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => listenLiveStreams(items => { setStreams(items); setLoading(false); setError(''); }, err => { setError(err.message || 'Could not load live streams.'); setLoading(false); }), []);
  useEffect(() => {
    if (!user?.id) { setFollowingIds([]); setBlockedIds([]); setBlockedByIds([]); setNotificationCount(0); return; }
    const unsubs = [
      listenFollowingIds(user.id, setFollowingIds, err => setError(err.message)),
      listenBlockIds(user.id, setBlockedIds, err => setError(err.message)),
      listenBlockedByIds(user.id, setBlockedByIds, err => setError(err.message)),
      listenLiveNotifications(user.id, setNotificationCount)
    ];
    return () => unsubs.forEach(unsub => unsub());
  }, [user?.id]);

  const nearbyCity = useMemo(() => LIVE_LOCATIONS.find(city => city !== 'Other' && (user?.location || '').toLowerCase().includes(city.toLowerCase())), [user?.location]);
  const visibleStreams = useMemo(() => {
    const term = search.trim().toLowerCase();
    const allStreams = legacyStream?.isActive && !streams.some(item => item.id === legacyStream.id) ? [...streams, legacyStream] : streams;
    return allStreams.filter(stream => {
      if (stream.underReview) return false;
      if (user?.id && (stream.hostId === user.id || blockedIds.includes(stream.hostId) || blockedByIds.includes(stream.hostId))) return false;
      if (feed === 'following' && !followingIds.includes(stream.hostId)) return false;
      if (category !== 'All' && (stream.category || 'Just Chatting') !== category) return false;
      if (location === 'Near Me' && (!nearbyCity || stream.location !== nearbyCity)) return false;
      if (location !== 'All Locations' && location !== 'Near Me' && stream.location !== location) return false;
      if (term && !`${stream.hostName} ${stream.title} ${stream.category || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [streams, legacyStream, user?.id, blockedIds, blockedByIds, feed, followingIds, category, location, nearbyCity, search]);

  return <main className="mx-auto w-full max-w-[1050px] space-y-4 pb-16" aria-label="Live Now">
    <header className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <button type="button" onClick={onBack} aria-label="Back to Home" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-700 hover:bg-slate-100"><ArrowLeft size={20}/></button>
      <h1 className="mr-auto flex items-center gap-2 text-xl font-extrabold text-slate-900"><Radio size={20} className="text-rose-600"/>Live Now</h1>
      {notificationCount > 0 && <button type="button" onClick={() => user && void markLiveNotificationsRead(user.id)} title="Mark live notifications as read" className="inline-flex min-h-9 items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700"><Bell size={13}/>{notificationCount} new</button>}
      <div className="relative">
        <button type="button" aria-disabled={!canGoLive} onClick={() => canGoLive ? onOpenGoLive() : setShowLockedHint(true)} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold ${canGoLive ? 'bg-rose-600 text-white hover:bg-rose-700' : 'cursor-not-allowed bg-slate-200 text-slate-600'}`}>{!canGoLive && <LockKeyhole size={15}/>} {goLiveLabel}</button>
        {showLockedHint && !canGoLive && <div role="status" className="absolute right-0 top-full z-20 mt-2 w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-lg">{user?.isBlocked ? 'Your Go Live access is blocked.' : 'Your account must be 60 days old to go live'}<button type="button" onClick={() => setShowLockedHint(false)} aria-label="Dismiss message" className="ml-2 text-slate-500 underline">Dismiss</button></div>}
      </div>
    </header>
    <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 shadow-sm"><Search size={18} className="shrink-0 text-slate-500"/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search stream titles and creators" className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Search stream titles and creators"/></label>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Live categories">
      {(['All', ...LIVE_CATEGORIES] as CategoryFilter[]).map(item => <button key={item} type="button" role="tab" aria-selected={category === item} onClick={() => setCategory(item)} className={category === item ? 'min-h-10 rounded-xl bg-[#0A2A6B] px-3 text-xs font-bold text-white' : 'min-h-10 rounded-xl bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50'}>{item}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border-b border-slate-200 bg-white p-3">
      <div className="flex rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setFeed('all')} className={feed === 'all' ? 'min-h-9 rounded-lg bg-white px-4 text-sm font-bold text-slate-900 shadow-sm' : 'min-h-9 rounded-lg px-4 text-sm font-semibold text-slate-600'}>All live</button><button type="button" onClick={() => setFeed('following')} className={feed === 'following' ? 'min-h-9 rounded-lg bg-white px-4 text-sm font-bold text-slate-900 shadow-sm' : 'min-h-9 rounded-lg px-4 text-sm font-semibold text-slate-600'}>Following</button></div>
      <label className="ml-auto flex min-h-10 items-center gap-1.5 text-xs font-semibold text-slate-600"><MapPin size={15}/><span className="hidden sm:inline">Location</span><select value={location} onChange={event => setLocation(event.target.value as LocationFilter)} className="max-w-[145px] rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"><option>All Locations</option><option>Near Me</option>{LIVE_LOCATIONS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>
    {loading ? <div className="rounded-2xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-500">Loading live streams…</div> : error ? <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : visibleStreams.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm font-semibold text-slate-700">No one is live right now.</div> : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {visibleStreams.map(stream => <article key={stream.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        <button type="button" onClick={() => onWatchLive(stream)} className="relative flex aspect-video w-full items-end bg-slate-900 p-3 text-left text-white">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: stream.hostAvatar ? `linear-gradient(0deg, #0f172a, transparent), url("${stream.hostAvatar}")` : 'linear-gradient(135deg,#0f172a,#334155)', backgroundSize: 'cover', backgroundPosition: 'center' }}/>
          <span className="absolute left-3 top-3 rounded-md bg-rose-600 px-2 py-1 text-[10px] font-black uppercase">Live</span>
          <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-1 text-xs font-bold"><Eye size={13} className="mr-1 inline"/>{stream.viewersCount || 0}</span>
          <span className="relative z-10 line-clamp-2 text-base font-extrabold">{stream.title || `${stream.hostName} is live`}</span>
        </button>
        <div className="space-y-2.5 p-3">
          <div className="flex items-center gap-2"><img src={stream.hostAvatar || '/logo-mark-blue.svg'} alt="" className="h-10 w-10 rounded-full object-cover"/><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{stream.hostName}</p><p className="truncate text-xs text-slate-500">{stream.location ? `Live from ${stream.location}` : 'Broadcasting now'}</p></div></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-blue-800">{stream.category || 'Just Chatting'}</span>{stream.location && <span className="flex items-center gap-1 text-xs text-slate-500"><MapPin size={13}/>{stream.location}</span>}<LiveUserActions targetUserId={stream.hostId} targetName={stream.hostName} streamId={stream.id} compact/></div>
          <button type="button" onClick={() => onWatchLive(stream)} className="min-h-10 w-full rounded-xl bg-slate-900 text-sm font-bold text-white hover:bg-slate-800">Watch live</button>
        </div>
      </article>)}
    </div>}
  </main>;
};

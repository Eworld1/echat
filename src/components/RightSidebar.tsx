import React, { useEffect, useMemo, useState } from 'react';
import { Check, Eye, Flame, Phone, Radio, TrendingUp, UserPlus, Video } from 'lucide-react';
import { api } from '../services/api';
import { followCreator, listenFollowingIds, listenLiveStreams, unfollowCreator } from '../services/liveDiscovery';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { avatarSrc } from './UserAvatar';
import { VerifiedBadge } from './VerifiedBadge';
import { TermsModal } from './TermsModal';
import { BirthdayCard } from './BirthdayCard';
import type { LiveStream, User } from '../types';

interface RightSidebarProps {
  onOpenChat: (user: User) => void;
  onViewProfile?: (userId: string) => void;
  onWatchLive?: (stream: LiveStream) => void;
  onOpenLive?: () => void;
}

const OFFICIAL_EMAIL = 'eldermoses89@gmail.com';
const isOfficial = (person: User) => Boolean(person.isOfficialDeveloper || person.email?.toLowerCase() === OFFICIAL_EMAIL);

const Panel: React.FC<{ title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ title, icon, action, children }) => (
  <section className="ec-card bg-white p-4 dark:bg-[#161033]">
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-[15px] font-extrabold text-slate-900 dark:text-white">{icon}{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

/** Right rail: Live Now, Who to follow, Trending, then birthdays and contacts. */
export const RightSidebar: React.FC<RightSidebarProps> = ({ onOpenChat, onViewProfile = () => {}, onWatchLive, onOpenLive }) => {
  const { user } = useAuth();
  const { onlineUserIds, startCall } = useSocket();
  const [people, setPeople] = useState<User[]>([]);
  const [lives, setLives] = useState<LiveStream[]>([]);
  const [trending, setTrending] = useState<{ tag: string; count: number }[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string>('');
  const [showTerms, setShowTerms] = useState(false);
  const [showAllContacts, setShowAllContacts] = useState(false);

  useEffect(() => { api.getTrending().then(list => setTrending(Array.isArray(list) ? list.slice(0, 6) : [])).catch(() => setTrending([])); }, [user?.id]);
  useEffect(() => listenLiveStreams(items => setLives(items.slice(0, 5)), () => setLives([])), []);
  useEffect(() => (user?.id ? listenFollowingIds(user.id, ids => setFollowing(new Set(ids)), () => {}) : undefined), [user?.id]);
  useEffect(() => {
    api.getUsers()
      .then(list => setPeople(Array.isArray(list) ? list.filter(person => person && person.id !== user?.id) : []))
      .catch(() => setPeople([]));
  }, [user?.id]);

  // Contacts: official account first, then people online.
  const contacts = useMemo(() => [...people].sort((a, b) => Number(isOfficial(b)) - Number(isOfficial(a)) || Number(onlineUserIds.includes(b.id)) - Number(onlineUserIds.includes(a.id))), [people, onlineUserIds]);
  // Suggestions: people I'm not friends with and don't follow yet (verified/official first).
  const suggestions = useMemo(() => people
    .filter(person => !user?.friends?.includes(person.id) && !following.has(person.id) && !person.isBlocked)
    .sort((a, b) => Number(isOfficial(b) || b.isVerified) - Number(isOfficial(a) || a.isVerified))
    .slice(0, 4), [people, user?.friends, following]);

  const toggleFollow = async (person: User) => {
    if (!user || pending) return;
    setPending(person.id);
    try {
      if (following.has(person.id)) await unfollowCreator(user.id, person.id);
      else await followCreator(user.id, person.id);
    } catch (error) {
      console.warn('Follow failed:', error);
    } finally {
      setPending('');
    }
  };

  const searchTag = (tag: string) => {
    const query = `#${tag}`;
    window.history.pushState({ echatApp: true, tab: 'search' }, '', `/search?q=${encodeURIComponent(query)}`);
    window.dispatchEvent(new Event('echat:navigate'));
    window.dispatchEvent(new CustomEvent('echat:search-query', { detail: query }));
  };

  const visibleContacts = showAllContacts ? contacts : contacts.slice(0, 8);

  return (
    <aside className="sticky top-[76px] hidden h-[calc(100vh-88px)] w-72 shrink-0 select-none space-y-4 overflow-y-auto pb-6 pl-1 [scrollbar-width:thin] xl:block">
      {/* Live Now */}
      <Panel title="Live Now" icon={<span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" /></span>}
        action={onOpenLive && <button type="button" onClick={onOpenLive} className="text-xs font-bold text-violet-700 hover:underline dark:text-violet-300">See all</button>}>
        {lives.length === 0 ? (
          <button type="button" onClick={onOpenLive} className="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-br from-pink-50 to-violet-50 p-3 text-left text-sm text-slate-600 dark:from-white/5 dark:to-white/5 dark:text-slate-300">
            <Radio size={20} className="shrink-0 text-pink-500" />Nobody is live right now. Be the first!
          </button>
        ) : (
          <div className="space-y-1">
            {lives.map(stream => (
              <button key={stream.id} type="button" onClick={() => (onWatchLive ? onWatchLive(stream) : onOpenLive?.())} className="flex w-full items-center gap-3 rounded-2xl p-1.5 text-left transition hover:bg-violet-50 dark:hover:bg-white/5">
                <span className="relative shrink-0 rounded-full bg-gradient-to-br from-pink-500 to-rose-500 p-[2px]">
                  <img src={avatarSrc(stream.hostAvatar, stream.hostName)} alt="" className="h-10 w-10 rounded-full border-2 border-white object-cover dark:border-[#161033]" />
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-rose-600 px-1 text-[8px] font-black leading-3 tracking-wider text-white">LIVE</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-900 dark:text-white">{stream.hostName}</span>
                  <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{stream.title || stream.category || 'Live now'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-slate-500"><Eye size={12} />{stream.viewersCount || 0}</span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {/* Who to follow */}
      {suggestions.length > 0 && (
        <Panel title="Who to follow" icon={<UserPlus size={17} className="text-violet-600 dark:text-violet-300" />}>
          <div className="space-y-2.5">
            {suggestions.map(person => {
              const followed = following.has(person.id);
              const name = isOfficial(person) ? 'EChat Official' : person.name;
              return (
                <div key={person.id} className="flex items-center gap-3">
                  <button type="button" onClick={() => onViewProfile(person.id)} className="shrink-0"><img src={avatarSrc(person.avatar, person.name)} alt="" className="h-10 w-10 rounded-full object-cover ring-2 ring-violet-100 dark:ring-white/10" /></button>
                  <button type="button" onClick={() => onViewProfile(person.id)} className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-1 text-sm font-bold text-slate-900 dark:text-white"><span className="truncate">{name}</span>{(person.isVerified || isOfficial(person)) && <VerifiedBadge size={13} />}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{person.location && person.location !== 'Global' ? person.location : person.bio || 'On EChat'}</span>
                  </button>
                  <button type="button" onClick={() => void toggleFollow(person)} disabled={pending === person.id}
                    className={`flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-xs font-bold transition disabled:opacity-60 ${followed ? 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200' : 'ec-gradient text-white shadow-sm shadow-violet-600/30 hover:brightness-110'}`}>
                    {followed ? <><Check size={13} />Following</> : 'Follow'}
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Trending */}
      <Panel title="Trending" icon={<TrendingUp size={17} className="text-pink-500" />}>
        {trending.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Use #hashtags in your posts to start a trend.</p>
        ) : (
          <ol className="space-y-0.5">
            {trending.map((item, index) => (
              <li key={item.tag}>
                <button type="button" onClick={() => searchTag(item.tag)} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-violet-50 dark:hover:bg-white/5">
                  <span className="w-4 text-xs font-black text-slate-400">{index + 1}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-900 dark:text-white">#{item.tag}</span><span className="text-[11px] text-slate-500">{item.count} {item.count === 1 ? 'post' : 'posts'}</span></span>
                  {index === 0 && <Flame size={15} className="text-orange-500" />}
                </button>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <BirthdayCard onViewProfile={onViewProfile} onSendMessage={onOpenChat} />

      {/* Contacts (open a chat or call) */}
      <section className="px-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contacts</h2>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">{onlineUserIds.length} active</span>
        </div>
        {contacts.length === 0 ? <p className="text-xs text-slate-400">Friends you add will appear here.</p> : (
          <div className="space-y-0.5">
            {visibleContacts.map(contact => {
              const online = onlineUserIds.includes(contact.id);
              const name = isOfficial(contact) ? 'EChat Official - Developer' : contact.name;
              return (
                <div key={contact.id} role="button" tabIndex={0} onClick={() => onOpenChat(contact)} onKeyDown={event => { if (event.key === 'Enter') onOpenChat(contact); }}
                  className="group flex cursor-pointer items-center gap-3 rounded-2xl p-1.5 transition hover:bg-white/80 dark:hover:bg-white/5">
                  <span className="relative shrink-0">
                    <img src={avatarSrc(contact.avatar, contact.name)} alt="" className="h-9 w-9 rounded-full object-cover" />
                    {online && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-[#0d0a1f]" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{name}</span>
                  <span className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                    <button type="button" onClick={event => { event.stopPropagation(); void startCall(contact.id, name, contact.avatar, 'audio'); }} title="Audio call" aria-label={`Call ${name}`} className="grid h-7 w-7 place-items-center rounded-full text-slate-500 hover:bg-violet-100 hover:text-violet-700"><Phone size={13} /></button>
                    <button type="button" onClick={event => { event.stopPropagation(); void startCall(contact.id, name, contact.avatar, 'video'); }} title="Video call" aria-label={`Video call ${name}`} className="grid h-7 w-7 place-items-center rounded-full text-slate-500 hover:bg-violet-100 hover:text-violet-700"><Video size={13} /></button>
                  </span>
                </div>
              );
            })}
            {contacts.length > 8 && <button type="button" onClick={() => setShowAllContacts(value => !value)} className="w-full rounded-xl py-2 text-xs font-bold text-violet-700 hover:bg-white/70 dark:text-violet-300">{showAllContacts ? 'Show less' : `Show all ${contacts.length}`}</button>}
          </div>
        )}
      </section>

      <div className="px-1 text-[11px] text-slate-400">
        <button type="button" onClick={() => setShowTerms(true)} className="font-medium hover:text-violet-600 hover:underline">EChat Terms & Conditions</button> · © {new Date().getFullYear()} EChat
      </div>
      <TermsModal isOpen={showTerms} onClose={() => setShowTerms(false)} />
    </aside>
  );
};

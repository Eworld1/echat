import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Loader2, Search, UserCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import type { User } from '../types';
import { api } from '../services/api';
import { getUserById } from '../services/db';
import { followCreator, listenFollowerIds, listenFollowingIds, unfollowCreator } from '../services/liveDiscovery';
import { useAuth } from '../context/AuthContext';
import { useBackButton } from '../hooks/useBackButton';
import { avatarSrc } from './UserAvatar';

/**
 * Facebook-style "Friends | Following | Followers" list for a profile.
 * Friends come from the EChat server profile; following / followers from Firestore `followers` docs
 * (followerId → followingId). Full page on phones, gold-bordered popup on desktop.
 */

export type ConnectionsTab = 'friends' | 'following' | 'followers';

interface ConnectionsModalProps {
  /** Whose lists these are. */
  profileUser: Pick<User, 'id' | 'name'>;
  friends: User[];
  initialTab: ConnectionsTab;
  onClose: () => void;
  onViewProfile: (userId: string) => void;
  /** After Unfriend: the profile's friends list without that person. */
  onFriendsChanged?: (friends: User[]) => void;
}

type Person = Pick<User, 'id' | 'name' | 'avatar'> & { subtitle?: string };

const TAB_LABEL: Record<ConnectionsTab, string> = { friends: 'All Friends', following: 'Following', followers: 'Followers' };
const SEARCH_LABEL: Record<ConnectionsTab, string> = { friends: 'Search Friends', following: 'Search Following', followers: 'Search Followers' };

/** Every user once per session (the server list), plus Firestore lookups for anyone missing. */
let directoryPromise: Promise<Map<string, User>> | null = null;
const loadDirectory = () => {
  if (!directoryPromise) directoryPromise = api.getUsers().then(list => new Map(list.map(person => [person.id, person])));
  return directoryPromise;
};

const toPerson = (user: User | null | undefined, id: string): Person => ({
  id,
  name: user?.name || 'EChat user',
  avatar: user?.avatar || '',
  subtitle: user?.location && user.location !== 'Global' ? user.location : user?.bio ? user.bio.slice(0, 60) : ''
});

async function resolvePeople(ids: string[], known: User[]): Promise<Person[]> {
  if (!ids.length) return [];
  const directory = await loadDirectory().catch(() => new Map<string, User>());
  known.forEach(person => directory.set(person.id, person));
  return Promise.all(ids.map(async id => {
    const found = directory.get(id) || await getUserById(id).catch(() => null);
    if (found) directory.set(id, found);
    return toPerson(found, id);
  }));
}

export const ConnectionsModal: React.FC<ConnectionsModalProps> = ({ profileUser, friends, initialTab, onClose, onViewProfile, onFriendsChanged }) => {
  const { user: me } = useAuth();
  const isOwn = me?.id === profileUser.id;
  const [tab, setTab] = useState<ConnectionsTab>(initialTab);
  const [search, setSearch] = useState('');

  const [friendList, setFriendList] = useState<User[]>(friends);
  useEffect(() => setFriendList(friends), [friends]);

  // Firestore: who this profile follows / who follows this profile / who I follow.
  const [followingIds, setFollowingIds] = useState<string[] | null>(null);
  const [followerIds, setFollowerIds] = useState<string[] | null>(null);
  const [myFollowingIds, setMyFollowingIds] = useState<string[]>([]);
  const [listError, setListError] = useState('');
  useEffect(() => listenFollowingIds(profileUser.id, setFollowingIds, error => { setFollowingIds([]); setListError(error.message); }), [profileUser.id]);
  useEffect(() => listenFollowerIds(profileUser.id, setFollowerIds, error => { setFollowerIds([]); setListError(error.message); }), [profileUser.id]);
  useEffect(() => (me?.id ? listenFollowingIds(me.id, setMyFollowingIds) : undefined), [me?.id]);

  // Instant feedback before Firestore confirms: id → following?
  const [pendingFollow, setPendingFollow] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer); }, [notice]);
  const iFollow = (id: string) => (id in pendingFollow ? pendingFollow[id] : myFollowingIds.includes(id));

  const [people, setPeople] = useState<Record<ConnectionsTab, Person[] | null>>({ friends: null, following: null, followers: null });
  useEffect(() => { setPeople(current => ({ ...current, friends: friendList.map(friend => toPerson(friend, friend.id)) })); }, [friendList]);
  useEffect(() => {
    if (!followingIds) return;
    let alive = true;
    void resolvePeople(followingIds, friendList).then(list => { if (alive) setPeople(current => ({ ...current, following: list })); });
    return () => { alive = false; };
  }, [followingIds?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!followerIds) return;
    let alive = true;
    void resolvePeople(followerIds, friendList).then(list => { if (alive) setPeople(current => ({ ...current, followers: list })); });
    return () => { alive = false; };
  }, [followerIds?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  useBackButton(true, onClose, 'profile-connections');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = overflow; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const counts: Record<ConnectionsTab, number> = {
    friends: friendList.length,
    following: (followingIds || []).filter(id => !removed.has(`following:${id}`)).length,
    followers: (followerIds || []).length
  };

  const visible = useMemo(() => {
    const list = (people[tab] || []).filter(person => !removed.has(`${tab}:${person.id}`));
    const term = search.trim().toLowerCase();
    return term ? list.filter(person => person.name.toLowerCase().includes(term)) : list;
  }, [people, tab, search, removed]);

  const openProfile = (id: string) => { onClose(); onViewProfile(id); };

  const setFollow = async (person: Person, follow: boolean) => {
    if (!me || busyId) return;
    setBusyId(person.id);
    setPendingFollow(current => ({ ...current, [person.id]: follow }));
    // Unfollowing from my own Following list: gone from the list right away.
    if (!follow && isOwn && tab === 'following') setRemoved(current => new Set(current).add(`following:${person.id}`));
    try {
      if (follow) await followCreator(me.id, person.id);
      else await unfollowCreator(me.id, person.id);
    } catch (error) {
      setPendingFollow(current => ({ ...current, [person.id]: !follow }));
      setRemoved(current => { const next = new Set(current); next.delete(`following:${person.id}`); return next; });
      setNotice(error instanceof Error ? error.message : 'Could not update. Please try again.');
    } finally { setBusyId(''); }
  };

  const unfriend = async (person: Person) => {
    if (busyId || !confirm(`Unfriend ${person.name}?`)) return;
    setBusyId(person.id);
    setRemoved(current => new Set(current).add(`friends:${person.id}`));
    try {
      await api.unfriend(person.id);
      const next = friendList.filter(friend => friend.id !== person.id);
      setFriendList(next);
      onFriendsChanged?.(next);
      setNotice(`${person.name} was removed from your friends.`);
    } catch (error) {
      setRemoved(current => { const next = new Set(current); next.delete(`friends:${person.id}`); return next; });
      setNotice(error instanceof Error ? error.message : 'Could not unfriend. Please try again.');
    } finally { setBusyId(''); }
  };

  const followButton = (person: Person) => {
    if (!me || person.id === me.id) return null;
    const following = iFollow(person.id);
    const label = following ? 'Following' : tab === 'followers' && isOwn ? 'Follow Back' : 'Follow';
    return (
      <button type="button" disabled={busyId === person.id} onClick={() => void setFollow(person, !following)} aria-pressed={following}
        className={following
          ? 'inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#d4d7db] bg-[#f1f2f4] px-3 text-[13px] font-bold text-[#1f2937] hover:bg-[#e6e8eb] disabled:opacity-60'
          : 'inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#b8862b] bg-gradient-to-b from-[#f3dc9b] via-[#d9b25a] to-[#b68428] px-3 text-[13px] font-extrabold text-[#1f3d1a] shadow-sm hover:brightness-105 disabled:opacity-60'}>
        {busyId === person.id ? <Loader2 size={14} className="animate-spin" /> : following ? <UserCheck size={15} /> : <UserPlus size={15} />}
        {label}
      </button>
    );
  };

  const loading = people[tab] === null;
  const emptyText = search.trim()
    ? `No one called "${search.trim()}".`
    : tab === 'friends' ? (isOwn ? "You haven't added any friends yet." : 'No friends to show.')
    : tab === 'following' ? (isOwn ? "You aren't following anyone yet." : `${profileUser.name} isn't following anyone yet.`)
    : (isOwn ? 'No one follows you yet.' : `No one follows ${profileUser.name} yet.`);

  return (
    <div className="fixed inset-0 z-[120] flex items-stretch justify-center bg-[#000000]/55 sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <section role="dialog" aria-modal="true" aria-label={`${profileUser.name}: ${TAB_LABEL[tab]}`} onClick={event => event.stopPropagation()}
        className="flex h-dvh w-full flex-col bg-[#ffffff] text-[#111111] sm:h-auto sm:max-h-[min(720px,88vh)] sm:max-w-[520px] sm:rounded-[26px] sm:border sm:border-[#e2c06e] sm:shadow-[0_0_0_1px_rgba(255,226,150,0.35),0_0_28px_6px_rgba(240,196,92,0.45),0_20px_60px_rgba(0,0,0,0.35)]"
        style={{ colorScheme: 'light' }}>
        {/* header */}
        <header className="flex items-center gap-2 border-b border-[#eceef1] px-3 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] sm:px-5 sm:pt-4">
          <button type="button" onClick={onClose} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-[#f1f2f4] sm:hidden"><ArrowLeft size={21} /></button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[19px] font-extrabold">{isOwn ? 'Your connections' : profileUser.name}</h2>
            <p className="text-[12px] text-[#6b7280]">{counts.friends} friends · {counts.following} following · {counts.followers} followers</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="hidden h-10 w-10 place-items-center rounded-full hover:bg-[#f1f2f4] sm:grid"><X size={20} /></button>
        </header>

        {/* tabs */}
        <nav className="grid grid-cols-3 border-b border-[#eceef1] px-2 sm:px-4" role="tablist">
          {(['friends', 'following', 'followers'] as ConnectionsTab[]).map(item => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => { setTab(item); setSearch(''); }}
              className={`relative min-h-12 px-1 text-[14px] font-bold transition ${tab === item ? 'text-[#1f4d1f]' : 'text-[#6b7280] hover:text-[#111111]'}`}>
              {TAB_LABEL[item]} <span className="font-semibold text-[#9ca3af]">{counts[item]}</span>
              {tab === item && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-[#e9c86a] to-[#b68428]" />}
            </button>
          ))}
        </nav>

        {/* search */}
        <div className="px-3 pt-3 sm:px-5">
          <label className="relative block">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6b7280]" />
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={SEARCH_LABEL[tab]} aria-label={SEARCH_LABEL[tab]}
              style={{ colorScheme: 'light' }}
              className="h-11 w-full rounded-xl border border-[#d4d7db] bg-[#f1f2f4] pl-10 pr-3 text-[15px] text-[#111827] outline-none placeholder:text-[#7b818a]! focus:border-[#c9a24a] focus:bg-[#ffffff] focus:ring-4 focus:ring-[#e9c86a]/30" />
          </label>
        </div>

        {/* list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 sm:px-3">
          {loading ? (
            <div className="grid place-items-center py-14 text-[#6b7280]" role="status"><Loader2 size={26} className="animate-spin" /><span className="mt-2 text-sm">Loading {TAB_LABEL[tab].toLowerCase()}…</span></div>
          ) : visible.length === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center text-[#6b7280]"><Users size={34} className="mb-2 text-[#d6aa4c]" /><p className="text-sm font-semibold">{emptyText}</p>{listError && tab !== 'friends' && <p className="mt-1 text-xs text-[#b91c1c]">{listError}</p>}</div>
          ) : (
            <ul className="divide-y divide-[#f1f2f4]">
              {visible.map(person => (
                <li key={person.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-[#fafafa]">
                  <button type="button" onClick={() => openProfile(person.id)} aria-label={`Open ${person.name}'s profile`} className="shrink-0 rounded-full ring-2 ring-[#f0dca6] transition hover:ring-[#d6aa4c]">
                    <img src={avatarSrc(person.avatar, person.name)} alt="" data-avatar="" data-name={person.name} className="h-12 w-12 rounded-full object-cover" />
                  </button>
                  <button type="button" onClick={() => openProfile(person.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[15px] font-bold hover:underline">{person.name}</span>
                    {person.subtitle && <span className="block truncate text-[12px] text-[#6b7280]">{person.subtitle}</span>}
                  </button>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {tab === 'friends' ? (
                      <>
                        <button type="button" onClick={() => openProfile(person.id)} className="inline-flex h-9 items-center rounded-xl border border-[#d4d7db] bg-[#ffffff] px-2.5 text-[13px] font-bold text-[#1f2937] hover:bg-[#f1f2f4] sm:px-3">View Profile</button>
                        {isOwn && <button type="button" disabled={busyId === person.id} onClick={() => void unfriend(person)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#f3c4c4] bg-[#fff5f5] px-2.5 text-[13px] font-bold text-[#b91c1c] hover:bg-[#fee2e2] disabled:opacity-60 sm:px-3">{busyId === person.id ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={15} />}Unfriend</button>}
                      </>
                    ) : followButton(person)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {notice && <p role="status" className="mx-3 mb-3 rounded-xl bg-[#111827] px-4 py-2.5 text-center text-[13px] font-semibold text-[#ffffff] sm:mx-5">{notice}</p>}
      </section>
    </div>
  );
};

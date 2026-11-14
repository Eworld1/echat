import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Search, Users, Store, Layers3, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { getV2Listings, type V2MarketListing } from '../services/v2Market';
import { assetUrl } from '../services/apiBase';
import { useAuth } from '../context/AuthContext';
import { PostCard } from '../components/PostCard';
import type { AppView } from '../components/Navbar';
import type { Group, Page, Post, User } from '../types';

type SearchTab = 'All' | 'People' | 'Posts' | 'Marketplace' | 'Pages' | 'Groups';
type ResultSet = { users: User[]; posts: Post[]; listings: V2MarketListing[]; pages: Page[]; groups: Group[] };
const blank: ResultSet = { users: [], posts: [], listings: [], pages: [], groups: [] };
const tabs: SearchTab[] = ['All', 'People', 'Posts', 'Marketplace', 'Pages', 'Groups'];

interface Props {
  onViewProfile: (userId: string) => void;
  onOpenListing: (id: string) => void;
  onNavigate: (view: AppView) => void;
}

export const SearchPage: React.FC<Props> = ({ onViewProfile, onOpenListing, onNavigate }) => {
  const { user } = useAuth();
  const [query, setQuery] = useState(() => new URLSearchParams(window.location.search).get('q') || '');
  const [activeTab, setActiveTab] = useState<SearchTab>('All');
  const [results, setResults] = useState<ResultSet>(blank);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [joinedPages, setJoinedPages] = useState<string[]>([]);
  const [joinedGroups, setJoinedGroups] = useState<string[]>([]);
  const [postUpdates, setPostUpdates] = useState<Record<string, Post>>({});

  useEffect(() => {
    const updateQuery = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      setQuery(detail || new URLSearchParams(window.location.search).get('q') || '');
      setActiveTab('All');
    };
    const syncUrl = () => setQuery(new URLSearchParams(window.location.search).get('q') || '');
    window.addEventListener('echat:search-query', updateQuery);
    window.addEventListener('popstate', syncUrl);
    return () => { window.removeEventListener('echat:search-query', updateQuery); window.removeEventListener('popstate', syncUrl); };
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term) { setResults(blank); setLoading(false); setError(''); return; }
    let active = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(async () => {
      try {
        const [global, allPages, allGroups, allListings] = await Promise.all([
          api.search(term), api.getPages(), api.getGroups(), getV2Listings()
        ]);
        if (!active) return;
        const lower = term.toLowerCase();
        setResults({
          users: global.users.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(lower)),
          posts: global.posts.filter(post => post.type === 'post' && post.isReel !== true && post.videoType !== 'reel' && `${post.content} ${post.author?.name || ''}`.toLowerCase().includes(lower)),
          listings: allListings.filter(item => item.status !== 'sold' && `${item.title} ${item.description} ${item.category} ${item.location} ${item.sellerName}`.toLowerCase().includes(lower)),
          pages: allPages.filter(page => `${page.name} ${page.category} ${page.bio}`.toLowerCase().includes(lower)),
          groups: allGroups.filter(group => `${group.name} ${group.description}`.toLowerCase().includes(lower))
        });
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Search could not be completed. Try again.');
      } finally { if (active) setLoading(false); }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query]);

  const counts = useMemo(() => ({
    People: results.users.length, Posts: results.posts.length, Marketplace: results.listings.length,
    Pages: results.pages.length, Groups: results.groups.length
  }), [results]);
  const show = (tab: SearchTab) => tab === 'All' || tab === activeTab;
  const setSearch = (value: string) => {
    setQuery(value);
    window.history.replaceState({ ...(window.history.state || {}), echatApp: true, tab: 'search' }, '', `/search?q=${encodeURIComponent(value)}`);
  };

  const togglePageFollow = async (page: Page) => {
    try { const updated = await api.togglePageFollow(page.id); setResults(current => ({ ...current, pages: current.pages.map(item => item.id === page.id ? updated : item) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not follow this Page.'); }
  };
  const joinGroup = async (group: Group) => {
    try { await api.joinGroup(group.id); setJoinedGroups(current => [...new Set([...current, group.id])]); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not join this group.'); }
  };

  const people = results.users.map(person => <article key={person.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
    <button onClick={() => onViewProfile(person.id)} className="shrink-0" aria-label={`View ${person.name}'s profile`}><img src={person.avatar} alt="" className="h-12 w-12 rounded-full bg-slate-100 object-cover" /></button>
    <div className="min-w-0 flex-1"><button onClick={() => onViewProfile(person.id)} className="block max-w-full truncate text-left font-bold text-slate-900">{person.name}</button><p className="truncate text-xs text-slate-500">{person.location || 'Echat member'}</p></div>
    <button onClick={() => onViewProfile(person.id)} className="min-h-10 shrink-0 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white">View Profile</button>
  </article>);

  return <main className="mx-auto w-full max-w-5xl space-y-4 pb-[calc(80px+env(safe-area-inset-bottom))] text-slate-900 min-[769px]:pb-8">
    <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"><p className="text-xs font-extrabold uppercase tracking-wider text-slate-500">Echat Search</p><h1 className="mt-1 text-2xl font-extrabold">Search Echat</h1><label className="mt-4 flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 focus-within:ring-2 focus-within:ring-blue-500"><Search size={18} className="shrink-0 text-slate-500"/><input autoFocus value={query} onChange={event => setSearch(event.target.value)} placeholder="Search people, posts, products, Pages and Groups" className="min-w-0 flex-1 bg-transparent text-base outline-none" /></label>
      <div role="tablist" aria-label="Search result type" className="mt-4 flex gap-2 overflow-x-auto pb-1">{tabs.map(tab => <button key={tab} role="tab" aria-selected={activeTab === tab} onClick={() => setActiveTab(tab)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${activeTab === tab ? 'bg-blue-700 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{tab}{tab !== 'All' ? ` (${counts[tab]})` : ''}</button>)}</div>
    </header>
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {loading && <div aria-label="Loading search results" className="grid gap-3 sm:grid-cols-2"><div className="h-20 animate-pulse rounded-xl bg-white"/><div className="h-20 animate-pulse rounded-xl bg-white"/><div className="h-44 animate-pulse rounded-xl bg-white"/><div className="h-44 animate-pulse rounded-xl bg-white"/></div>}
    {!loading && query.trim() && !error && Object.values(counts).every(count => count === 0) && <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Search size={28} className="mx-auto mb-2 text-slate-400"/><p className="font-bold">No results</p><p className="mt-1 text-sm text-slate-500">Try a different name, post, product or group.</p></div>}
    {!loading && query.trim() && <div className="space-y-5">
      {show('People') && results.users.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-lg font-extrabold"><Users size={19}/>People</h2><div className="grid gap-2 sm:grid-cols-2">{people}</div></section>}
      {show('Posts') && results.posts.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-lg font-extrabold"><FileText size={19}/>Posts</h2>{results.posts.map(post => <PostCard key={post.id} post={postUpdates[post.id] || post} onPostUpdated={updated => setPostUpdates(current => ({ ...current, [updated.id]: updated }))} onPostDeleted={() => {}} onViewProfile={onViewProfile} />)}</section>}
      {show('Marketplace') && results.listings.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-lg font-extrabold"><Store size={19}/>Marketplace</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{results.listings.map(item => <button key={item.id} onClick={() => onOpenListing(item.id)} className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm"><div className="aspect-square bg-slate-100">{item.photos[0] ? <img src={assetUrl(item.photos[0])} alt={item.title} className="h-full w-full object-cover"/> : <div className="grid h-full place-items-center text-slate-400"><Store size={26}/></div>}</div><div className="p-3"><p className="line-clamp-2 min-h-10 text-sm font-bold">{item.title}</p><p className="font-extrabold text-blue-700">{item.currency}{item.price}</p><p className="truncate text-xs text-slate-500">{item.location}</p></div></button>)}</div></section>}
      {show('Pages') && results.pages.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-lg font-extrabold"><Layers3 size={19}/>Pages</h2><div className="grid gap-3 sm:grid-cols-2">{results.pages.map(page => <article key={page.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><img src={page.avatar || page.cover} alt="" className="h-12 w-12 rounded-xl object-cover"/><div className="min-w-0 flex-1"><p className="truncate font-bold">{page.name}</p><p className="truncate text-xs text-slate-500">{page.category} · {page.followers.length} followers</p></div><button onClick={() => void togglePageFollow(page)} className="min-h-10 shrink-0 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white">{page.followers.includes(user?.id || '') ? 'Following' : 'Follow'}</button></article>)}</div></section>}
      {show('Groups') && results.groups.length > 0 && <section className="space-y-2"><h2 className="flex items-center gap-2 text-lg font-extrabold"><Users size={19}/>Groups</h2><div className="grid gap-3 sm:grid-cols-2">{results.groups.map(group => { const member = joinedGroups.includes(group.id) || group.members.includes(user?.id || ''); return <article key={group.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"><img src={group.avatar || group.cover} alt="" className="h-12 w-12 rounded-xl object-cover"/><div className="min-w-0 flex-1"><p className="truncate font-bold">{group.name}</p><p className="truncate text-xs text-slate-500">{group.members.length} members · {group.privacy}</p></div><button onClick={() => member ? onNavigate('groups') : void joinGroup(group)} className="min-h-10 shrink-0 rounded-lg bg-blue-700 px-3 text-xs font-bold text-white">{member ? 'View' : 'Join'}</button></article>; })}</div></section>}
    </div>}
    {!query.trim() && !loading && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">Enter a search to find people, posts, products, Pages and Groups.</div>}
  </main>;
};

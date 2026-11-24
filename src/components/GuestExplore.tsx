import React, { useEffect, useState } from 'react';
import { ArrowLeft, Eye, Heart, MessageCircle, Moon, Radio, Share2, ShoppingBag, Sparkles, Sun, X } from 'lucide-react';
import { api } from '../services/api';
import { assetUrl } from '../services/apiBase';
import { listenLiveStreams } from '../services/liveDiscovery';
import { listenV2Listings, type V2MarketListing } from '../services/v2Market';
import { usePreferences } from '../context/PreferencesContext';
import { avatarSrc } from './UserAvatar';
import { GlowLogo } from './BrandLogo';
import type { LiveStream, Post } from '../types';

interface Props {
  onLogin: () => void;
  onSignUp: () => void;
}

const timeAgo = (ms: number) => {
  const minutes = Math.max(1, Math.round((Date.now() - ms) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
};
const price = (value: number) => (value > 0 ? `Le ${Math.round(value).toLocaleString()}` : 'Free');

/** "Continue as Guest": a read-only look at EChat. Anything interactive asks the visitor to join. */
export const GuestExplore: React.FC<Props> = ({ onLogin, onSignUp }) => {
  const { resolvedTheme, setTheme } = usePreferences();
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [lives, setLives] = useState<LiveStream[]>([]);
  const [listings, setListings] = useState<V2MarketListing[]>([]);
  const [prompt, setPrompt] = useState('');

  useEffect(() => {
    let active = true;
    api.getPostsPage().then(page => { if (active) setPosts(page.posts.slice(0, 12)); }).catch(() => {}).finally(() => { if (active) setPostsLoading(false); });
    const stopLives = listenLiveStreams(items => setLives(items.slice(0, 8)), () => setLives([]));
    const stopListings = listenV2Listings(items => setListings(items.filter(item => item.status !== 'sold' && item.photos?.length).slice(0, 6)), () => setListings([]));
    return () => { active = false; stopLives(); stopListings(); };
  }, []);

  const join = (reason: string) => () => setPrompt(reason);
  const dark = resolvedTheme === 'dark';

  return (
    <div className="min-h-dvh bg-[#f6f4fd] text-slate-900 dark:bg-[#0b0820] dark:text-slate-100">
      <header className="ec-glass sticky top-0 z-30 border-b border-violet-100/60 dark:border-white/10">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
          <button type="button" onClick={onLogin} aria-label="Back to login" className="grid h-10 w-10 place-items-center rounded-full hover:bg-violet-100/70 dark:hover:bg-white/10"><ArrowLeft size={20} /></button>
          <GlowLogo size={34} />
          <span className="ec-gradient-text text-xl font-black tracking-tight">EChat</span>
          <span className="ml-1 hidden rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-bold text-violet-700 dark:bg-white/10 dark:text-violet-200 sm:inline">Guest preview</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={dark ? 'Light mode' : 'Dark mode'} className="grid h-10 w-10 place-items-center rounded-full hover:bg-violet-100/70 dark:hover:bg-white/10">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button type="button" onClick={onLogin} className="hidden min-h-10 rounded-full px-4 text-sm font-bold text-violet-700 hover:bg-violet-100/70 dark:text-violet-200 dark:hover:bg-white/10 sm:block">Log in</button>
            <button type="button" onClick={onSignUp} className="ec-gradient min-h-10 rounded-full px-4 text-sm font-bold text-white shadow-md shadow-violet-600/30">Join free</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 pb-16 pt-6">
        <section className="ec-gradient-animated relative overflow-hidden rounded-[24px] p-6 text-white shadow-xl shadow-violet-900/20 sm:p-8">
          <span aria-hidden="true" className="ec-float absolute -right-10 -top-10 h-48 w-48 rounded-full bg-pink-400/40 blur-3xl" />
          <p className="flex items-center gap-2 text-sm font-semibold text-white/80"><Sparkles size={16} />You're exploring as a guest</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">See what's happening on EChat</h1>
          <p className="mt-2 max-w-xl text-white/80">Browse live streams, posts and the marketplace. Join free to like, comment, chat and go live.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={onSignUp} className="min-h-11 rounded-full bg-white px-5 text-sm font-extrabold text-violet-700 shadow-lg transition hover:scale-[1.02]">Create free account</button>
            <button type="button" onClick={onLogin} className="min-h-11 rounded-full border border-white/40 px-5 text-sm font-bold text-white hover:bg-white/10">I have an account</button>
          </div>
        </section>

        {/* Live now */}
        <section aria-labelledby="guest-live">
          <h2 id="guest-live" className="mb-3 flex items-center gap-2 text-lg font-extrabold"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500" />Live now</h2>
          {lives.length === 0 ? (
            <p className="ec-card rounded-[20px] bg-white/80 p-5 text-sm text-slate-500 dark:bg-white/5 dark:text-slate-400">Nobody is live right now. Join EChat and be the first to go live!</p>
          ) : (
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
              {lives.map(stream => (
                <button key={stream.id} type="button" onClick={join('Join EChat to watch live streams and chat with creators.')} className="ec-card ec-card-hover relative aspect-[3/4] w-40 shrink-0 overflow-hidden rounded-[20px] bg-gradient-to-br from-violet-700 via-indigo-700 to-fuchsia-700 text-left text-white">
                  <img src={avatarSrc(stream.hostAvatar, stream.hostName)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20" />
                  <span className="absolute left-2 top-2 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-black tracking-wider">LIVE</span>
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold"><Eye size={11} />{stream.viewersCount || 0}</span>
                  <span className="absolute inset-x-2 bottom-2"><b className="block truncate text-sm">{stream.hostName}</b><span className="block truncate text-[11px] text-white/80">{stream.title || 'Live now'}</span></span>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Posts */}
          <section aria-labelledby="guest-posts" className="space-y-4">
            <h2 id="guest-posts" className="text-lg font-extrabold">Public posts</h2>
            {postsLoading && Array.from({ length: 2 }, (_, index) => <div key={index} className="ec-card h-64 animate-pulse rounded-[20px] bg-white/70 dark:bg-white/5" />)}
            {!postsLoading && posts.length === 0 && <p className="ec-card rounded-[20px] bg-white/80 p-5 text-sm text-slate-500 dark:bg-white/5">No public posts to show yet.</p>}
            {posts.map(post => {
              const image = post.mediaType === 'image' ? (post.mediaUrls?.[0] || post.mediaUrl) : undefined;
              const name = post.author?.name || 'EChat user';
              return (
                <article key={post.id} className="ec-card overflow-hidden rounded-[20px] bg-white dark:bg-[#151030]">
                  <header className="flex items-center gap-3 px-4 pt-4">
                    <img src={avatarSrc(post.author?.avatar, name)} alt="" className="h-10 w-10 rounded-full object-cover" />
                    <div className="min-w-0"><p className="truncate text-sm font-bold">{name}</p><p className="text-xs text-slate-500">{timeAgo(post.createdAt)} · Public</p></div>
                  </header>
                  {post.content && <p className="line-clamp-4 whitespace-pre-wrap break-words px-4 pt-3 text-[15px] leading-relaxed">{post.content}</p>}
                  {image && <img src={assetUrl(image)} alt="" loading="lazy" className="mt-3 max-h-[480px] w-full bg-slate-100 object-cover dark:bg-white/5" />}
                  <div className="mx-3 mt-2 grid grid-cols-3 border-t border-slate-100 py-1 text-sm font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">
                    <button type="button" onClick={join('Join EChat to like posts.')} className="flex min-h-10 items-center justify-center gap-2 rounded-xl hover:bg-violet-50 dark:hover:bg-white/5"><Heart size={17} />Like</button>
                    <button type="button" onClick={join('Join EChat to comment.')} className="flex min-h-10 items-center justify-center gap-2 rounded-xl hover:bg-violet-50 dark:hover:bg-white/5"><MessageCircle size={17} />Comment</button>
                    <button type="button" onClick={join('Join EChat to share posts with friends.')} className="flex min-h-10 items-center justify-center gap-2 rounded-xl hover:bg-violet-50 dark:hover:bg-white/5"><Share2 size={17} />Share</button>
                  </div>
                </article>
              );
            })}
          </section>

          {/* Marketplace */}
          <aside aria-labelledby="guest-market" className="space-y-3">
            <h2 id="guest-market" className="flex items-center gap-2 text-lg font-extrabold"><ShoppingBag size={19} className="text-pink-500" />Marketplace picks</h2>
            <div className="grid grid-cols-2 gap-3">
              {listings.map(item => (
                <button key={item.id} type="button" onClick={join('Join EChat to message sellers and buy safely.')} className="ec-card ec-card-hover overflow-hidden rounded-[20px] bg-white text-left dark:bg-[#151030]">
                  <img src={assetUrl(item.photos[0])} alt="" loading="lazy" className="aspect-square w-full bg-slate-100 object-cover dark:bg-white/5" />
                  <span className="block p-2.5"><b className="block text-sm">{price(item.price)}</b><span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.title}</span></span>
                </button>
              ))}
            </div>
            {listings.length === 0 && <p className="ec-card rounded-[20px] bg-white/80 p-5 text-sm text-slate-500 dark:bg-white/5">Listings will appear here.</p>}
            <button type="button" onClick={join('Join EChat to go live and reach people across Sierra Leone.')} className="ec-golive flex min-h-12 w-full items-center justify-center gap-2 rounded-[20px] text-sm font-extrabold text-white"><Radio size={18} />Go Live on EChat</button>
          </aside>
        </div>
      </main>

      {prompt && (
        <div role="dialog" aria-modal="true" aria-label="Join EChat" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={() => setPrompt('')}>
          <div onClick={event => event.stopPropagation()} className="ec-fade-up relative w-full max-w-sm rounded-[24px] bg-white p-6 text-center shadow-2xl dark:bg-[#151030]">
            <button type="button" onClick={() => setPrompt('')} aria-label="Close" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10"><X size={18} /></button>
            <GlowLogo size={56} className="mx-auto" />
            <h3 className="mt-4 text-xl font-black">Join EChat</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{prompt}</p>
            <button type="button" onClick={onSignUp} className="ec-gradient mt-5 min-h-12 w-full rounded-2xl text-sm font-extrabold text-white shadow-lg shadow-violet-600/30">Create free account</button>
            <button type="button" onClick={onLogin} className="mt-2 min-h-11 w-full rounded-2xl text-sm font-bold text-violet-700 hover:bg-violet-50 dark:text-violet-200 dark:hover:bg-white/10">Log in</button>
          </div>
        </div>
      )}
    </div>
  );
};

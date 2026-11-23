import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Music2, Plus, RefreshCw, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { api } from '../services/api';
import { auth } from '../services/firebase';
import type { Post } from '../types';
import { PostCard } from '../components/PostCard';
import { StoriesBar } from '../components/StoriesBar';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';
import { listenFollowingIds } from '../services/liveDiscovery';
import { ReelView } from '../components/reels/ReelView';
import { CommentsSheet, MoreSheet, ShareSheet, SoundSheet, type Viewer } from '../components/reels/ReelSheets';
import { CreateStudio, type StudioPreset } from '../components/reels/CreateStudio';
import {
  getReel, listenMyReelLikes, listenMyReelSaves, listenReels, listenSavedSounds, setReelLike, setReelSave,
  type Reel, type SavedSound
} from '../services/reels/reelsStore';

interface ReelsProps {
  onViewProfile: (userId: string) => void;
}

type FeedTab = 'foryou' | 'following' | 'trending' | 'nearby' | 'saved';
const TABS: { id: FeedTab; label: string }[] = [
  { id: 'foryou', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'trending', label: 'Trending' },
  { id: 'nearby', label: 'Nearby' },
  { id: 'saved', label: 'Saved' }
];

/** Feed item: a new Firebase reel, or an older reel from the Express API (rendered as before). */
type FeedItem = { kind: 'fs'; id: string; createdAt: number; reel: Reel } | { kind: 'legacy'; id: string; createdAt: number; post: Post };

const isLegacyReel = (post: Post) => (post.type === 'reel' || post.isReel === true) && post.mediaType === 'video' && Boolean(post.mediaUrl) && post.privacy === 'public';
const trendScore = (reel: Reel) => reel.likesCount * 3 + reel.commentsCount * 4 + reel.views;

export const Reels: React.FC<ReelsProps> = ({ onViewProfile }) => {
  const { user, updateUser } = useAuth();
  const uid = auth.currentUser?.uid || '';
  const viewer: Viewer | null = user && uid ? { uid, name: user.name, avatar: user.avatar || '', friends: Array.isArray(user.friends) ? user.friends : [] } : null;

  // ---- older Express reels (unchanged loading + paging) ----
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState('');
  const refreshInFlight = useRef(false);
  const moreInFlight = useRef(false);
  const feedGeneration = useRef(0);
  const nextCursor = useRef<string | null>(null);
  const hasLoaded = useRef(false);
  const { onNewPost, onPostUpdated, onPostDeleted } = useSocket();

  // ---- new Firebase reels ----
  const [reels, setReels] = useState<Reel[]>([]);
  const [reelsReady, setReelsReady] = useState(false);
  const [deepLinked, setDeepLinked] = useState<Reel | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedReels, setSavedReels] = useState<Map<string, Reel>>(new Map());
  const [savedSounds, setSavedSounds] = useState<SavedSound[]>([]);
  const [followingIds, setFollowingIds] = useState<string[]>([]);

  const [tab, setTab] = useState<FeedTab>('foryou');
  const [successToast, setSuccessToast] = useState('');
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('reels_autoplay') !== 'false');
  const [muted, setMuted] = useState(() => localStorage.getItem('reels_muted') !== 'false');
  const [activeIndex, setActiveIndex] = useState(0);
  const [studio, setStudio] = useState<StudioPreset | null>(null);
  const [sheet, setSheet] = useState<{ type: 'comments' | 'share' | 'sound' | 'more'; reelId: string } | null>(null);
  const soundHintShown = useRef(false);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!successToast) return;
    const timeout = window.setTimeout(() => setSuccessToast(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [successToast]);

  const load = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const generation = ++feedGeneration.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    nextCursor.current = null;
    setHasMore(true);
    setActiveIndex(0);
    if (hasLoaded.current) setRefreshing(true);
    setLoading(true);
    setLoadError('');
    try {
      const page = await api.getReels();
      if (generation !== feedGeneration.current) return;
      const legacy = page.reels.filter(isLegacyReel);
      setPosts([...new Map(legacy.map(post => [post.id, post])).values()]);
      nextCursor.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
      hasLoaded.current = true;
    } catch (error) {
      if (generation !== feedGeneration.current) return;
      setLoadError(error instanceof Error ? error.message : 'Could not load older Reels.');
    } finally {
      if (generation === feedGeneration.current) {
        refreshInFlight.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor.current;
    if (!cursor || refreshInFlight.current || moreInFlight.current || !hasMore) return;
    moreInFlight.current = true;
    const generation = feedGeneration.current;
    setLoadingMore(true);
    try {
      const page = await api.getReels(cursor);
      if (generation !== feedGeneration.current) return;
      const legacy = page.reels.filter(isLegacyReel);
      setPosts(current => [...new Map([...current, ...legacy].map(post => [post.id, post])).values()]);
      nextCursor.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
    } catch (error) {
      if (generation === feedGeneration.current) setLoadError(error instanceof Error ? error.message : 'Could not load more Reels.');
    } finally {
      if (generation === feedGeneration.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore]);

  useEffect(() => {
    void load();
    const stopNew = onNewPost(post => { if (isLegacyReel(post)) setPosts(current => [post, ...current.filter(item => item.id !== post.id)]); });
    const stopUpdate = onPostUpdated(post => {
      if (post.type === 'reel' || post.isReel === true) setPosts(current => current.map(item => item.id === post.id ? post : item).filter(item => item.privacy === 'public'));
      else setPosts(current => current.filter(item => item.id !== post.id));
    });
    const stopDelete = onPostDeleted(id => setPosts(current => current.filter(item => item.id !== id)));
    return () => { stopNew(); stopUpdate(); stopDelete(); };
  }, [load, onNewPost, onPostUpdated, onPostDeleted]);

  // Firebase listeners
  useEffect(() => listenReels(uid, items => { setReels(items); setReelsReady(true); }, error => { setReelsReady(true); setLoadError(error.message); }), [uid]);
  useEffect(() => listenMyReelLikes(uid, setLikedIds), [uid]);
  useEffect(() => listenMyReelSaves(uid, setSavedIds), [uid]);
  useEffect(() => listenSavedSounds(uid, setSavedSounds), [uid]);
  useEffect(() => listenFollowingIds(uid, setFollowingIds), [uid]);

  // Share links: /reels?r=<id> opens that reel first.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('r');
    if (id) void getReel(id).then(reel => { if (reel) setDeepLinked(reel); else setSuccessToast('That reel is not available.'); });
  }, []);

  // Saved tab: resolve saved reels that aren't in the loaded feed.
  useEffect(() => {
    if (tab !== 'saved') return;
    const known = new Map(reels.map(reel => [reel.id, reel]));
    const missing = [...savedIds].filter(id => !known.has(id) && !savedReels.has(id));
    if (!missing.length) return;
    void Promise.all(missing.map(getReel)).then(found => setSavedReels(current => {
      const next = new Map(current);
      found.forEach(reel => { if (reel) next.set(reel.id, reel); });
      return next;
    }));
  }, [tab, savedIds, reels]);

  useEffect(() => {
    const syncSettings = () => {
      setAutoplay(localStorage.getItem('reels_autoplay') !== 'false');
      setMuted(localStorage.getItem('reels_muted') !== 'false');
    };
    window.addEventListener('echat:reels-settings', syncSettings);
    return () => window.removeEventListener('echat:reels-settings', syncSettings);
  }, []);

  const toggleAutoplay = () => {
    const next = !autoplay;
    setAutoplay(next);
    localStorage.setItem('reels_autoplay', String(next));
    window.dispatchEvent(new Event('echat:reels-settings'));
    if (user) api.updateProfile(user.id, { reelsAutoplay: next }).then(updateUser).catch(() => {});
  };
  const toggleMuted = () => {
    const next = !muted;
    setMuted(next);
    localStorage.setItem('reels_muted', String(next));
    window.dispatchEvent(new Event('echat:reels-settings'));
  };

  const items = useMemo<FeedItem[]>(() => {
    const circle = new Set([...followingIds, ...(Array.isArray(user?.friends) ? user.friends : [])]);
    const city = (user?.location || '').split(',')[0].trim().toLowerCase();
    const fs = reels.map(reel => ({ kind: 'fs' as const, id: `fs_${reel.id}`, createdAt: reel.createdAt, reel }));
    const legacy = posts.map(post => ({ kind: 'legacy' as const, id: `legacy_${post.id}`, createdAt: post.createdAt, post }));
    let list: FeedItem[];
    if (tab === 'following') list = [...fs.filter(item => circle.has(item.reel.creatorId)), ...legacy.filter(item => circle.has(item.post.authorId))].sort((a, b) => b.createdAt - a.createdAt);
    else if (tab === 'trending') {
      const weekAgo = Date.now() - 7 * 86400000;
      list = fs.filter(item => item.createdAt >= weekAgo).sort((a, b) => trendScore(b.reel) - trendScore(a.reel));
    } else if (tab === 'nearby') list = city ? fs.filter(item => item.reel.location.toLowerCase().includes(city)) : [];
    else if (tab === 'saved') {
      const known = new Map([...reels, ...savedReels.values()].map(reel => [reel.id, reel]));
      list = [...savedIds].map(id => known.get(id)).filter((reel): reel is Reel => Boolean(reel)).map(reel => ({ kind: 'fs' as const, id: `fs_${reel.id}`, createdAt: reel.createdAt, reel }));
    } else list = [...fs, ...legacy].sort((a, b) => b.createdAt - a.createdAt);
    if (deepLinked && tab === 'foryou') list = [{ kind: 'fs', id: `fs_${deepLinked.id}`, createdAt: deepLinked.createdAt, reel: reels.find(reel => reel.id === deepLinked.id) || deepLinked }, ...list.filter(item => item.id !== `fs_${deepLinked.id}`)];
    return list;
  }, [reels, posts, tab, followingIds, user?.friends, user?.location, savedIds, savedReels, deepLinked]);

  useEffect(() => { setActiveIndex(0); feedRef.current?.scrollTo({ top: 0 }); }, [tab]);
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || tab !== 'foryou' || loading || loadingMore || !hasMore || items.length === 0) return;
    if (feed.scrollHeight <= feed.clientHeight + 200) void loadMore();
  }, [items.length, loading, loadingMore, hasMore, loadMore, tab]);

  const sheetReel = sheet ? (reels.find(reel => reel.id === sheet.reelId) || savedReels.get(sheet.reelId) || (deepLinked?.id === sheet.reelId ? deepLinked : null)) : null;
  const handleLegacyUpdated = (updated: Post) => setPosts(current => current.map(item => item.id === updated.id ? updated : item));
  const handleLegacyDeleted = (id: string) => setPosts(current => current.filter(item => item.id !== id));
  const requireViewer = () => { if (!viewer) setSuccessToast('Sign in to do that.'); return Boolean(viewer); };
  const openStudio = (preset: StudioPreset = {}) => { if (!requireViewer()) return; setSheet(null); setStudio(preset); };

  const emptyMessage: Record<FeedTab, string> = {
    foryou: 'No Reels yet. Create the first one!',
    following: 'No Reels from people you follow yet.',
    trending: 'Nothing trending this week yet.',
    nearby: user?.location ? `No Reels from ${user.location.split(',')[0]} yet.` : 'Add your city to your profile to see Reels near you.',
    saved: 'Tap the bookmark on any Reel to save it here.'
  };
  const isLoading = (loading && !hasLoaded.current) || !reelsReady;

  return <div className="mx-auto flex min-h-0 w-full max-w-[620px] flex-col gap-3">
    {successToast && <div role="status" aria-live="polite" className="fixed left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-[95] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">{successToast}</div>}
    <header className="flex min-h-14 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-xs sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#E7F0FD] text-[#1877F2]"><Film size={20} /></span><div className="min-w-0"><h1 className="font-extrabold text-slate-900">Reels</h1><p className="hidden truncate text-xs text-slate-500 sm:block">Short videos & photos from the EChat community</p></div></div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={toggleAutoplay} aria-pressed={autoplay} title={`Autoplay ${autoplay ? 'on' : 'off'}`} className={`flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold max-[400px]:px-2 ${autoplay ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><span className={`h-2 w-2 rounded-full ${autoplay ? 'bg-emerald-500' : 'bg-slate-400'}`} /><span className="max-[400px]:hidden">Autoplay {autoplay ? 'On' : 'Off'}</span></button>
        <button type="button" onClick={toggleMuted} aria-label={muted ? 'Unmute Reels' : 'Mute Reels'} title={muted ? 'Unmute Reels' : 'Mute Reels'} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <button type="button" onClick={() => void load()} disabled={refreshing || loading} aria-label="Refresh Reels" title="Refresh Reels" className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-60"><RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} /></button>
        <button type="button" onClick={() => openStudio()} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-[#1877F2] px-3 text-xs font-bold text-white hover:bg-[#166FE5]"><Plus size={15} /><span className="hidden sm:inline">Create Reel</span><span className="sm:hidden">Create</span></button>
      </div>
    </header>

    <div className="rounded-2xl border border-slate-200 bg-white px-2 pt-3 shadow-xs"><StoriesBar /></div>

    <div className="-mx-1 flex gap-2 overflow-x-auto px-1" role="tablist" aria-label="Reels feeds">
      {TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${tab === item.id ? 'bg-[#1877F2] text-white' : 'bg-white text-slate-700 shadow-xs ring-1 ring-slate-200'}`}>{item.label}</button>)}
    </div>

    {loadError && items.length === 0 && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"><span>{loadError}</span><button type="button" onClick={() => void load()} className="min-h-10 rounded-lg bg-rose-700 px-3 font-bold text-white">Retry</button></div>}

    {isLoading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading Reels…</div>
      : items.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Sparkles size={30} className="mx-auto mb-2 text-[#1877F2]" /><p className="font-bold text-slate-800">{emptyMessage[tab]}</p>{tab !== 'saved' && <button onClick={() => openStudio()} className="mt-4 rounded-xl bg-[#1877F2] px-4 py-2 text-sm font-bold text-white">Create a Reel</button>}</div>
      : <div ref={feedRef} tabIndex={0} aria-label="Reels feed" onScroll={event => { const feed = event.currentTarget; if (tab === 'foryou' && feed.scrollHeight - feed.scrollTop - feed.clientHeight < 500) void loadMore(); }} onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const nextIndex = Math.max(0, Math.min(items.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        const feed = feedRef.current;
        const target = feed?.querySelectorAll<HTMLElement>('[data-reel-slide]')[nextIndex];
        if (feed && target) feed.scrollTo({ top: feed.scrollTop + target.getBoundingClientRect().top - feed.getBoundingClientRect().top, behavior: 'smooth' });
      }} className="box-border h-[calc(100dvh-140px)] min-h-0 snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none] [-webkit-overflow-scrolling:touch] touch-pan-y pb-[calc(60px+env(safe-area-inset-bottom))] min-[769px]:h-[calc(100dvh-140px)] min-[769px]:min-h-[420px] min-[769px]:pb-2">
        {items.map((item, index) => (
          <Slide key={item.id} index={index} activeIndex={activeIndex} onActive={setActiveIndex} root={feedRef} thumbnail={item.kind === 'fs' ? item.reel.coverUrl : item.post.thumbnailUrl}>
            {near => item.kind === 'fs' ? (
              <ReelView
                reel={item.reel}
                active={index === activeIndex}
                autoplay={autoplay}
                nearby={near}
                muted={muted}
                viewer={viewer}
                liked={likedIds.has(item.reel.id)}
                saved={savedIds.has(item.reel.id)}
                onToggleMute={toggleMuted}
                onLike={liked => { if (requireViewer()) void setReelLike(item.reel.id, uid, liked).catch(error => setSuccessToast(error instanceof Error ? error.message : 'Could not like.')); }}
                onSave={saved => { if (requireViewer()) void setReelSave(item.reel.id, uid, saved).then(() => setSuccessToast(saved ? 'Saved to Saved Reels' : 'Removed from Saved Reels')).catch(error => setSuccessToast(error instanceof Error ? error.message : 'Could not save.')); }}
                onComments={() => setSheet({ type: 'comments', reelId: item.reel.id })}
                onShare={() => setSheet({ type: 'share', reelId: item.reel.id })}
                onSound={() => setSheet({ type: 'sound', reelId: item.reel.id })}
                onMore={() => setSheet({ type: 'more', reelId: item.reel.id })}
                onViewProfile={onViewProfile}
                onSoundBlocked={() => { if (!soundHintShown.current) { soundHintShown.current = true; setSuccessToast('Tap 🔊 to turn sound on'); } }}
              />
            ) : (
              <div className="relative h-full w-full">
                {near && <PostCard post={item.post} onPostUpdated={handleLegacyUpdated} onPostDeleted={handleLegacyDeleted} onViewProfile={onViewProfile} reelMode detailMode reelActive={index === activeIndex} reelPreload={Math.abs(index - activeIndex) <= 1 ? 'auto' : 'metadata'} />}
                <span className="pointer-events-none absolute left-3 top-3 z-30 flex max-w-[70%] items-center gap-1 truncate rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white"><Music2 size={12} />Original Audio - {item.post.author?.name || 'EChat user'}</span>
              </div>
            )}
          </Slide>
        ))}
        <div aria-live="polite" className="flex min-h-12 items-center justify-center py-3 text-sm text-slate-500">
          {loadingMore ? <span className="inline-flex items-center gap-2"><RefreshCw size={16} className="animate-spin" />Loading more reels...</span> : tab === 'foryou' && !hasMore ? 'No more reels' : null}
        </div>
      </div>}

    {sheet && sheetReel && sheet.type === 'comments' && <CommentsSheet reel={sheetReel} viewer={viewer} onClose={() => setSheet(null)} />}
    {sheet && sheetReel && sheet.type === 'share' && <ShareSheet reel={sheetReel} viewer={viewer} onClose={() => setSheet(null)} onToast={setSuccessToast} />}
    {sheet && sheetReel && sheet.type === 'sound' && <SoundSheet reel={sheetReel} viewer={viewer} savedSounds={savedSounds} onClose={() => setSheet(null)} onUse={sound => openStudio({ sound })} onToast={setSuccessToast} />}
    {sheet && sheetReel && sheet.type === 'more' && <MoreSheet reel={sheetReel} viewer={viewer} onClose={() => setSheet(null)} onStudio={openStudio} onToast={setSuccessToast} onDeleted={() => setDeepLinked(current => current?.id === sheetReel.id ? null : current)} />}

    {studio && <CreateStudio mode="reel" preset={studio} onClose={() => setStudio(null)} onCreated={message => { setStudio(null); setTab('foryou'); setActiveIndex(0); feedRef.current?.scrollTo({ top: 0 }); setSuccessToast(message); }} />}
  </div>;
};

interface SlideProps {
  index: number;
  activeIndex: number;
  onActive: (index: number) => void;
  root: React.RefObject<HTMLDivElement | null>;
  thumbnail?: string;
  children: (nearViewport: boolean) => React.ReactNode;
}

/** Snap slide: only slides near the viewport mount their player (keeps scrolling smooth on phones). */
const Slide: React.FC<SlideProps> = ({ index, activeIndex, onActive, root, thumbnail, children }) => {
  const slideRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(index < 2);

  useEffect(() => {
    const slide = slideRef.current;
    const rootElement = root.current;
    if (!slide || !rootElement || typeof IntersectionObserver === 'undefined') return;
    const proximityObserver = new IntersectionObserver(([entry]) => setNearViewport(entry.isIntersecting), { root: rootElement, rootMargin: '180% 0px' });
    const activeObserver = new IntersectionObserver(([entry]) => { if (entry.isIntersecting && entry.intersectionRatio >= 0.6) onActive(index); }, { root: rootElement, threshold: [0, 0.6, 1] });
    proximityObserver.observe(slide);
    activeObserver.observe(slide);
    return () => { proximityObserver.disconnect(); activeObserver.disconnect(); };
  }, [index, onActive, root]);

  return <section ref={slideRef} data-reel-slide className="relative flex h-full min-h-0 w-full shrink-0 snap-start snap-always items-center justify-center bg-black touch-pan-y min-[769px]:rounded-2xl">
    <div className="h-full w-full min-[769px]:max-w-[420px]">
      {nearViewport ? children(true) : <div className="h-full w-full bg-black" aria-hidden="true">{thumbnail && <img src={thumbnail} alt="" loading="lazy" className="h-full w-full object-cover opacity-80" />}</div>}
    </div>
    {index === 0 && activeIndex === 0 && <span className="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-semibold text-white min-[769px]:hidden">Swipe up for next ↑</span>}
  </section>;
};

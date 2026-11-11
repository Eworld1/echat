import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Plus, RefreshCw, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { api } from '../services/api';
import type { Post } from '../types';
import { CreatePostModal } from '../components/CreatePostModal';
import { PostCard } from '../components/PostCard';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';

interface ReelsProps {
  onViewProfile: (userId: string) => void;
}

export const Reels: React.FC<ReelsProps> = ({ onViewProfile }) => {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showComposer, setShowComposer] = useState(false);
  const [autoplay, setAutoplay] = useState(() => localStorage.getItem('reels_autoplay') !== 'false');
  const [muted, setMuted] = useState(() => localStorage.getItem('reels_muted') !== 'false');
  const [activeIndex, setActiveIndex] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const refreshInFlight = useRef(false);
  const moreInFlight = useRef(false);
  const feedGeneration = useRef(0);
  const nextCursor = useRef<string | null>(null);
  const hasLoaded = useRef(false);
  const { onNewPost, onPostUpdated, onPostDeleted } = useSocket();
  const { user, updateUser } = useAuth();

  const load = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    const generation = ++feedGeneration.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    nextCursor.current = null;
    setHasMore(true);
    setPosts([]);
    setActiveIndex(0);
    if (hasLoaded.current) setRefreshing(true);
    setLoading(true);
    setLoadError('');
    try {
      const page = await api.getReels();
      if (generation !== feedGeneration.current) return;
      const reels = page.reels.filter(post => (post.type === 'reel' || post.isReel === true) && post.mediaType === 'video' && post.mediaUrl && post.privacy === 'public');
      setPosts([...new Map(reels.map(post => [post.id, post])).values()]);
      nextCursor.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
      hasLoaded.current = true;
    } catch (error) {
      if (generation !== feedGeneration.current) return;
      setLoadError(error instanceof Error ? error.message : 'Could not load Reels. Check your connection and refresh.');
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
      const reels = page.reels.filter(post => (post.type === 'reel' || post.isReel === true) && post.mediaType === 'video' && post.mediaUrl && post.privacy === 'public');
      setPosts(current => [...new Map([...current, ...reels].map(post => [post.id, post])).values()]);
      nextCursor.current = page.nextCursor;
      setHasMore(Boolean(page.nextCursor));
      setLoadError('');
    } catch (error) {
      if (generation === feedGeneration.current) setLoadError(error instanceof Error ? error.message : 'Could not load more Reels. Scroll or refresh to retry.');
    } finally {
      if (generation === feedGeneration.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasMore]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || loading || loadingMore || refreshing || loadError || !hasMore || posts.length === 0) return;
    // Keep fetching when a short page does not fill the mobile viewport; only the
    // empty server page marks the true end of the feed.
    if (feed.scrollHeight <= feed.clientHeight + 200) void loadMore();
  }, [posts.length, loading, loadingMore, refreshing, loadError, hasMore, loadMore]);

  useEffect(() => {
    void load();
    const stopNew = onNewPost(post => {
      if ((post.type === 'reel' || post.isReel === true) && post.mediaType === 'video' && post.mediaUrl && post.privacy === 'public') {
        setPosts(current => [post, ...current.filter(item => item.id !== post.id)]);
      }
    });
    const stopUpdate = onPostUpdated(post => {
      if (post.type === 'reel' || post.isReel === true) setPosts(current => current.map(item => item.id === post.id ? post : item).filter(item => item.privacy === 'public'));
      else setPosts(current => current.filter(item => item.id !== post.id));
    });
    const stopDelete = onPostDeleted(id => setPosts(current => current.filter(item => item.id !== id)));
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refreshWhenVisible);
    window.addEventListener('pageshow', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      stopNew(); stopUpdate(); stopDelete();
      window.removeEventListener('focus', refreshWhenVisible);
      window.removeEventListener('pageshow', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load, onNewPost, onPostUpdated, onPostDeleted]);

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

  const handleUpdated = (updated: Post) => setPosts(current => current.map(item => item.id === updated.id ? updated : item));
  const handleDeleted = (id: string) => setPosts(current => current.filter(item => item.id !== id));

  return <div className="mx-auto w-full max-w-[620px] space-y-3 pb-4">
    <header className="flex min-h-14 items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-xs sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fuchsia-100 text-fuchsia-700"><Film size={20} /></span><div className="min-w-0"><h1 className="font-extrabold text-slate-900">Reels</h1><p className="hidden truncate text-xs text-slate-500 sm:block">Short public videos from the eChat community</p></div></div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={toggleAutoplay} aria-pressed={autoplay} title={`Autoplay ${autoplay ? 'on' : 'off'}`} className={`flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-bold max-[400px]:px-2 ${autoplay ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}><span className={`h-2 w-2 rounded-full ${autoplay ? 'bg-emerald-500' : 'bg-slate-400'}`} /><span className="max-[400px]:hidden">Autoplay {autoplay ? 'On' : 'Off'}</span></button>
        <button type="button" onClick={toggleMuted} aria-label={muted ? 'Unmute Reels' : 'Mute Reels'} title={muted ? 'Unmute Reels' : 'Mute Reels'} className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700">{muted ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        <button type="button" onClick={() => void load()} disabled={refreshing || loading} aria-label="Refresh Reels" title="Refresh Reels" className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-60"><RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} /></button>
        <button type="button" onClick={() => setShowComposer(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-fuchsia-600 px-3 text-xs font-bold text-white hover:bg-fuchsia-700"><Plus size={15} /><span className="hidden sm:inline">Create Reel</span><span className="sm:hidden">Create</span></button>
      </div>
    </header>

    {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"><span>{posts.length ? `Could not refresh Reels: ${loadError}` : loadError}</span><button type="button" onClick={() => void load()} className="min-h-10 rounded-lg bg-rose-700 px-3 font-bold text-white">Retry</button></div>}
    {loading ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading Reels…</div> : posts.length === 0 ? loadError ? null : <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center"><Sparkles size={30} className="mx-auto mb-2 text-fuchsia-500" /><p className="font-bold text-slate-800">No Reels yet</p><p className="mt-1 text-sm text-slate-500">Create a Reel to start the video feed.</p><button onClick={() => setShowComposer(true)} className="mt-4 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700">Create your first Reel</button></div> : <div ref={feedRef} aria-label="Reels feed" onScroll={event => { const feed = event.currentTarget; if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 500) void loadMore(); }} className="h-[calc(100dvh-190px)] min-h-[420px] snap-y snap-mandatory space-y-3 overflow-y-auto overscroll-contain pb-2 lg:h-[calc(100dvh-140px)]">
      {posts.map((post, index) => <ReelSlide key={post.id} post={post} index={index} activeIndex={activeIndex} onActive={setActiveIndex} root={feedRef} onPostUpdated={handleUpdated} onPostDeleted={handleDeleted} onViewProfile={onViewProfile} />)}
      <div aria-live="polite" className="flex min-h-12 items-center justify-center py-3 text-sm text-slate-500">
        {loadingMore ? <span className="inline-flex items-center gap-2"><RefreshCw size={16} className="animate-spin" />Loading more reels...</span> : !hasMore ? 'No more reels' : null}
      </div>
    </div>}

    <CreatePostModal isOpen={showComposer} onClose={() => setShowComposer(false)} onPostCreated={() => { void load(); }} forcePublic videoOnly title="Create a public Reel" />
  </div>;
};

interface ReelSlideProps {
  post: Post;
  index: number;
  activeIndex: number;
  onActive: (index: number) => void;
  root: React.RefObject<HTMLDivElement | null>;
  onPostUpdated: (post: Post) => void;
  onPostDeleted: (id: string) => void;
  onViewProfile: (userId: string) => void;
}

const ReelSlide: React.FC<ReelSlideProps> = ({ post, index, activeIndex, onActive, root, onPostUpdated, onPostDeleted, onViewProfile }) => {
  const slideRef = useRef<HTMLDivElement>(null);
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

  const preload = Math.abs(index - activeIndex) <= 1 ? 'auto' : 'metadata';
  return <section ref={slideRef} className="flex h-full snap-start snap-always items-center justify-center overflow-hidden rounded-2xl bg-black">
    {nearViewport ? <div className="h-full w-full max-w-[420px] overflow-y-auto overscroll-contain"><PostCard post={post} onPostUpdated={onPostUpdated} onPostDeleted={onPostDeleted} onViewProfile={onViewProfile} reelMode detailMode reelPreload={preload} /></div> : <div className="h-full w-full max-w-[420px] bg-black" aria-hidden="true">{post.thumbnailUrl && <img src={post.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover opacity-80" />}</div>}
  </section>;
};
